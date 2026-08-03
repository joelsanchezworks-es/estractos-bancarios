import crypto from 'crypto';
import { parseSabadellText, extractSabadellText, monthOf } from './sabadell';
import { classifyConceptos } from './claude';
import { sanitizeComunidad } from './parser';
import {
  ensureCommunityTab,
  getGrid,
  applyCellUpdates,
  appendPendiente,
  isDuplicate,
  recordHash,
  getSheetUrl,
  cellA1,
  assertNativeSheet,
} from './sheets';
import {
  normalizeCode,
  codeDescripcion,
  calendarMonthToCatalan,
  findMonthRowIndex,
  monthColumnMap,
  codeRowMap,
  normalizeKey,
  colToLetter,
} from './codes';
import type {
  SabProcessResult,
  CeldaUpdate,
  PendienteItem,
  PreparedExtracto,
  ClassifiedGasto,
} from './types';
import { createTimer } from './log';

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

function toNumber(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (raw == null || raw === '') return 0;
  const direct = Number(raw);
  if (!Number.isNaN(direct)) return direct;
  // Fallback for Spanish-formatted strings ("1.234,56").
  const es = parseFloat(String(raw).replace(/\./g, '').replace(',', '.'));
  return Number.isNaN(es) ? 0 : es;
}

function emptyResult(archivo: string): SabProcessResult {
  return {
    comunidad: '',
    archivo,
    tabCreada: false,
    duplicado: false,
    totalMovimientos: 0,
    ignorados: 0,
    celdasActualizadas: 0,
    updates: [],
    pendientes: [],
    totalesPorCategoria: [],
    totalesPorMes: [],
    sheetUrl: getSheetUrl(),
  };
}

// ---------------------------------------------------------------------------
// PHASE 1 — parse the statement text, validate the destination, dedup, split
// expenses from income. Fast (a metadata read + a dedup lookup). Throws with a
// clear message on failure so the route returns the exact error to the frontend.
// ---------------------------------------------------------------------------

/**
 * Dedup key: SHA-256 of the extracted text with whitespace removed, so the same
 * statement yields the same key regardless of which extractor produced the text
 * (pdf.js in the browser vs pdf-parse on the server).
 */
function textHash(text: string): string {
  return crypto.createHash('sha256').update(text.replace(/\s+/g, '')).digest('hex');
}

async function prepareCore(
  text: string,
  hash: string,
  filename: string,
  force: boolean,
  t: ReturnType<typeof createTimer>,
): Promise<PreparedExtracto> {
  const sheetUrl = getSheetUrl();

  // Fail fast if the destination is an uploaded Office file (not a native Sheet)
  // or the Sheets credentials/ID are misconfigured.
  await assertNativeSheet();
  t.log('assertNativeSheet ok');

  const already = await isDuplicate(hash);
  t.log('dedup', { already, force });

  if (already && !force) {
    return {
      hash,
      comunidad: '',
      archivo: filename,
      duplicado: true,
      already,
      totalMovimientos: 0,
      ignorados: 0,
      gastos: [],
      sheetUrl,
    };
  }

  const extracto = parseSabadellText(text);
  t.log('parsed', {
    movimientos: extracto.movimientos.length,
    titular: extracto.titular?.slice(0, 40) ?? '',
  });

  if (extracto.movimientos.length === 0) {
    throw new Error('No se detectaron movimientos en el PDF (¿es un extracto del Sabadell con capa de texto?).');
  }

  const comunidad = sanitizeComunidad(extracto.titular || baseName(filename));
  const gastos = extracto.movimientos
    .filter((m) => m.importe < 0)
    .map((m) => ({ fecha: m.fecha, concepto: m.concepto, importe: m.importe }));
  const ignorados = extracto.movimientos.length - gastos.length;

  t.log('prepared', { comunidad, gastos: gastos.length, ignorados });

  return {
    hash,
    comunidad,
    archivo: filename,
    duplicado: false,
    already,
    totalMovimientos: extracto.movimientos.length,
    ignorados,
    gastos,
    sheetUrl,
  };
}

/**
 * PHASE 1 (interactive upload): the browser already extracted the text layer
 * with pdf.js, so we only receive plain text — keeping the request far below
 * Vercel's 4.5MB body limit.
 */
export async function prepareExtractoFromText(
  text: string,
  filename: string,
  force = false,
): Promise<PreparedExtracto> {
  const t = createTimer('pipeline:prepare-text');
  const hash = textHash(text);
  t.log('start', { chars: text.length, hash: hash.slice(0, 12) });
  return prepareCore(text, hash, filename, force, t);
}

/**
 * PHASE 1 (webhook): the server has the PDF bytes (fetched from Drive) and
 * extracts the text with pdf-parse.
 */
export async function prepareExtracto(
  buffer: Buffer,
  filename: string,
  force = false,
): Promise<PreparedExtracto> {
  const t = createTimer('pipeline:prepare-pdf');
  let text: string;
  try {
    text = await extractSabadellText(buffer);
  } catch (err) {
    t.error('extract', err);
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`No se pudo leer el PDF (${detail}). ¿Es un extracto PDF del Sabadell con texto?`);
  }
  const hash = textHash(text);
  t.log('start', { chars: text.length, hash: hash.slice(0, 12) });
  return prepareCore(text, hash, filename, force, t);
}

// ---------------------------------------------------------------------------
// PHASE 3 — write the classified expenses into the community tab.
// Ensures the tab (copies template if needed), maps each expense to its
// (code row x month column) cell (accumulating), sends unmatched ones to
// "Pendiente Revision", records the hash. Never creates rows. Returns a
// SabProcessResult (with .error set) rather than throwing.
// ---------------------------------------------------------------------------
export async function applyClassifiedGastos(input: {
  comunidad: string;
  hash: string;
  archivo: string;
  already: boolean;
  totalMovimientos: number;
  ignorados: number;
  gastos: ClassifiedGasto[];
}): Promise<SabProcessResult> {
  const t = createTimer('pipeline:apply');
  const sheetUrl = getSheetUrl();

  const base: SabProcessResult = {
    comunidad: input.comunidad,
    archivo: input.archivo,
    tabCreada: false,
    duplicado: false,
    totalMovimientos: input.totalMovimientos,
    ignorados: input.ignorados,
    celdasActualizadas: 0,
    updates: [],
    pendientes: [],
    totalesPorCategoria: [],
    totalesPorMes: [],
    sheetUrl,
  };

  let ignorados = input.ignorados;

  try {
    // --- Ensure the community tab (copy template if needed) ---
    const ensured = await ensureCommunityTab(input.comunidad);
    t.log('ensureTab', { comunidad: input.comunidad, created: ensured.created });

    // --- Read the tab and resolve its layout ---
    const grid = await getGrid(input.comunidad, 'UNFORMATTED_VALUE');
    const monthRow = findMonthRowIndex(grid);
    const monthCols = monthRow >= 0 ? monthColumnMap(grid[monthRow]) : new Map<string, number>();
    const codeRows = monthRow >= 0 ? codeRowMap(grid, monthRow + 1) : new Map<string, number>();
    t.log('grid', { rows: grid.length, monthRow, months: monthCols.size, codes: codeRows.size });

    // Running cell values so repeated concepts in the same month accumulate.
    const running = new Map<string, number>();
    const currentCell = (r: number, c: number): number => {
      const key = `${r},${c}`;
      if (running.has(key)) return running.get(key) as number;
      return toNumber(grid[r]?.[c]);
    };

    const updates: CeldaUpdate[] = [];
    const cellWrites = new Map<string, { a1: string; value: number }>();
    const pendientes: PendienteItem[] = [];

    // --- Map each expense to a cell (or to pending review) ---
    for (const g of input.gastos) {
      const raw = (g.codigo ?? '').trim();
      const importeAbs = Math.abs(g.importe);

      if (raw.toUpperCase() === 'IGNORAR') {
        ignorados += 1;
        continue;
      }

      const code = normalizeCode(raw);
      const mm = monthOf(g.fecha);
      const catalan = mm ? calendarMonthToCatalan(mm) : null;

      if (!code || !catalan) {
        pendientes.push({
          fecha: g.fecha,
          concepto: g.concepto,
          importe: g.importe,
          comunidad: input.comunidad,
          sugerencia: !code ? `Sin código (Claude: "${raw || 'sin respuesta'}")` : 'Mes no reconocido',
        });
        continue;
      }

      const row = codeRows.get(code);
      const col = monthCols.get(normalizeKey(catalan));
      if (row === undefined || col === undefined) {
        pendientes.push({
          fecha: g.fecha,
          concepto: g.concepto,
          importe: g.importe,
          comunidad: input.comunidad,
          sugerencia: `Código ${code} (${codeDescripcion(code)}) o mes ${catalan} no encontrado en la pestaña`,
        });
        continue;
      }

      const anterior = currentCell(row, col);
      const nueva = anterior + importeAbs;
      running.set(`${row},${col}`, nueva);
      const a1 = cellA1(input.comunidad, row, col);
      cellWrites.set(a1, { a1, value: nueva });

      updates.push({
        concepto: g.concepto,
        codigo: code,
        categoria: codeDescripcion(code),
        mes: catalan,
        importe: importeAbs,
        celdaAnterior: anterior,
        celdaNueva: nueva,
        celda: `${colToLetter(col)}${row + 1}`,
      });
    }

    // --- Write everything ---
    await applyCellUpdates([...cellWrites.values()]);
    t.log('applyCellUpdates', { celdas: cellWrites.size });

    if (pendientes.length > 0) {
      await appendPendiente(
        pendientes.map((p) => [p.fecha, p.concepto, p.importe, p.comunidad, p.sugerencia]),
      );
      t.log('appendPendiente', { n: pendientes.length });
    }

    if (!input.already) {
      await recordHash(input.hash, input.archivo, new Date().toISOString());
      t.log('recordHash');
    }

    // --- Totals for the summary ---
    const totalesPorCategoria = aggregate(updates, (u) => u.categoria);
    const totalesPorMes = aggregate(updates, (u) => u.mes);

    t.log('done', { celdas: cellWrites.size, pendientes: pendientes.length, ignorados });

    return {
      ...base,
      tabCreada: ensured.created,
      celdasActualizadas: cellWrites.size,
      ignorados,
      updates,
      pendientes,
      totalesPorCategoria: totalesPorCategoria.map(([categoria, total]) => ({ categoria, total })),
      totalesPorMes: totalesPorMes.map(([mes, total]) => ({ mes, total })),
    };
  } catch (err) {
    t.error('apply', err);
    const message = err instanceof Error ? err.message : 'Error actualizando Google Sheets';
    return { ...base, ignorados, error: message };
  }
}

/**
 * All-in-one: parse -> classify -> apply. Used by the Drive webhook (server to
 * server, single call). The interactive upload uses the phased endpoints
 * instead so no single request exceeds Vercel's 10s hobby limit.
 */
export async function processSabadellPdf(
  buffer: Buffer,
  filename: string,
  options: { force?: boolean } = {},
): Promise<SabProcessResult> {
  let prepared: PreparedExtracto;
  try {
    prepared = await prepareExtracto(buffer, filename, options.force ?? false);
  } catch (err) {
    console.error('[pipeline] Error preparando el extracto:', err);
    const message = err instanceof Error ? err.message : 'No se pudo leer el PDF';
    return { ...emptyResult(filename), error: message };
  }

  if (prepared.duplicado) {
    return { ...emptyResult(filename), comunidad: prepared.comunidad, duplicado: true };
  }

  const codigos = await classifyConceptos(prepared.gastos.map((g) => g.concepto));
  const gastos: ClassifiedGasto[] = prepared.gastos.map((g, i) => ({
    ...g,
    codigo: (codigos[i] ?? '').trim(),
  }));

  return applyClassifiedGastos({
    comunidad: prepared.comunidad,
    hash: prepared.hash,
    archivo: filename,
    already: prepared.already,
    totalMovimientos: prepared.totalMovimientos,
    ignorados: prepared.ignorados,
    gastos,
  });
}

function aggregate(updates: CeldaUpdate[], key: (u: CeldaUpdate) => string): [string, number][] {
  const map = new Map<string, number>();
  for (const u of updates) {
    map.set(key(u), (map.get(key(u)) ?? 0) + u.importe);
  }
  return Array.from(map.entries())
    .map(([k, v]) => [k, Math.round(v * 100) / 100] as [string, number])
    .sort((a, b) => b[1] - a[1]);
}
