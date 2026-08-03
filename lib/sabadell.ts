export interface SabMovimiento {
  fecha: string; // F.Operativa, DD/MM/YYYY
  concepto: string;
  importe: number; // signed (negative = gasto)
}

export interface SabExtracto {
  titular: string;
  cuenta?: string;
  periodo?: { desde: string; hasta: string };
  movimientos: SabMovimiento[];
}

// OCR-tolerant "digit": a real digit or a character OCR commonly confuses for a
// digit (l/I->1, O->0, S->5, B->8, etc.). No whitespace in this class.
const OCR_DIGIT = String.raw`\dOoQDlIij|!ZzSsBGbgq`;
// A date with 2-2-4 digits, tolerating OCR digit confusions and / - . separators.
const DATE = String.raw`[${OCR_DIGIT}]{2}[/\-.][${OCR_DIGIT}]{2}[/\-.][${OCR_DIGIT}]{4}`;
// A loose amount ending in two decimals (comma or dot), with an optional sign.
const LOOSE_AMOUNT = String.raw`[-–—+]?[${OCR_DIGIT}][${OCR_DIGIT}.,]*[.,]\d{2}`;

/** Maps OCR letter-confusions to digits (used inside numeric tokens only). */
function ocrToDigits(s: string): string {
  return s
    .replace(/[OoQD]/g, '0')
    .replace(/[lIij|!]/g, '1')
    .replace(/[Zz]/g, '2')
    .replace(/[Ss]/g, '5')
    .replace(/[Gb]/g, '6')
    .replace(/B/g, '8')
    .replace(/[gq]/g, '9');
}

/** Normalizes an OCR date token to DD/MM/YYYY (slashes). Returns '' if invalid. */
function normalizeDate(raw: string): string {
  const parts = raw.split(/[/\-.]/).map((p) => ocrToDigits(p).replace(/\D/g, ''));
  if (parts.length !== 3) return '';
  const [d, m, y] = parts;
  if (d.length !== 2 || m.length !== 2 || y.length !== 4) return '';
  return `${d}/${m}/${y}`;
}

/**
 * Parses a possibly OCR-mangled amount ("l.23S,40", "-45.60", "1.234,56") into a
 * number. The last comma/dot before the final two digits is the decimal
 * separator; the rest are thousands separators.
 */
export function parseLooseAmount(raw: string): number {
  let s = raw.trim();
  const negative = /^[-–—]/.test(s);
  s = s.replace(/^[-–—+]/, '');
  s = ocrToDigits(s).replace(/[^\d.,]/g, '');
  const decPos = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (decPos === -1) return NaN;
  const intPart = s.slice(0, decPos).replace(/[.,]/g, '');
  const decPart = s.slice(decPos + 1).replace(/\D/g, '');
  if (!decPart) return NaN;
  const value = parseFloat(`${intPart || '0'}.${decPart}`);
  if (Number.isNaN(value)) return NaN;
  return negative ? -value : value;
}

/** Extracts the first loose amount (with its sign) from a tail string. */
function firstAmount(tail: string): number {
  const m = tail.match(new RegExp(LOOSE_AMOUNT));
  return m ? parseLooseAmount(m[0]) : NaN;
}

function extractTitular(text: string): string {
  // Tolerate OCR variants of "Titular" (T1tular, Titolar, …).
  const m = text.match(/T[il1|]t[uo]l[ae]r\s*:?\s*([^\n\r]+)/i);
  return m ? m[1].trim() : '';
}

function extractCuenta(text: string): string | undefined {
  const m = text.match(/Cuenta\s*:?\s*([\dxX][\dxX\-\s.]{6,})/i);
  return m ? m[1].trim().replace(/\s+/g, '') : undefined;
}

function extractPeriodo(text: string): { desde: string; hasta: string } | undefined {
  const re = new RegExp(
    `Selecci[oó]n[\\s\\S]{0,40}?(${DATE})[\\s\\S]{0,20}?(${DATE})`,
    'i',
  );
  const m = text.match(re);
  if (!m) return undefined;
  const desde = normalizeDate(m[1]);
  const hasta = normalizeDate(m[2]);
  return desde && hasta ? { desde, hasta } : undefined;
}

/** True for header rows and totals that must never be treated as movements. */
function isNoiseLine(line: string): boolean {
  const k = line
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/\b(total|totals|saldo anterior|saldo inicial|suma|resum)\b/.test(k)) return true;
  // A column-header row: mentions several of the column titles but is not a movement.
  const headerHits = ['operativa', 'concepte', 'concepto', 'f.valor', 'valor', 'import', 'saldo', 'data']
    .filter((h) => k.includes(h)).length;
  return headerHits >= 2;
}

/**
 * Extracts movements. Each movement is roughly one line following the pattern:
 *   F.Operativa  CONCEPTO  F.Valor  [-]IMPORTE  SALDO  [refs]
 * Long concepts can wrap, so we group lines into blocks that start with a date.
 * The parser tolerates OCR noise: fuzzy digits, multiple spaces, and header/
 * total lines are skipped.
 */
function extractMovimientos(text: string): SabMovimiento[] {
  const rawLines = text.split(/\r?\n/);
  const startRe = new RegExp(`^\\s*${DATE}`);

  // Group wrapped lines into date-started blocks.
  const blocks: string[] = [];
  for (const line of rawLines) {
    if (!line.trim()) continue;
    if (startRe.test(line)) {
      blocks.push(line);
    } else if (blocks.length > 0 && !isNoiseLine(line)) {
      blocks[blocks.length - 1] += ' ' + line.trim();
    }
  }

  // F.Operativa  CONCEPTO  F.Valor  <tail: importe saldo ...>
  const movRe = new RegExp(`^\\s*(${DATE})\\s+(.+?)\\s+(${DATE})\\s+(.+)$`);

  const movimientos: SabMovimiento[] = [];
  for (const block of blocks) {
    const collapsed = block.replace(/\s+/g, ' ').trim();
    if (isNoiseLine(collapsed)) continue;

    const m = collapsed.match(movRe);
    if (!m) continue;

    const fecha = normalizeDate(m[1]);
    if (!fecha) continue;

    const concepto = m[2].replace(/\s+/g, ' ').trim();
    const importe = firstAmount(m[4]);
    if (!concepto || Number.isNaN(importe)) continue;

    movimientos.push({ fecha, concepto, importe });
  }

  return movimientos;
}

/** Parses the extracted text of a Sabadell statement into header + movements. */
export function parseSabadellText(text: string): SabExtracto {
  return {
    titular: extractTitular(text),
    cuenta: extractCuenta(text),
    periodo: extractPeriodo(text),
    movimientos: extractMovimientos(text),
  };
}

/**
 * Extracts the raw text layer from a Sabadell PDF (server-side, via pdf-parse).
 * Used by the Drive webhook. The interactive upload extracts text in the
 * browser with pdf.js / OCR instead (keeps the request under Vercel's 4.5MB
 * limit).
 */
export async function extractSabadellText(buf: Buffer): Promise<string> {
  // Import the internal lib path to avoid pdf-parse's debug test-file read.
  const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const data = await pdf(buf);
  return data.text ?? '';
}

/** Parses a Banco Sabadell PDF statement (native text) into header + movements. */
export async function parseSabadellPdf(buf: Buffer): Promise<SabExtracto> {
  return parseSabadellText(await extractSabadellText(buf));
}

/** Returns the calendar month (1-12) of a DD/MM/YYYY date, or null. */
export function monthOf(fecha: string): number | null {
  const m = fecha.match(/^\d{2}\/(\d{2})\/\d{4}$/);
  if (!m) return null;
  const mm = Number(m[1]);
  return mm >= 1 && mm <= 12 ? mm : null;
}
