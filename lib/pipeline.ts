import crypto from 'crypto';
import { parseSabadellPdf, monthOf } from './sabadell';
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
import type { SabProcessResult, CeldaUpdate, PendienteItem } from './types';

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

/**
 * Processes a Banco Sabadell PDF against the template Sheet:
 *   PDF -> movements -> classify concepts to codes -> update the matching
 *   (code row x month column) cell in the community tab (accumulating), or send
 *   unidentified movements to "Pendiente Revision". Never creates new rows.
 */
export async function processSabadellPdf(
  buffer: Buffer,
  filename: string,
  options: { force?: boolean } = {},
): Promise<SabProcessResult> {
  const sheetUrl = getSheetUrl();

  const base: SabProcessResult = {
    comunidad: '',
    archivo: filename,
    tabCreada: false,
    duplicado: false,
    totalMovimientos: 0,
    ignorados: 0,
    celdasActualizadas: 0,
    updates: [],
    pendientes: [],
    totalesPorCategoria: [],
    totalesPorMes: [],
    sheetUrl,
  };

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');

  // Duplicate detection (sums into cells, so re-processing must be explicit).
  const already = await isDuplicate(hash);
  if (already && !options.force) {
    return { ...base, duplicado: true };
  }

  // --- 1. Read the PDF ---
  let extracto;
  try {
    extracto = await parseSabadellPdf(buffer);
  } catch (err) {
    console.error('[pipeline] Error leyendo PDF:', err);
    return { ...base, error: 'No se pudo leer el PDF. ¿Es un extracto PDF del Sabadell con texto?' };
  }

  const comunidad = sanitizeComunidad(extracto.titular || baseName(filename));
  base.comunidad = comunidad;
  base.totalMovimientos = extracto.movimientos.length;

  if (extracto.movimientos.length === 0) {
    return { ...base, error: 'No se detectaron movimientos en el PDF.' };
  }

  // --- 2. Split expenses (negative) from income (positive => IGNORAR) ---
  const gastos = extracto.movimientos.filter((m) => m.importe < 0);
  let ignorados = extracto.movimientos.length - gastos.length;

  // --- 3. Classify each expense concept into a code ---
  const codigos = await classifyConceptos(gastos.map((g) => g.concepto));

  try {
    // --- 4. Ensure the community tab (copy template if needed) ---
    const ensured = await ensureCommunityTab(comunidad);
    const tabCreada = ensured.created;

    // --- 5. Read the tab and resolve its layout ---
    const grid = await getGrid(comunidad, 'UNFORMATTED_VALUE');
    const monthRow = findMonthRowIndex(grid);
    const monthCols = monthRow >= 0 ? monthColumnMap(grid[monthRow]) : new Map<string, number>();
    const codeRows = monthRow >= 0 ? codeRowMap(grid, monthRow + 1) : new Map<string, number>();

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

    // --- 6. Map each expense to a cell (or to pending review) ---
    for (let i = 0; i < gastos.length; i++) {
      const g = gastos[i];
      const raw = (codigos[i] ?? '').trim();
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
          comunidad,
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
          comunidad,
          sugerencia: `Código ${code} (${codeDescripcion(code)}) o mes ${catalan} no encontrado en la pestaña`,
        });
        continue;
      }

      const anterior = currentCell(row, col);
      const nueva = anterior + importeAbs;
      running.set(`${row},${col}`, nueva);
      const a1 = cellA1(comunidad, row, col);
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

    // --- 7. Write everything ---
    await applyCellUpdates([...cellWrites.values()]);

    if (pendientes.length > 0) {
      await appendPendiente(
        pendientes.map((p) => [p.fecha, p.concepto, p.importe, p.comunidad, p.sugerencia]),
      );
    }

    if (!already) {
      await recordHash(hash, filename, new Date().toISOString());
    }

    // --- 8. Totals for the summary ---
    const totalesPorCategoria = aggregate(updates, (u) => u.categoria);
    const totalesPorMes = aggregate(updates, (u) => u.mes);

    return {
      ...base,
      tabCreada,
      celdasActualizadas: cellWrites.size,
      ignorados,
      updates,
      pendientes,
      totalesPorCategoria: totalesPorCategoria.map(([categoria, total]) => ({ categoria, total })),
      totalesPorMes: totalesPorMes.map(([mes, total]) => ({ mes, total })),
    };
  } catch (err) {
    console.error('[pipeline] Error actualizando el Sheet:', err);
    const message = err instanceof Error ? err.message : 'Error actualizando Google Sheets';
    return { ...base, ignorados, error: message };
  }
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
