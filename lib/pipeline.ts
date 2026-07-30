import crypto from 'crypto';
import { parseFile } from './parser';
import { classifyMovimientos } from './claude';
import {
  writeComunidadRows,
  writePendienteRows,
  isDuplicate,
  recordHash,
  getSheetUrl,
} from './sheets';
import { sendPendientesEmail } from './email';
import type { ProcessResult } from './types';

/**
 * End-to-end processing of a single statement file buffer:
 * 1. Hash + duplicate check
 * 2. Parse -> normalized movements
 * 3. Classify with Claude (batched)
 * 4. Write OK rows to the community tab, flagged rows to "Pendiente Revision"
 * 5. Email the supervisor if there are pending movements
 *
 * Errors in classification are contained (movements flagged for review) so a
 * single bad row never breaks the whole file.
 */
export async function processFileBuffer(
  buffer: Buffer,
  filename: string,
  options: { force?: boolean } = {},
): Promise<ProcessResult> {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const sheetUrl = getSheetUrl();

  // Duplicate detection can be bypassed with `force` (e.g. re-testing the same
  // file from the dashboard).
  const alreadyProcessed = await isDuplicate(hash);
  if (alreadyProcessed && !options.force) {
    return {
      comunidad: '',
      archivo: filename,
      total: 0,
      pendientes: 0,
      duplicado: true,
      movimientos: [],
      sheetUrl,
      emailEnviado: false,
    };
  }

  const { comunidad, movimientos } = await parseFile(buffer, filename);

  if (movimientos.length === 0) {
    return {
      comunidad,
      archivo: filename,
      total: 0,
      pendientes: 0,
      duplicado: false,
      movimientos: [],
      sheetUrl,
      emailEnviado: false,
    };
  }

  const clasificados = await classifyMovimientos(movimientos);
  const fechaProceso = new Date().toISOString();

  const ok = clasificados.filter((m) => !m.revisar);
  const pendientes = clasificados.filter((m) => m.revisar);

  // OK rows -> community tab; flagged rows -> "Pendiente Revision" tab.
  await writeComunidadRows(comunidad, ok, filename, fechaProceso);
  await writePendienteRows(comunidad, pendientes, filename, fechaProceso);
  // Only record the hash the first time, so forced reprocessing doesn't add
  // duplicate rows to the processed-files registry.
  if (!alreadyProcessed) {
    await recordHash(hash, filename, fechaProceso);
  }

  let emailEnviado = false;
  if (pendientes.length > 0) {
    emailEnviado = await sendPendientesEmail(comunidad, pendientes, filename, sheetUrl);
  }

  return {
    comunidad,
    archivo: filename,
    total: clasificados.length,
    pendientes: pendientes.length,
    duplicado: false,
    movimientos: clasificados,
    sheetUrl,
    emailEnviado,
  };
}
