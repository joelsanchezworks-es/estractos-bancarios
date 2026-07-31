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
