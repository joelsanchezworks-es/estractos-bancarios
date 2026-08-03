import Anthropic from '@anthropic-ai/sdk';

// The spec named claude-3-5-sonnet-20241022, which has since been retired.
// We default to the current Sonnet and allow an override via ANTHROPIC_MODEL.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const MAX_BATCH_SIZE = 40; // concepts per Claude request
const MAX_CHARS = 6000;

const SYSTEM_PROMPT = `Eres un clasificador contable de extractos del Banco Sabadell para comunidades de propietarios.
Para CADA concepto de la lista, devuelve SOLO el código numérico correspondiente (como string con ceros a la izquierda, p. ej. "010") o la palabra "IGNORAR" si es un ingreso.

MAPA DE CLASIFICACIÓN:
010 = IBERDROLA, ELECTRICIDAD, ELECTRI
011 = MANTENIMENT ELECTRIC, REPARACIO ELECTRICA
012 = VERTIVALLES, REPARACIO ELECTRICA (reparación puntual)
020 = CICLE DE L'AIGUA, SERVEIS AIGUA, EPEL, TERRASSA AIGUES, AIG-
030 = ASCENSORS EBYP, ASCENSOR, EBYP, ASZENDE, EVEREST FACILITY SERVICES, EVEREST FACILITY, FACILITY SERVICES
040 = ZURICH SEGUROS, SEGUROS ZURICH, ASSEGURANÇA
050 = PREVIFOC, EXTINTORS, OCA GLOBAL, OCA GLOBAL INSPECCIONES, MATERIAL CONTRA INCENDIOS
060 = NETEJA, LIMPIEZA, MONTSERRAT PONCE
140 = SIFONS, DESATASCOS, EGARA DESATASCOS
174 = PROFESSIONAL GROUP CONVERSIA, CONVERSIA, CAE, PRL
175 = CERT DIGITAL, CERTIFICAT DIGITAL
200 = QUATRECASES, HONORARIS, FINCAS FORCADELL, FORCADELL, ADMINISTRACIO, Z08
201 = IVA ADMINISTRACIO, IVA ADMIN
215 = PROTECCIO DADES, PROTECCION DATOS
230 = IMPUESTO SOBRE COMISION, COMISIONES, INTERESES Y/O COMISIONES, GASTOS GEST DEV, IMPAGADO RECIBOS DOMICIL, VARIOS GASTOS CORREO
231 = TRANSFERENCIA A (nombre persona/empresa)

IGNORAR (son ingresos o transferencias a propietarios, no gastos de la comunidad):
- REMESA RECIBOS
- TRANSFERENCIA DE (viene dinero)
- Importes positivos
- Transferencias a personas propietarias: JOAN BAYES, DANIEL HEREDIA, ACTIVA GLOBAL SANCHEZ, ANTONIO IBAÑEZ / ANTONIO IBANEZ

Las descripciones pueden estar en catalán o castellano; clasifica por CONCEPTO, no por idioma.
Devuelve SOLO un array JSON de strings, EXACTAMENTE uno por concepto y en el MISMO orden. Cada elemento es el código (p. ej. "010") o "IGNORAR". Sin texto extra, sin markdown, sin explicaciones.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada');
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Extracts a JSON array from a model response that may include stray text. */
function extractJsonArray(text: string): unknown[] {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fall through to bracket extraction
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

function makeBatches(conceptos: string[]): { items: string[]; offset: number }[] {
  const batches: { items: string[]; offset: number }[] = [];
  let current: string[] = [];
  let offset = 0;
  let chars = 0;

  for (let i = 0; i < conceptos.length; i++) {
    const len = conceptos[i].length + 4;
    if (current.length >= MAX_BATCH_SIZE || (current.length > 0 && chars + len > MAX_CHARS)) {
      batches.push({ items: current, offset });
      offset = i;
      current = [];
      chars = 0;
    }
    current.push(conceptos[i]);
    chars += len;
  }
  if (current.length > 0) batches.push({ items: current, offset });
  return batches;
}

async function classifyBatch(items: string[]): Promise<string[]> {
  const userContent = `Clasifica estos ${items.length} conceptos. Devuelve el array JSON de códigos (uno por concepto, mismo orden):\n${JSON.stringify(
    items,
  )}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const parsed = extractJsonArray(text);
  return items.map((_, i) => {
    const v = parsed[i];
    return typeof v === 'string' ? v.trim() : '';
  });
}

/**
 * Classifies bank concepts into category codes. Returns, for each input
 * concept, a raw string: a numeric code (e.g. "010"), "IGNORAR", or "" when the
 * batch could not be classified (the caller treats "" as pending review).
 */
export async function classifyConceptos(conceptos: string[]): Promise<string[]> {
  if (conceptos.length === 0) return [];

  const batches = makeBatches(conceptos);
  const results: string[] = new Array(conceptos.length).fill('');

  for (const batch of batches) {
    try {
      const codes = await classifyBatch(batch.items);
      for (let i = 0; i < batch.items.length; i++) {
        results[batch.offset + i] = codes[i] ?? '';
      }
    } catch (err) {
      console.error('[claude] Error clasificando lote de conceptos:', err);
      // Leave as '' -> pending review.
    }
  }

  return results;
}
