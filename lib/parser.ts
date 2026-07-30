import * as XLSX from 'xlsx';
import type { MovimientoRaw, ParseResult } from './types';

// ---------------------------------------------------------------------------
// Text / number normalization helpers
// ---------------------------------------------------------------------------

/** Removes diacritics and lowercases, for accent-insensitive header matching. */
function normalizeKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Decodes a buffer as UTF-8, falling back to Windows-1252 (latin-1). */
export function decodeBuffer(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/**
 * Parses a Spanish-formatted amount into a number.
 * Examples: "1.234,56" -> 1234.56, "1.234" -> 1234, "-45,00" -> -45, "(30,00)" -> -30
 */
export function parseSpanishAmount(raw: unknown): number {
  if (typeof raw === 'number') return raw;
  if (raw == null) return NaN;

  let s = String(raw).trim();
  if (!s) return NaN;

  // Detect negativity from a leading minus or accounting parentheses.
  const negative = /^-/.test(s) || /^\(.*\)$/.test(s);

  // Strip currency symbols, spaces, parentheses and signs.
  s = s.replace(/[€$\s()]/g, '').replace(/^[-+]/, '');

  if (s.includes('.') && s.includes(',')) {
    // Both separators: '.' = thousands, ',' = decimal.
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    // Only comma -> decimal separator.
    s = s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // Only dots grouped in threes -> thousands separators (e.g. "1.234").
    s = s.replace(/\./g, '');
  }

  const n = parseFloat(s);
  if (Number.isNaN(n)) return NaN;
  return negative ? -Math.abs(n) : n;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Converts an Excel serial date number to a JS Date (UTC). */
function excelSerialToDate(serial: number): Date {
  // Excel epoch starts 1899-12-30 (accounting for the 1900 leap-year bug).
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms);
}

/** Normalizes a date value (Date | number | string) to DD/MM/YYYY. */
export function formatFecha(value: unknown): string {
  if (value == null) return '';

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad2(value.getUTCDate())}/${pad2(value.getUTCMonth() + 1)}/${value.getUTCFullYear()}`;
  }

  if (typeof value === 'number' && value > 20000 && value < 60000) {
    const d = excelSerialToDate(value);
    return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }

  const s = String(value).trim();

  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  let m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    const [, d, mo, y] = m;
    const year = y.length === 2 ? `20${y}` : y;
    return `${pad2(Number(d))}/${pad2(Number(mo))}/${year}`;
  }

  // yyyy-mm-dd (ISO)
  m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${pad2(Number(d))}/${pad2(Number(mo))}/${y}`;
  }

  return s;
}

/** Cleans a description string (collapse whitespace, strip control chars). */
function cleanDescripcion(value: unknown): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Column detection
// ---------------------------------------------------------------------------

const FECHA_HEADERS = [
  'fecha',
  'date',
  'f.valor',
  'f valor',
  'fvalor',
  'fecha valor',
  'f.operacion',
  'f operacion',
  'foperacion',
  'fecha operacion',
  'fecha contable',
];

const DESC_HEADERS = [
  'concepto',
  'descripcion',
  'movimiento',
  'detalle',
  'concepto/descripcion',
  'observaciones',
  'referencia',
];

const IMPORTE_HEADERS = ['importe', 'cantidad', 'importe (eur)', 'importe eur', 'saldo importe'];
const CARGO_HEADERS = ['cargo', 'debe', 'gasto', 'pago'];
const ABONO_HEADERS = ['abono', 'haber', 'ingreso', 'cobro'];

interface ColumnMap {
  fecha: number;
  descripcion: number;
  importe: number;
  cargo: number;
  abono: number;
}

function matchColumn(header: string, candidates: string[]): boolean {
  const h = normalizeKey(header);
  return candidates.some((c) => h === c || h.includes(c));
}

function detectColumns(headerRow: unknown[]): ColumnMap | null {
  const map: ColumnMap = { fecha: -1, descripcion: -1, importe: -1, cargo: -1, abono: -1 };

  headerRow.forEach((cell, idx) => {
    const header = String(cell ?? '');
    if (!header.trim()) return;

    if (map.fecha === -1 && matchColumn(header, FECHA_HEADERS)) map.fecha = idx;
    if (map.descripcion === -1 && matchColumn(header, DESC_HEADERS)) map.descripcion = idx;
    if (map.cargo === -1 && matchColumn(header, CARGO_HEADERS)) map.cargo = idx;
    if (map.abono === -1 && matchColumn(header, ABONO_HEADERS)) map.abono = idx;
    // Match generic importe last so Cargo/Abono take precedence.
    if (map.importe === -1 && matchColumn(header, IMPORTE_HEADERS)) map.importe = idx;
  });

  const hasImporte = map.importe !== -1 || map.cargo !== -1 || map.abono !== -1;
  if (map.fecha !== -1 && hasImporte) return map;
  return null;
}

/** Finds the header row (banks often prepend title/summary rows) and its columns. */
function findHeader(rows: unknown[][]): { index: number; columns: ColumnMap } | null {
  const limit = Math.min(rows.length, 25);
  for (let i = 0; i < limit; i++) {
    const columns = detectColumns(rows[i]);
    if (columns) return { index: i, columns };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row -> movement mapping
// ---------------------------------------------------------------------------

function rowsToMovimientos(rows: unknown[][], columns: ColumnMap): MovimientoRaw[] {
  const movimientos: MovimientoRaw[] = [];

  for (const row of rows) {
    const fecha = formatFecha(row[columns.fecha]);
    if (!fecha) continue;

    const descripcion =
      columns.descripcion !== -1 ? cleanDescripcion(row[columns.descripcion]) : '';

    let importe = NaN;
    if (columns.cargo !== -1 || columns.abono !== -1) {
      // Separate debit/credit columns: importe = abono - cargo.
      const cargoRaw = columns.cargo !== -1 ? parseSpanishAmount(row[columns.cargo]) : 0;
      const abonoRaw = columns.abono !== -1 ? parseSpanishAmount(row[columns.abono]) : 0;
      const cargo = Number.isNaN(cargoRaw) ? 0 : Math.abs(cargoRaw);
      const abono = Number.isNaN(abonoRaw) ? 0 : Math.abs(abonoRaw);
      importe = abono - cargo;
    } else {
      importe = parseSpanishAmount(row[columns.importe]);
    }

    if (Number.isNaN(importe) || importe === 0) continue;

    movimientos.push({ fecha, descripcion, importe });
  }

  return movimientos;
}

// ---------------------------------------------------------------------------
// Budget (presupuesto) format
// ---------------------------------------------------------------------------

/** Result of parsing a table: movements plus an optional community override. */
interface FormatResult {
  movimientos: MovimientoRaw[];
  comunidad?: string;
}

// Month-name stems (Catalan/Spanish, accent-stripped) -> month number (1-12).
const MONTH_STEMS: { month: number; stems: string[] }[] = [
  { month: 1, stems: ['gener', 'gen', 'enero', 'ene', 'jan'] },
  { month: 2, stems: ['febrer', 'febr', 'feb', 'febrero'] },
  { month: 3, stems: ['marc', 'mar', 'marzo'] },
  { month: 4, stems: ['abril', 'abr'] },
  { month: 5, stems: ['maig', 'mai', 'mayo', 'may'] },
  { month: 6, stems: ['juny', 'jun', 'junio'] },
  { month: 7, stems: ['juliol', 'jul', 'julio'] },
  { month: 8, stems: ['agost', 'agosto', 'ago', 'ag', 'aug'] },
  { month: 9, stems: ['setembre', 'sept', 'set', 'sep', 'septiembre'] },
  { month: 10, stems: ['octubre', 'oct'] },
  { month: 11, stems: ['novembre', 'noviembre', 'nov'] },
  { month: 12, stems: ['desembre', 'diciembre', 'des', 'dez', 'dec', 'dic'] },
];

const BUDGET_SKIP_DESC = new Set([
  'total',
  'totals',
  'totales',
  'total anual',
  'suma',
  'sumes',
  'sumas',
  'saldo',
]);

/** Maps a header cell to a month number (1-12), or null if it is not a month. */
function monthNameToNumber(header: string): number | null {
  const h = normalizeKey(header).replace(/[.\s]+$/, '');
  if (!h) return null;
  for (const { month, stems } of MONTH_STEMS) {
    for (const stem of stems) {
      // Exact match, or a close abbreviation prefix. The length guard prevents
      // long non-month words (e.g. "setmana") from matching a short stem ("set").
      if (h === stem || (h.startsWith(stem) && h.length <= stem.length + 2)) {
        return month;
      }
    }
  }
  return null;
}

/** Finds the month columns in a header row: [{ col, month }] (distinct months). */
function detectMonthColumns(row: unknown[]): { col: number; month: number }[] {
  const out: { col: number; month: number }[] = [];
  const seen = new Set<number>();
  row.forEach((cell, idx) => {
    const month = monthNameToNumber(String(cell ?? ''));
    if (month && !seen.has(month)) {
      seen.add(month);
      out.push({ col: idx, month });
    }
  });
  return out;
}

/** Extracts the fiscal-year start (minimum year) from row 0 and the filename. */
function extractStartYear(rows: unknown[][], filename: string): number {
  const header = (rows[0] ?? []).map((c) => String(c ?? '')).join(' ');
  const text = `${header} ${filename}`;
  const years: number[] = [];
  const re = /(19|20)\d{2}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) years.push(Number(m[0]));
  if (years.length > 0) return Math.min(...years);
  return new Date().getFullYear();
}

/** Assigns a year to each month column, rolling over when the month wraps past December. */
function assignYears(months: number[], startYear: number): number[] {
  const years: number[] = [];
  let year = startYear;
  for (let i = 0; i < months.length; i++) {
    if (i > 0 && months[i] < months[i - 1]) year++;
    years.push(year);
  }
  return years;
}

/** Picks the description cell for a budget row (last non-numeric text before the months). */
function pickDescripcion(row: unknown[], firstMonthCol: number): string {
  for (let c = firstMonthCol - 1; c >= 0; c--) {
    const v = row[c];
    if (v == null || String(v).trim() === '') continue;
    if (typeof v === 'number') continue; // numeric category code
    const s = cleanDescripcion(v);
    if (s && !/^\d+([.,]\d+)?$/.test(s)) return s;
  }
  return '';
}

/** Community name from row 0 (column 1, falling back to the first text cell). */
function extractBudgetComunidad(rows: unknown[][]): string {
  const row0 = rows[0] ?? [];
  const preferred = cleanDescripcion(row0[1]);
  if (preferred && !/^\d+$/.test(preferred)) return preferred;
  for (const cell of row0) {
    const s = cleanDescripcion(cell);
    if (s && !/^\d+$/.test(s)) return s;
  }
  return '';
}

/**
 * Detects and parses the annual-budget-by-category format:
 *   row 0: community + period; row 1: month headers; rows 2+: one category per
 *   row with a monthly amount per column. Emits one (negative, = expense)
 *   movement per month that has an amount, dated to the first day of that month.
 * Returns null if the table is not in budget format.
 */
function tryParseBudget(rows: unknown[][], filename: string): FormatResult | null {
  let headerIdx = -1;
  let monthCols: { col: number; month: number }[] = [];

  const limit = Math.min(rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const cols = detectMonthColumns(rows[i]);
    if (cols.length >= 6) {
      headerIdx = i;
      monthCols = cols;
      break;
    }
  }
  if (headerIdx === -1) return null;

  const years = assignYears(
    monthCols.map((c) => c.month),
    extractStartYear(rows, filename),
  );
  const firstMonthCol = monthCols[0].col;
  const comunidad = extractBudgetComunidad(rows);

  const movimientos: MovimientoRaw[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    const descripcion = pickDescripcion(row, firstMonthCol);
    if (!descripcion) continue;
    if (BUDGET_SKIP_DESC.has(normalizeKey(descripcion))) continue;

    for (let k = 0; k < monthCols.length; k++) {
      const value = parseSpanishAmount(row[monthCols[k].col]);
      if (Number.isNaN(value) || value === 0) continue;
      const fecha = `01/${pad2(monthCols[k].month)}/${years[k]}`;
      movimientos.push({ fecha, descripcion, importe: -Math.abs(value) });
    }
  }

  return { movimientos, comunidad: comunidad || undefined };
}

/**
 * Normalizes a raw table into movements, auto-detecting the format:
 *   - month columns present  -> annual budget (presupuesto)
 *   - fecha/importe columns   -> standard bank statement
 */
function normalizeTable(rows: unknown[][], filename: string): FormatResult {
  const budget = tryParseBudget(rows, filename);
  if (budget) return budget;

  const header = findHeader(rows);
  if (!header) return { movimientos: [] };
  return {
    movimientos: rowsToMovimientos(rows.slice(header.index + 1), header.columns),
  };
}

// ---------------------------------------------------------------------------
// Per-format parsers
// ---------------------------------------------------------------------------

function parseXlsx(buf: Buffer, filename: string): FormatResult {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  // Always use the first sheet (index 0), per spec.
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return { movimientos: [] };

  const ws = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });

  return normalizeTable(rows, filename);
}

/** Detects the delimiter (',' or ';') from the header/first line. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

/** A small CSV parser handling quoted values and embedded delimiters/newlines. */
function parseCsvText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\r') {
      // Ignore; handled by the following \n (or trailing).
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function parseCsv(buf: Buffer, filename: string): FormatResult {
  const text = decodeBuffer(buf);
  const delimiter = detectDelimiter(text);
  const rows = parseCsvText(text, delimiter);
  return normalizeTable(rows, filename);
}

const PDF_DATE_RE = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;
const PDF_AMOUNT_RE = /(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}|-?\d+\.\d{2})\s*€?\s*$/;

async function parsePdf(buf: Buffer): Promise<MovimientoRaw[]> {
  // Import the internal lib path to avoid pdf-parse's debug test-file read.
  const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const data = await pdf(buf);
  const lines = data.text.split(/\r?\n/);

  const movimientos: MovimientoRaw[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const dateMatch = trimmed.match(PDF_DATE_RE);
    const amountMatch = trimmed.match(PDF_AMOUNT_RE);
    if (!dateMatch || !amountMatch) continue;

    const importe = parseSpanishAmount(amountMatch[1]);
    if (Number.isNaN(importe) || importe === 0) continue;

    const fecha = formatFecha(dateMatch[0]);
    const descripcion = cleanDescripcion(
      trimmed.replace(dateMatch[0], '').replace(amountMatch[0], ''),
    );

    movimientos.push({ fecha, descripcion, importe });
  }

  return movimientos;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Derives the community name from a filename: ComunidadRosas_20240115.xls -> ComunidadRosas */
export function comunidadFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, ''); // strip extension
  const first = base.split('_')[0].trim();
  return first || 'SinComunidad';
}

/** Sanitizes a community name for use as a Google Sheets tab title. */
export function sanitizeComunidad(name: string): string {
  const cleaned = name
    .replace(/[:\\/?*\[\]]/g, ' ') // characters not allowed in Sheets tab titles
    .replace(/\s+/g, ' ')
    .replace(/^'+|'+$/g, '')
    .trim()
    .slice(0, 90);
  return cleaned || 'SinComunidad';
}

function extensionOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/**
 * Parses a file buffer into a normalized list of movements plus the derived
 * community name. Supports XLS/XLSX, CSV and PDF, auto-detecting the standard
 * bank-statement layout vs the annual-budget-by-category layout.
 *
 * The community comes from inside the file for budgets (row 0, column 1) and
 * falls back to the filename otherwise.
 */
export async function parseFile(buf: Buffer, filename: string): Promise<ParseResult> {
  const ext = extensionOf(filename);
  let result: FormatResult = { movimientos: [] };

  if (ext === 'xls' || ext === 'xlsx' || ext === 'xlsm') {
    result = parseXlsx(buf, filename);
  } else if (ext === 'csv' || ext === 'txt') {
    result = parseCsv(buf, filename);
  } else if (ext === 'pdf') {
    result = { movimientos: await parsePdf(buf) };
  } else {
    // Unknown extension: try XLSX first (binary), then CSV (text).
    try {
      result = parseXlsx(buf, filename);
    } catch {
      result = parseCsv(buf, filename);
    }
  }

  const comunidad = sanitizeComunidad(result.comunidad || comunidadFromFilename(filename));
  return { comunidad, archivo: filename, movimientos: result.movimientos };
}
