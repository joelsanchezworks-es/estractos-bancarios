import Anthropic from '@anthropic-ai/sdk';
import { normalizeCategoria } from './categories';
import type { Confianza, MovimientoClasificado, MovimientoRaw } from './types';

// The spec named claude-3-5-sonnet-20241022, which has since been retired.
// We default to the current Sonnet (ideal for classification) and allow an
// override via ANTHROPIC_MODEL.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const MAX_BATCH_SIZE = 50; // movements per Claude request
const MAX_CHARS = 6000; // approx char budget per Claude request

const SYSTEM_PROMPT = `Eres un asistente contable especializado en comunidades de propietarios. Clasifica cada movimiento en estas categorías exactas: Luz, Agua, Seguro, Reparacion Electrica, Fontaneria, Jardineria, Limpieza, Cuotas, Otros.

Las descripciones pueden venir en catalán, castellano o una mezcla de ambos. Clasifica siempre por el concepto del gasto, aunque el idioma sea distinto al de la categoría. Ejemplos de mapeo (concepto → categoría):
- Electra / Electricitat / Llum → Luz
- Aigua / Water → Agua
- Assegurança / Seguro → Seguro
- Manteniment elèctric / Reparació elèctrica → Reparacion Electrica
- Fontaneria / Fontanera / Desatascos / Sifons → Fontaneria
- Neteja / Limpieza → Limpieza
- Jardí / Jardineria → Jardineria
- Ascensor / Mant. Ascensor → Otros
- Honoraris / Administració / Admin → Cuotas
- Despeses banc / Banco → Otros
- CAE / PRL / Protecció Dades → Otros
Estos son solo ejemplos orientativos; usa el mismo criterio para conceptos equivalentes en cualquiera de los dos idiomas.

Devuelve SOLO un array JSON sin texto extra, sin markdown, sin explicaciones.
Cada elemento:
- fecha (DD/MM/YYYY)
- descripcion (string limpio)
- importe (number, negativo=gasto)
- categoria (de la lista exacta)
- confianza (alta/media/baja)
- revisar (boolean)`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');
    client = new Anthropic({ apiKey });
  }
  return client;
}

function normalizeConfianza(value: unknown): Confianza {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'alta' || v === 'media' || v === 'baja') return v;
  return 'baja';
}

/** Extracts a JSON array from a model response that may include stray text. */
function extractJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to regex extraction
  }
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const parsed = JSON.parse(trimmed.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // give up
    }
  }
  return [];
}

/** Splits movements into batches bounded by count and character budget. */
function makeBatches(movimientos: MovimientoRaw[]): MovimientoRaw[][] {
  const batches: MovimientoRaw[][] = [];
  let current: MovimientoRaw[] = [];
  let chars = 0;

  for (const mov of movimientos) {
    const len = JSON.stringify(mov).length;
    if (current.length >= MAX_BATCH_SIZE || (current.length > 0 && chars + len > MAX_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(mov);
    chars += len;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Marks a batch as "needs review / Otros" when classification fails. */
function fallbackBatch(batch: MovimientoRaw[]): MovimientoClasificado[] {
  return batch.map((mov) => ({
    ...mov,
    categoria: 'Otros',
    confianza: 'baja' as Confianza,
    revisar: true,
  }));
}

async function classifyBatch(batch: MovimientoRaw[]): Promise<MovimientoClasificado[]> {
  const userContent = `Clasifica estos ${batch.length} movimientos bancarios y devuelve el array JSON:\n${JSON.stringify(
    batch,
    null,
    0,
  )}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const parsed = extractJsonArray(text);

  // Align results with the input by index. We trust the parser's fecha/importe
  // (authoritative numeric values) and take category/confidence from Claude.
  return batch.map((mov, i) => {
    const item = parsed[i] as Record<string, unknown> | undefined;
    if (!item || typeof item !== 'object') {
      return { ...mov, categoria: 'Otros', confianza: 'baja' as Confianza, revisar: true };
    }
    const categoria = normalizeCategoria(item.categoria);
    const confianza = normalizeConfianza(item.confianza);
    // Flag for review if Claude asked for it or if confidence is low.
    const revisar = item.revisar === true || confianza === 'baja';

    return {
      fecha: mov.fecha,
      descripcion: mov.descripcion,
      importe: mov.importe,
      categoria,
      confianza,
      revisar,
    };
  });
}

/**
 * Classifies a list of movements, batching automatically. Errors in one batch
 * do not break the flow: those movements are flagged for review.
 */
export async function classifyMovimientos(
  movimientos: MovimientoRaw[],
): Promise<MovimientoClasificado[]> {
  if (movimientos.length === 0) return [];

  const batches = makeBatches(movimientos);
  const results: MovimientoClasificado[] = [];

  for (const batch of batches) {
    try {
      const classified = await classifyBatch(batch);
      results.push(...classified);
    } catch (err) {
      console.error('[claude] Error clasificando lote:', err);
      results.push(...fallbackBatch(batch));
    }
  }

  return results;
}
