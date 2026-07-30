import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getSheetTitles,
  batchGetValues,
  getValues,
  quoteSheetRange,
  getSheetUrl,
  SYSTEM_SHEETS,
  PENDIENTE_SHEET,
} from '@/lib/sheets';
import type {
  StatsResponse,
  ComunidadResumen,
  PendienteResumen,
} from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Parses a DD/MM/YYYY string into a Date (local), or null. */
function parseDMY(value: string): Date | null {
  const m = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const date = new Date(year, Number(mo) - 1, Number(d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNumber(value: unknown): number {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

const EMPTY_STATS: StatsResponse = {
  totalMovimientosMes: 0,
  comunidadesSemana: 0,
  pendientesRevision: 0,
  ultimoProcesado: null,
  comunidades: [],
  pendientes: [],
  gastosPorCategoria: [],
  sheetUrl: '',
};

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const sheetUrl = getSheetUrl();

  // If Google Sheets isn't configured yet, return an empty-but-valid payload so
  // the dashboard still renders.
  if (!process.env.GOOGLE_SHEETS_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    return NextResponse.json({ ...EMPTY_STATS, sheetUrl });
  }

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const titles = await getSheetTitles();
    const comunidadTitles = titles.filter(
      (t) => !SYSTEM_SHEETS.has(t) && !t.startsWith('_'),
    );

    // Pending review rows (single tab).
    const pendientesRows = titles.includes(PENDIENTE_SHEET)
      ? await getValues(quoteSheetRange(PENDIENTE_SHEET, 'A2:I'))
      : [];

    const pendientesComunidades = new Set<string>();
    const pendientes: PendienteResumen[] = pendientesRows
      .filter((r) => r.length > 0 && r[0])
      .map((r) => {
        const comunidad = r[5] ?? '';
        if (comunidad) pendientesComunidades.add(comunidad);
        return {
          fecha: r[0] ?? '',
          descripcion: r[1] ?? '',
          importe: parseNumber(r[2]),
          categoriaSugerida: r[3] ?? '',
          comunidad,
        };
      });

    // All community tabs in one batch call.
    const ranges = comunidadTitles.map((t) => quoteSheetRange(t, 'A2:H'));
    const batches = await batchGetValues(ranges);

    let totalMovimientosMes = 0;
    let ultimoProcesado: Date | null = null;
    const comunidadesSemana = new Set<string>();
    const gastos = new Map<string, number>();
    const comunidadResumen = new Map<string, number>(); // community -> movements this week

    batches.forEach((batch, idx) => {
      const comunidad = comunidadTitles[idx] ?? '';

      for (const row of batch.values) {
        if (!row || row.length === 0 || !row[0]) continue;

        const importe = parseNumber(row[2]);
        const categoria = row[3] ?? 'Otros';
        const fechaMov = parseDMY(row[0]);
        const fechaProcesoRaw = row[7];
        const fechaProceso = fechaProcesoRaw ? new Date(fechaProcesoRaw) : null;

        // Movements in the current month.
        if (fechaMov && fechaMov >= monthStart) {
          totalMovimientosMes += 1;
          if (importe < 0) {
            gastos.set(categoria, (gastos.get(categoria) ?? 0) + Math.abs(importe));
          }
        }

        // Processing activity in the last 7 days.
        if (fechaProceso && !Number.isNaN(fechaProceso.getTime()) && fechaProceso >= weekAgo) {
          comunidadesSemana.add(comunidad);
          comunidadResumen.set(comunidad, (comunidadResumen.get(comunidad) ?? 0) + 1);
        }

        if (fechaProceso && !Number.isNaN(fechaProceso.getTime())) {
          if (!ultimoProcesado || fechaProceso > ultimoProcesado) {
            ultimoProcesado = fechaProceso;
          }
        }
      }
    });

    const comunidades: ComunidadResumen[] = Array.from(comunidadResumen.entries())
      .map(([nombre, movimientos]) => ({
        nombre,
        movimientos,
        estado: pendientesComunidades.has(nombre) ? ('Revisar' as const) : ('OK' as const),
      }))
      .sort((a, b) => b.movimientos - a.movimientos);

    const gastosPorCategoria = Array.from(gastos.entries())
      .map(([categoria, total]) => ({ categoria, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    const response: StatsResponse = {
      totalMovimientosMes,
      comunidadesSemana: comunidadesSemana.size,
      pendientesRevision: pendientes.length,
      ultimoProcesado: ultimoProcesado
        ? (ultimoProcesado as Date).toISOString()
        : null,
      comunidades,
      pendientes,
      gastosPorCategoria,
      sheetUrl,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[api/stats] Error:', err);
    // Graceful fallback so the UI never breaks on a Sheets error.
    return NextResponse.json({ ...EMPTY_STATS, sheetUrl });
  }
}
