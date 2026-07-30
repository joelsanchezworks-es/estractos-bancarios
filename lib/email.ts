import nodemailer from 'nodemailer';
import type { MovimientoClasificado } from './types';

/**
 * Sends a notification to the supervisor when a file produced movements that
 * need manual review. Email is best-effort: if SMTP is not configured, we log
 * a warning and continue without breaking the processing flow.
 */
export async function sendPendientesEmail(
  comunidad: string,
  pendientes: MovimientoClasificado[],
  archivo: string,
  sheetUrl: string,
): Promise<boolean> {
  if (pendientes.length === 0) return false;

  const to = process.env.SUPERVISOR_EMAIL;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!to || !host || !user || !pass) {
    console.warn(
      '[email] SMTP no configurado (SMTP_HOST/SMTP_USER/SMTP_PASS/SUPERVISOR_EMAIL). ' +
        'Se omite el envío del aviso de pendientes.',
    );
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });

    const rows = pendientes
      .map(
        (m) =>
          `<tr><td>${escapeHtml(m.fecha)}</td><td>${escapeHtml(
            m.descripcion,
          )}</td><td style="text-align:right">${m.importe.toFixed(
            2,
          )}</td><td>${escapeHtml(m.categoria)}</td><td>${escapeHtml(m.confianza)}</td></tr>`,
      )
      .join('');

    const html = `
      <div style="font-family: system-ui, sans-serif; color: #111;">
        <h2 style="color:#f97316;">Extractos Bancarios — Pendientes de revisión</h2>
        <p>El archivo <strong>${escapeHtml(archivo)}</strong> de la comunidad
        <strong>${escapeHtml(comunidad)}</strong> ha generado
        <strong>${pendientes.length}</strong> movimiento(s) que requieren revisión manual.</p>
        <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th>Fecha</th><th>Descripción</th><th>Importe</th><th>Categoría sugerida</th><th>Confianza</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:16px;">
          <a href="${sheetUrl}" style="color:#f97316;">Abrir Google Sheet</a>
        </p>
      </div>`;

    await transporter.sendMail({
      from,
      to,
      subject: `[Extractos] ${pendientes.length} pendiente(s) de revisión — ${comunidad}`,
      html,
    });

    return true;
  } catch (err) {
    console.error('[email] Error enviando aviso de pendientes:', err);
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
