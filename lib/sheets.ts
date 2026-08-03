import { google, type sheets_v4 } from 'googleapis';
import {
  isMonthHeader,
  findMonthRowIndex,
  normalizeKey,
  colToLetter,
} from './codes';

export const TEMPLATE_SHEET = '48 ESC';
export const PENDIENTE_SHEET = 'Pendiente Revision';
const PROCESADOS_SHEET = '_Procesados';
export const COMUNIDADES_SHEET = '_Comunidades';

export const PENDIENTE_HEADERS = ['fecha', 'concepto', 'importe', 'comunidad', 'sugerencia'];
const PROCESADOS_HEADERS = ['hash', 'archivo', 'fecha_proceso'];
const COMUNIDADES_HEADERS = ['titular', 'pestaña'];

// Tabs that are never community tabs (relevant when client & system share a
// spreadsheet via the single-var fallback). The template is a real community.
export const SYSTEM_SHEETS = new Set([PENDIENTE_SHEET, PROCESADOS_SHEET, COMUNIDADES_SHEET]);

// ---------------------------------------------------------------------------
// Spreadsheet IDs — two documents:
//   CLIENTE  -> community tabs where expense cells are updated (+ template)
//   SISTEMA  -> bookkeeping tabs (_Procesados, Pendiente Revision, _Comunidades)
// Falls back to the legacy single GOOGLE_SHEETS_ID when the split vars are unset.
// ---------------------------------------------------------------------------

function getClientId(): string {
  const id = process.env.GOOGLE_SHEETS_ID_CLIENTE || process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error('GOOGLE_SHEETS_ID_CLIENTE no configurado');
  return id;
}

function getSystemId(): string {
  const id =
    process.env.GOOGLE_SHEETS_ID_SISTEMA ||
    process.env.GOOGLE_SHEETS_ID_CLIENTE ||
    process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error('GOOGLE_SHEETS_ID_SISTEMA no configurado');
  return id;
}

// ---------------------------------------------------------------------------
// Auth / client
// ---------------------------------------------------------------------------

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY no configurados');
  }
  return new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

let sheetsClient: sheets_v4.Sheets | null = null;
function getSheets(): sheets_v4.Sheets {
  if (!sheetsClient) {
    sheetsClient = google.sheets({ version: 'v4', auth: getAuth() });
  }
  return sheetsClient;
}

// ---------------------------------------------------------------------------
// Error mapping / retry
// ---------------------------------------------------------------------------

/** Collects the human-readable message(s) from a googleapis/Error object. */
function errorText(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error && err.message) parts.push(err.message);
  const anyErr = err as {
    response?: { data?: { error?: { message?: string } } };
    errors?: { message?: string }[];
  } | null;
  try {
    const apiMsg = anyErr?.response?.data?.error?.message;
    if (apiMsg) parts.push(String(apiMsg));
    if (Array.isArray(anyErr?.errors)) {
      parts.push(anyErr!.errors.map((e) => e?.message ?? '').join(' '));
    }
  } catch {
    // ignore
  }
  return parts.join(' | ');
}

/** True when the destination file is an uploaded Office (.xls/.xlsx) file. */
function isOfficeFileError(err: unknown): boolean {
  return /must not be an Office file|not supported for this document/i.test(errorText(err));
}

/** Maps low-level Sheets errors to a clear, user-facing message. */
function friendlySheetsError(err: unknown): Error {
  if (isOfficeFileError(err)) {
    return new Error(
      'El documento de destino debe ser un Google Sheet nativo, no un archivo Excel subido a Drive. ' +
        'Ábrelo en Google Drive → Archivo → Guardar como Google Sheets.',
    );
  }
  return err instanceof Error ? err : new Error(errorText(err) || 'Error de Google Sheets');
}

/** Retries a Google Sheets operation up to `retries` times with backoff. */
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // An Office-file destination is a permanent misconfiguration; don't retry.
      if (isOfficeFileError(err)) break;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
  }
  throw friendlySheetsError(lastErr);
}

/** Quotes a sheet title for use in an A1 range. */
function quoteRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

/** Builds an absolute A1 range for a single cell (0-based row/col). */
export function cellA1(title: string, row0: number, col0: number): string {
  return `${quoteRange(title)}!${colToLetter(col0)}${row0 + 1}`;
}

// ---------------------------------------------------------------------------
// Low-level reads (parametrized by spreadsheet id)
// ---------------------------------------------------------------------------

type RenderOption = 'UNFORMATTED_VALUE' | 'FORMULA' | 'FORMATTED_VALUE';

async function metaOf(spreadsheetId: string): Promise<{ title: string; sheetId: number }[]> {
  const res = await withRetry(() =>
    getSheets().spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties(sheetId,title)',
    }),
  );
  return (res.data.sheets ?? [])
    .map((s) => ({ title: s.properties?.title ?? '', sheetId: s.properties?.sheetId ?? -1 }))
    .filter((s) => s.title !== '' && s.sheetId >= 0);
}

async function titlesOf(spreadsheetId: string): Promise<string[]> {
  return (await metaOf(spreadsheetId)).map((s) => s.title);
}

async function gridOf(
  spreadsheetId: string,
  title: string,
  render: RenderOption,
): Promise<unknown[][]> {
  const res = await withRetry(() =>
    getSheets().spreadsheets.values.get({
      spreadsheetId,
      range: quoteRange(title),
      valueRenderOption: render,
    }),
  );
  return (res.data.values ?? []) as unknown[][];
}

async function valuesOf(spreadsheetId: string, range: string): Promise<string[][]> {
  const res = await withRetry(() =>
    getSheets().spreadsheets.values.get({ spreadsheetId, range }),
  );
  return (res.data.values ?? []) as string[][];
}

/** Ensures a (system) tab exists with the given header row. */
async function ensureTabIn(spreadsheetId: string, title: string, headers: string[]): Promise<void> {
  const titles = await titlesOf(spreadsheetId);
  if (!titles.includes(title)) {
    await withRetry(() =>
      getSheets().spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title } } }] },
      }),
    );
  }
  const first = await withRetry(() =>
    getSheets().spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteRange(title)}!A1:A1`,
    }),
  );
  if ((first.data.values?.[0]?.length ?? 0) === 0) {
    await withRetry(() =>
      getSheets().spreadsheets.values.update({
        spreadsheetId,
        range: `${quoteRange(title)}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Public reads (CLIENT sheet)
// ---------------------------------------------------------------------------

/** Community tab titles in the CLIENT sheet. */
export async function getSheetTitles(): Promise<string[]> {
  return titlesOf(getClientId());
}

/** Reads a whole tab of the CLIENT sheet as a 2D array. */
export async function getGrid(
  title: string,
  render: RenderOption = 'UNFORMATTED_VALUE',
): Promise<unknown[][]> {
  return gridOf(getClientId(), title, render);
}

/**
 * Verifies both destination sheets are native Google Sheets (not uploaded
 * .xls/.xlsx). Throws the friendly Office-file message otherwise. Fails fast
 * before any expensive work.
 */
export async function assertNativeSheet(): Promise<void> {
  const clientId = getClientId();
  await metaOf(clientId);
  const systemId = getSystemId();
  if (systemId !== clientId) await metaOf(systemId);
}

// ---------------------------------------------------------------------------
// Community tab management (CLIENT sheet: copy template / clear / header)
// ---------------------------------------------------------------------------

/**
 * Ensures a community tab exists in the CLIENT sheet. If missing, duplicates the
 * "48 ESC" template, clears its numeric values (keeping structure: codes,
 * descriptions, headers and TOTAL formulas) and writes the name into the header.
 */
export async function ensureCommunityTab(nombre: string): Promise<{ created: boolean }> {
  const clientId = getClientId();
  const meta = await metaOf(clientId);
  if (meta.some((s) => s.title === nombre)) return { created: false };

  const template = meta.find((s) => s.title === TEMPLATE_SHEET);
  if (!template) {
    throw new Error(`No se encuentra la pestaña plantilla "${TEMPLATE_SHEET}" en el Sheet del cliente`);
  }

  await withRetry(() =>
    getSheets().spreadsheets.batchUpdate({
      spreadsheetId: clientId,
      requestBody: {
        requests: [
          { duplicateSheet: { sourceSheetId: template.sheetId, newSheetName: nombre } },
        ],
      },
    }),
  );

  await clearTemplateValues(nombre);

  // Update the header (row 1) with the new community name.
  await withRetry(() =>
    getSheets().spreadsheets.values.update({
      spreadsheetId: clientId,
      range: `${quoteRange(nombre)}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[nombre]] },
    }),
  );

  return { created: true };
}

/** Clears numeric amounts in month columns, keeping structure/formulas/TOTAL. */
async function clearTemplateValues(title: string): Promise<void> {
  const clientId = getClientId();
  const grid = await gridOf(clientId, title, 'FORMULA');
  const monthRow = findMonthRowIndex(grid);
  if (monthRow < 0) return;

  const monthCols = (grid[monthRow] ?? [])
    .map((v, i) => (isMonthHeader(v) ? i : -1))
    .filter((i) => i >= 0);
  if (monthCols.length === 0) return;

  const ranges: string[] = [];
  for (let r = monthRow + 1; r < grid.length; r++) {
    const label = normalizeKey(`${grid[r]?.[0] ?? ''} ${grid[r]?.[1] ?? ''}`);
    if (label.includes('total')) continue; // never touch TOTAL rows
    for (const c of monthCols) {
      const v = grid[r]?.[c];
      if (v === undefined || v === null || v === '') continue;
      if (typeof v === 'string' && v.startsWith('=')) continue; // keep formulas
      ranges.push(cellA1(title, r, c));
    }
  }

  if (ranges.length === 0) return;
  await withRetry(() =>
    getSheets().spreadsheets.values.batchClear({
      spreadsheetId: clientId,
      requestBody: { ranges },
    }),
  );
}

// ---------------------------------------------------------------------------
// Cell updates (CLIENT sheet; never creates rows, only writes existing cells)
// ---------------------------------------------------------------------------

export async function applyCellUpdates(
  updates: { a1: string; value: number }[],
): Promise<void> {
  if (updates.length === 0) return;
  await withRetry(() =>
    getSheets().spreadsheets.values.batchUpdate({
      spreadsheetId: getClientId(),
      requestBody: {
        valueInputOption: 'RAW',
        data: updates.map((u) => ({ range: u.a1, values: [[u.value]] })),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Titular -> tab mapping (_Comunidades, SYSTEM sheet)
// ---------------------------------------------------------------------------

export interface ComunidadResolution {
  tab: string; // tab name to use in the CLIENT sheet
  titular: string; // original titular from the statement
  noMapeada: boolean; // true when there was no explicit mapping (pending)
}

/** Accent/case/OCR-insensitive key for matching a bank titular. */
function normalizeTitular(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Resolves the CLIENT-sheet tab for a bank titular using the _Comunidades map in
 * the SYSTEM sheet. If the titular is not mapped, records a pending row
 * (titular -> blank) and returns `noMapeada: true` with the fallback tab so the
 * caller can still process (and warn the user).
 */
export async function resolveComunidadTab(
  titular: string,
  fallbackTab: string,
): Promise<ComunidadResolution> {
  const systemId = getSystemId();
  try {
    await ensureTabIn(systemId, COMUNIDADES_SHEET, COMUNIDADES_HEADERS);
    const rows = await valuesOf(systemId, `${quoteRange(COMUNIDADES_SHEET)}!A2:B`);
    const key = normalizeTitular(titular);

    let hasRow = false;
    for (const r of rows) {
      const a = r[0] ?? '';
      const b = (r[1] ?? '').trim();
      if (normalizeTitular(a) === key) {
        hasRow = true;
        if (b) return { tab: b, titular, noMapeada: false };
      }
    }

    // Not mapped: add a pending row (only if this titular has no row yet).
    if (!hasRow) {
      await withRetry(() =>
        getSheets().spreadsheets.values.append({
          spreadsheetId: systemId,
          range: `${quoteRange(COMUNIDADES_SHEET)}!A1`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [[titular, '']] },
        }),
      );
    }
    return { tab: fallbackTab, titular, noMapeada: true };
  } catch (err) {
    // Never block processing on a mapping hiccup; fall back to the auto tab.
    console.error('[sheets] Error resolviendo comunidad en _Comunidades:', err);
    return { tab: fallbackTab, titular, noMapeada: true };
  }
}

// ---------------------------------------------------------------------------
// Pending review, dedup, last-processed (SYSTEM sheet)
// ---------------------------------------------------------------------------

export async function appendPendiente(rows: (string | number)[][]): Promise<void> {
  if (rows.length === 0) return;
  const systemId = getSystemId();
  await ensureTabIn(systemId, PENDIENTE_SHEET, PENDIENTE_HEADERS);
  await withRetry(() =>
    getSheets().spreadsheets.values.append({
      spreadsheetId: systemId,
      range: `${quoteRange(PENDIENTE_SHEET)}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    }),
  );
}

/** Pending-review rows (fecha | concepto | importe | comunidad | sugerencia). */
export async function getPendientesRows(): Promise<string[][]> {
  const systemId = getSystemId();
  const titles = await titlesOf(systemId);
  if (!titles.includes(PENDIENTE_SHEET)) return [];
  return valuesOf(systemId, `${quoteRange(PENDIENTE_SHEET)}!A2:E`);
}

export async function isDuplicate(hash: string): Promise<boolean> {
  try {
    const systemId = getSystemId();
    await ensureTabIn(systemId, PROCESADOS_SHEET, PROCESADOS_HEADERS);
    const res = await withRetry(() =>
      getSheets().spreadsheets.values.get({
        spreadsheetId: systemId,
        range: `${quoteRange(PROCESADOS_SHEET)}!A2:A`,
      }),
    );
    return (res.data.values ?? []).some((r) => r[0] === hash);
  } catch (err) {
    console.error('[sheets] Error comprobando duplicados:', err);
    return false; // fail open
  }
}

export async function recordHash(
  hash: string,
  archivo: string,
  fechaProceso: string,
): Promise<void> {
  const systemId = getSystemId();
  await ensureTabIn(systemId, PROCESADOS_SHEET, PROCESADOS_HEADERS);
  await withRetry(() =>
    getSheets().spreadsheets.values.append({
      spreadsheetId: systemId,
      range: `${quoteRange(PROCESADOS_SHEET)}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[hash, archivo, fechaProceso]] },
    }),
  );
}

export async function getUltimoProcesado(): Promise<{
  archivo: string;
  fecha: string;
} | null> {
  try {
    const systemId = getSystemId();
    const titles = await titlesOf(systemId);
    if (!titles.includes(PROCESADOS_SHEET)) return null;
    const rows = await valuesOf(systemId, `${quoteRange(PROCESADOS_SHEET)}!A2:C`);
    let latest: { archivo: string; fecha: string } | null = null;
    for (const r of rows) {
      const fecha = r[2];
      if (!fecha) continue;
      if (!latest || new Date(fecha).getTime() > new Date(latest.fecha).getTime()) {
        latest = { archivo: r[1] || '', fecha };
      }
    }
    return latest;
  } catch (err) {
    console.error('[sheets] Error leyendo último procesado:', err);
    return null;
  }
}

/** URL of the CLIENT data sheet (for the dashboard link). */
export function getSheetUrl(): string {
  const id = process.env.GOOGLE_SHEETS_ID_CLIENTE || process.env.GOOGLE_SHEETS_ID || '';
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}
