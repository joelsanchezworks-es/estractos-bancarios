import { parseSpanishAmount } from './parser';

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

const DATE = String.raw`\d{2}\/\d{2}\/\d{4}`;
// Spanish-formatted amount with 2 decimals, optional leading sign.
const AMOUNT = String.raw`[+-]?\d{1,3}(?:\.\d{3})*,\d{2}`;

function extractTitular(text: string): string {
  const m = text.match(/Titular\s*:?\s*([^\n\r]+)/i);
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
  return m ? { desde: m[1], hasta: m[2] } : undefined;
}

/**
 * Extracts movements. Sabadell's native-text layer keeps each movement roughly
 * on one line, but long concepts can wrap; we group lines into "blocks" that
 * each start with an F.Operativa date, then match the movement pattern:
 *   F.Operativa  CONCEPTO  F.Valor  IMPORTE  SALDO  [REF1] [REF2]
 */
function extractMovimientos(text: string): SabMovimiento[] {
  const lines = text.split(/\r?\n/);
  const startRe = new RegExp(`^\\s*${DATE}\\b`);

  const blocks: string[] = [];
  for (const line of lines) {
    if (startRe.test(line)) {
      blocks.push(line);
    } else if (blocks.length > 0 && line.trim()) {
      // Continuation of a wrapped concept.
      blocks[blocks.length - 1] += ' ' + line.trim();
    }
  }

  const movRe = new RegExp(
    `^(${DATE})\\s+(.*?)\\s+(${DATE})\\s+(${AMOUNT})\\s+(${AMOUNT})`,
  );

  const movimientos: SabMovimiento[] = [];
  for (const block of blocks) {
    const collapsed = block.replace(/\s+/g, ' ').trim();
    const m = collapsed.match(movRe);
    if (!m) continue;

    const fecha = m[1];
    const concepto = m[2].replace(/\s+/g, ' ').trim();
    const importe = parseSpanishAmount(m[4]);
    if (Number.isNaN(importe)) continue;

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

/** Parses a Banco Sabadell PDF statement (native text) into header + movements. */
export async function parseSabadellPdf(buf: Buffer): Promise<SabExtracto> {
  // Import the internal lib path to avoid pdf-parse's debug test-file read.
  const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const data = await pdf(buf);
  return parseSabadellText(data.text ?? '');
}

/** Returns the calendar month (1-12) of a DD/MM/YYYY date, or null. */
export function monthOf(fecha: string): number | null {
  const m = fecha.match(/^\d{2}\/(\d{2})\/\d{4}$/);
  if (!m) return null;
  const mm = Number(m[1]);
  return mm >= 1 && mm <= 12 ? mm : null;
}
