import { google, type sheets_v4 } from 'googleapis';
import {
  isMonthHeader,
  findMonthRowIndex,
  monthColumnMap,
  normalizeKey,
  colToLetter,
} from './codes';

export const TEMPLATE_SHEET = '48 ESC';
export const PENDIENTE_SHEET = 'Pendiente Revision';
const PROCESADOS_SHEET = '_Procesados';

export const PENDIENTE_HEADERS = ['fecha', 'concepto', 'importe', 'comunidad', 'sugerencia'];
const PROCESADOS_HEADERS = ['hash', 'archivo', 'fecha_proceso'];

// Tabs that are never treated as community tabs.
export const SYSTEM_SHEETS = new Set([TEMPLATE_SHEET, PENDIENTE_SHEET, PROCESADOS_SHEET]);

// ---------------------------------------------------------------------------
// Auth / client
// ---------------------------------------------------------------------------

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_ID;
  if (!id) throw new Error('GOOGLE_SHEETS_ID no configurado');
  return id;
}

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

/** Retries a Google Sheets operation up to `retries` times with backoff. */
async function withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
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
// Metadata / reads
// ---------------------------------------------------------------------------

async function getSheetMeta(): Promise<{ title: string; sheetId: number }[]> {
  const res = await withRetry(() =>
    getSheets().spreadsheets.get({
      spreadsheetId: getSpreadsheetId(),
      fields: 'sheets.properties(sheetId,title)',
    }),
  );
  return (res.data.sheets ?? [])
    .map((s) => ({ title: s.properties?.title ?? '', sheetId: s.properties?.sheetId ?? -1 }))
    .filter((s) => s.title !== '' && s.sheetId >= 0);
}

export async function getSheetTitles(): Promise<string[]> {
  return (await getSheetMeta()).map((s) => s.title);
}

type RenderOption = 'UNFORMATTED_VALUE' | 'FORMULA' | 'FORMATTED_VALUE';

/** Reads a whole tab as a 2D array. */
export async function getGrid(
  title: string,
  render: RenderOption = 'UNFORMATTED_VALUE',
): Promise<unknown[][]> {
  const res = await withRetry(() =>
    getSheets().spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: quoteRange(title),
      valueRenderOption: render,
    }),
  );
  return (res.data.values ?? []) as unknown[][];
}

export async function getValues(range: string): Promise<string[][]> {
  const res = await withRetry(() =>
    getSheets().spreadsheets.values.get({ spreadsheetId: getSpreadsheetId(), range }),
  );
  return (res.data.values ?? []) as string[][];
}

// ---------------------------------------------------------------------------
// Community tab management (copy template / clear / header)
// ---------------------------------------------------------------------------

/**
 * Ensures a community tab exists. If missing, duplicates the "48 ESC" template,
 * clears its numeric values (keeping the structure: codes, descriptions,
 * headers and TOTAL formulas) and writes the community name into the header.
 */
export async function ensureCommunityTab(nombre: string): Promise<{ created: boolean }> {
  const meta = await getSheetMeta();
  if (meta.some((s) => s.title === nombre)) return { created: false };

  const template = meta.find((s) => s.title === TEMPLATE_SHEET);
  if (!template) {
    throw new Error(`No se encuentra la pestaña plantilla "${TEMPLATE_SHEET}"`);
  }

  await withRetry(() =>
    getSheets().spreadsheets.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
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
      spreadsheetId: getSpreadsheetId(),
      range: `${quoteRange(nombre)}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [[nombre]] },
    }),
  );

  return { created: true };
}

/** Clears numeric amounts in month columns, keeping structure/formulas/TOTAL. */
async function clearTemplateValues(title: string): Promise<void> {
  const grid = await getGrid(title, 'FORMULA');
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
      spreadsheetId: getSpreadsheetId(),
      requestBody: { ranges },
    }),
  );
}

// ---------------------------------------------------------------------------
// Cell updates (never creates rows; only writes existing cells)
// ---------------------------------------------------------------------------

export async function applyCellUpdates(
  updates: { a1: string; value: number }[],
): Promise<void> {
  if (updates.length === 0) return;
  await withRetry(() =>
    getSheets().spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        valueInputOption: 'RAW',
        data: updates.map((u) => ({ range: u.a1, values: [[u.value]] })),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Generic system-tab helpers, pending review, dedup
// ---------------------------------------------------------------------------

async function ensureSheet(title: string, headers: string[]): Promise<void> {
  const titles = await getSheetTitles();
  if (!titles.includes(title)) {
    await withRetry(() =>
      getSheets().spreadsheets.batchUpdate({
        spreadsheetId: getSpreadsheetId(),
        requestBody: { requests: [{ addSheet: { properties: { title } } }] },
      }),
    );
  }
  const first = await withRetry(() =>
    getSheets().spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: `${quoteRange(title)}!A1:A1`,
    }),
  );
  if ((first.data.values?.[0]?.length ?? 0) === 0) {
    await withRetry(() =>
      getSheets().spreadsheets.values.update({
        spreadsheetId: getSpreadsheetId(),
        range: `${quoteRange(title)}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [headers] },
      }),
    );
  }
}

export async function appendPendiente(rows: (string | number)[][]): Promise<void> {
  if (rows.length === 0) return;
  await ensureSheet(PENDIENTE_SHEET, PENDIENTE_HEADERS);
  await withRetry(() =>
    getSheets().spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: `${quoteRange(PENDIENTE_SHEET)}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    }),
  );
}

export async function isDuplicate(hash: string): Promise<boolean> {
  try {
    await ensureSheet(PROCESADOS_SHEET, PROCESADOS_HEADERS);
    const res = await withRetry(() =>
      getSheets().spreadsheets.values.get({
        spreadsheetId: getSpreadsheetId(),
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
  await ensureSheet(PROCESADOS_SHEET, PROCESADOS_HEADERS);
  await withRetry(() =>
    getSheets().spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
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
    const titles = await getSheetTitles();
    if (!titles.includes(PROCESADOS_SHEET)) return null;
    const rows = await getValues(`${quoteRange(PROCESADOS_SHEET)}!A2:C`);
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

export function getSheetUrl(): string {
  const id = process.env.GOOGLE_SHEETS_ID ?? '';
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}
