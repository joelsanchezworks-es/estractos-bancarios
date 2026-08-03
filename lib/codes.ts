// Category rows and month columns of the "48 ESC" template tab.
// Column A = numeric code, Column B = description; row 2 = Catalan month headers.

export interface CodeDef {
  code: string;
  descripcion: string;
}

export const CODES: CodeDef[] = [
  { code: '010', descripcion: 'Electra' },
  { code: '011', descripcion: 'Manteniment elèctric BT' },
  { code: '020', descripcion: 'Aigua' },
  { code: '030', descripcion: 'Mant. Ascensor ASZENDE' },
  { code: '040', descripcion: 'Assegurança' },
  { code: '050', descripcion: 'Extintors' },
  { code: '051', descripcion: 'Extintors Revisió Trimestral' },
  { code: '060', descripcion: 'Neteja' },
  { code: '140', descripcion: 'Mant. Sifons' },
  { code: '174', descripcion: 'CAE (PRL)' },
  { code: '175', descripcion: 'Cert. Digital' },
  { code: '200', descripcion: 'Honoraris Admin' },
  { code: '201', descripcion: 'IVA Administració' },
  { code: '215', descripcion: 'Protecció Dades' },
  { code: '230', descripcion: 'Despeses banc' },
  { code: '231', descripcion: 'Despeses RMR' },
];

export const VALID_CODES = new Set(CODES.map((c) => c.code));

const CODE_DESC = new Map(CODES.map((c) => [c.code, c.descripcion]));

export function codeDescripcion(code: string): string {
  return CODE_DESC.get(code) ?? code;
}

/** Catalan month columns of the template (row 2), in fiscal-year order. */
export const CATALAN_MONTHS = [
  'set',
  'oct',
  'nov',
  'des',
  'gener',
  'febrer',
  'març',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
] as const;

// Calendar month (1-12) -> Catalan fiscal-year column (Sep=set ... Aug=ago).
const CAL_TO_CAT: Record<number, string> = {
  9: 'set',
  10: 'oct',
  11: 'nov',
  12: 'des',
  1: 'gener',
  2: 'febrer',
  3: 'març',
  4: 'abr',
  5: 'mai',
  6: 'jun',
  7: 'jul',
  8: 'ago',
};

export function calendarMonthToCatalan(mm: number): string | null {
  return CAL_TO_CAT[mm] ?? null;
}

/** Accent-insensitive, lowercase key for matching month headers / labels. */
export function normalizeKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const CATALAN_MONTH_KEYS = new Set(CATALAN_MONTHS.map((m) => normalizeKey(m)));

export function isMonthHeader(value: unknown): boolean {
  return CATALAN_MONTH_KEYS.has(normalizeKey(value));
}

/**
 * Normalizes a code (from Claude or a sheet cell) to canonical 3-digit form and
 * validates it against the known category codes. "10" -> "010"; returns null if
 * it is not a known code.
 */
export function normalizeCode(value: unknown): string | null {
  if (value == null) return null;
  const digits = String(value).trim().replace(/[^\d]/g, '');
  if (!digits) return null;
  const padded = digits.padStart(3, '0');
  return VALID_CODES.has(padded) ? padded : null;
}

// ---------------------------------------------------------------------------
// Pure grid-layout helpers (shared by the sheets I/O and the pipeline)
// ---------------------------------------------------------------------------

/** 0-based column index -> spreadsheet column letters (0 -> A, 26 -> AA). */
export function colToLetter(index: number): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

/** Finds the row (0-based) holding the Catalan month headers, or -1. */
export function findMonthRowIndex(grid: unknown[][]): number {
  const limit = Math.min(grid.length, 8);
  for (let r = 0; r < limit; r++) {
    const count = (grid[r] ?? []).filter((c) => isMonthHeader(c)).length;
    if (count >= 6) return r;
  }
  return -1;
}

/** Maps normalized Catalan month name -> column index, from a header row. */
export function monthColumnMap(headerRow: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((cell, idx) => {
    if (isMonthHeader(cell)) {
      const key = normalizeKey(cell);
      if (!map.has(key)) map.set(key, idx);
    }
  });
  return map;
}

/** Maps category code -> row index (0-based), scanning column A from startRow. */
export function codeRowMap(grid: unknown[][], startRow: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let r = startRow; r < grid.length; r++) {
    const code = normalizeCode(grid[r]?.[0]);
    if (code && !map.has(code)) map.set(code, r);
  }
  return map;
}
