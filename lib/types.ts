// Shared domain types for the bank-statement classification pipeline.

export type Confianza = 'alta' | 'media' | 'baja';

/** A normalized movement extracted from any source file (XLS/CSV/PDF). */
export interface MovimientoRaw {
  fecha: string; // DD/MM/YYYY
  descripcion: string;
  importe: number; // negative = expense
}

/** A movement after Claude classification. */
export interface MovimientoClasificado extends MovimientoRaw {
  categoria: string;
  confianza: Confianza;
  revisar: boolean;
}

/** Result of parsing an uploaded/imported file. */
export interface ParseResult {
  comunidad: string;
  archivo: string;
  movimientos: MovimientoRaw[];
}

/** Payload returned by the /api/process endpoint to the dashboard. */
export interface ProcessResult {
  comunidad: string;
  archivo: string;
  total: number;
  pendientes: number;
  duplicado: boolean;
  movimientos: MovimientoClasificado[];
  sheetUrl: string;
  emailEnviado: boolean;
}

/** Aggregated statistics for the dashboard. */
export interface StatsResponse {
  totalMovimientosMes: number;
  comunidadesSemana: number;
  pendientesRevision: number;
  ultimoProcesado: string | null; // ISO timestamp
  ultimoArchivo: string | null; // filename of the last processed extract
  comunidades: ComunidadResumen[];
  pendientes: PendienteResumen[];
  gastosPorCategoria: { categoria: string; total: number }[];
  sheetUrl: string;
}

export interface ComunidadResumen {
  nombre: string;
  movimientos: number;
  estado: 'OK' | 'Revisar';
}

export interface PendienteResumen {
  fecha: string;
  descripcion: string;
  importe: number;
  categoriaSugerida: string;
  comunidad: string;
}

// ---------------------------------------------------------------------------
// Sabadell PDF -> template-cell-update flow
// ---------------------------------------------------------------------------

/** One cell update produced by processing a movement. */
export interface CeldaUpdate {
  concepto: string;
  codigo: string;
  categoria: string; // code description
  mes: string; // Catalan month column
  importe: number; // positive (absolute) amount added
  celdaAnterior: number;
  celdaNueva: number;
  celda: string; // A1 reference, e.g. "D7"
}

export interface PendienteItem {
  fecha: string;
  concepto: string;
  importe: number;
  comunidad: string;
  sugerencia: string;
}

// ---------------------------------------------------------------------------
// Phased processing contract (parse -> classify -> apply)
//
// The interactive upload is split into short HTTP calls so no single request
// exceeds Vercel's 10s hobby-plan function limit. These types are the payloads
// exchanged between the browser and the /api/process/* endpoints.
// ---------------------------------------------------------------------------

/** A single expense movement (negative amount) awaiting classification. */
export interface PreparedGasto {
  fecha: string; // F.Operativa, DD/MM/YYYY
  concepto: string;
  importe: number; // signed (negative = expense)
}

/** A gasto after its concept has been classified into a raw code. */
export interface ClassifiedGasto extends PreparedGasto {
  codigo: string; // "010" | "IGNORAR" | "" (empty => pending review)
}

/** Result of phase 1 (parse the PDF + dedup check). */
export interface PreparedExtracto {
  hash: string;
  comunidad: string;
  archivo: string;
  duplicado: boolean;
  already: boolean; // hash already recorded (governs whether to re-record)
  totalMovimientos: number;
  ignorados: number; // income (positive) movements, ignored
  gastos: PreparedGasto[];
  sheetUrl: string;
}

/** Result of processing a Sabadell PDF against the template Sheet. */
export interface SabProcessResult {
  comunidad: string;
  archivo: string;
  tabCreada: boolean;
  duplicado: boolean;
  totalMovimientos: number; // parsed from the PDF
  ignorados: number; // income / IGNORAR
  celdasActualizadas: number;
  updates: CeldaUpdate[];
  pendientes: PendienteItem[];
  totalesPorCategoria: { categoria: string; total: number }[];
  totalesPorMes: { mes: string; total: number }[];
  sheetUrl: string;
  error?: string;
}
