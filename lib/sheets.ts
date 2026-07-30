import { google, type sheets_v4 } from 'googleapis';
import type { MovimientoClasificado } from './types';

export const PENDIENTE_SHEET = 'Pendiente Revision';
const PROCESADOS_SHEET = '_Procesados';

export const COMUNIDAD_HEADERS = [
  'fecha',
  'descripcion',
  'importe',
  'categoria',
  'confianza',
  'comunidad',
  'archivo_origen',
  'fecha_proceso',
];

export const PENDIENTE_HEADERS = [
  'fecha',
  'descripcion',
  'importe',
  'categoria_sugerida',
  'confianza',
  'comunidad',
  'archivo_origen',
  'fecha_proceso',
  'categoria_final',
];

const PROCESADOS_HEADERS = ['hash', 'archivo', 'fecha_proceso'];

// System tabs excluded from community aggregation.
export const SYSTEM_SHEETS = new Set([PENDIENTE_SHEET, PROCESADOS_SHEET]);

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

/** Returns the list of tab titles in the spreadsheet. */
export async function getSheetTitles(): Promise<string[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: 'sheets.properties.title',
  });
  return (res.data.sheets ?? [])
    .map((s) => s.properties?.title)
    .filter((t): t is string => Boolean(t));
}

/** Ensures a tab exists and its header row is present. */
async function ensureSheet(title: string, headers: string[]): Promise<void> {
  const sheets = getSheets();
  const spreadsheetId = getSpreadsheetId();

  const titles = await getSheetTitles();
  if (!titles.includes(title)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }

  // Write headers if the first row is empty.
  const first = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteRange(title)}!A1:A1`,
  });
  const hasHeader = (first.data.values?.[0]?.length ?? 0) > 0;
  if (!hasHeader) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteRange(title)}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
}

/** Quotes a sheet title for use in an A1 range (handles spaces/special chars). */
function quoteRange(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function appendRows(title: string, rows: (string | number)[][]): Promise<void> {
  if (rows.length === 0) return;
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${quoteRange(title)}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

/** Appends classified movements to their community tab. */
export async function writeComunidadRows(
  comunidad: string,
  movimientos: MovimientoClasificado[],
  archivo: string,
  fechaProceso: string,
): Promise<void> {
  if (movimientos.length === 0) return;
  await ensureSheet(comunidad, COMUNIDAD_HEADERS);
  const rows = movimientos.map((m) => [
    m.fecha,
    m.descripcion,
    m.importe,
    m.categoria,
    m.confianza,
    comunidad,
    archivo,
    fechaProceso,
  ]);
  await appendRows(comunidad, rows);
}

/** Appends flagged movements to the "Pendiente Revision" tab. */
export async function writePendienteRows(
  comunidad: string,
  movimientos: MovimientoClasificado[],
  archivo: string,
  fechaProceso: string,
): Promise<void> {
  if (movimientos.length === 0) return;
  await ensureSheet(PENDIENTE_SHEET, PENDIENTE_HEADERS);
  const rows = movimientos.map((m) => [
    m.fecha,
    m.descripcion,
    m.importe,
    m.categoria,
    m.confianza,
    comunidad,
    archivo,
    fechaProceso,
    'PENDIENTE',
  ]);
  await appendRows(PENDIENTE_SHEET, rows);
}

// ---------------------------------------------------------------------------
// Duplicate detection (file hashes stored in a system tab)
// ---------------------------------------------------------------------------

export async function isDuplicate(hash: string): Promise<boolean> {
  try {
    await ensureSheet(PROCESADOS_SHEET, PROCESADOS_HEADERS);
    const sheets = getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range: `${quoteRange(PROCESADOS_SHEET)}!A2:A`,
    });
    const hashes = (res.data.values ?? []).map((r) => r[0]);
    return hashes.includes(hash);
  } catch (err) {
    console.error('[sheets] Error comprobando duplicados:', err);
    return false; // fail open: better to reprocess than to lose data
  }
}

export async function recordHash(
  hash: string,
  archivo: string,
  fechaProceso: string,
): Promise<void> {
  await ensureSheet(PROCESADOS_SHEET, PROCESADOS_HEADERS);
  await appendRows(PROCESADOS_SHEET, [[hash, archivo, fechaProceso]]);
}

// ---------------------------------------------------------------------------
// Read helpers for statistics
// ---------------------------------------------------------------------------

/** Reads a single range as a 2D string array. */
export async function getValues(range: string): Promise<string[][]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range,
  });
  return (res.data.values ?? []) as string[][];
}

/** Reads many ranges in a single batch call. */
export async function batchGetValues(
  ranges: string[],
): Promise<{ range: string; values: string[][] }[]> {
  if (ranges.length === 0) return [];
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: getSpreadsheetId(),
    ranges,
  });
  return (res.data.valueRanges ?? []).map((vr) => ({
    range: vr.range ?? '',
    values: (vr.values ?? []) as string[][],
  }));
}

export function quoteSheetRange(title: string, a1: string): string {
  return `${quoteRange(title)}!${a1}`;
}

export function getSheetUrl(): string {
  const id = process.env.GOOGLE_SHEETS_ID ?? '';
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}
