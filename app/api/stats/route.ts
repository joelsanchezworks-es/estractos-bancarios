import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getSheetTitles,
  batchGetValues,
  getValues,
  getUltimoProcesado,
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

function parseNumber(value: unknown): number {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

/** Parses an ISO fecha_proceso timestamp into a Date, or null. */
function parseProceso(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

const EMPTY_STATS: StatsResponse = {
  totalMovimientosMes: 0,
  comunidadesSemana: 0,
  pendientesRevision: 0,
  ultimoProcesado: null,
  ultimoArchivo: null,
  comunidades: [],
  pendientes: [],
  gastosPorCategoria: [],
  sheetUrl: '',
};

// Movement-row column indices (shared by community and pending tabs — the first
// 8 columns are identical in both layouts).
const COL = { importe: 2, categoria: 3, comunidad: 5, fechaProceso: 7 } as const;

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

    // Read all community tabs + the pending tab in one batch.
    const comunidadRanges = comunidadTitles.map((t) => quoteSheetRange(t, 'A2:H'));
    const batches = await batchGetValues(comunidadRanges);

    const pendientesRows = titles.includes(PENDIENTE_SHEET)
      ? await getValues(quoteSheetRange(PENDIENTE_SHEET, 'A2:I'))
      : [];

    // Last processed file (name + time) from the authoritative registry.
    const ultimo = await getUltimoProcesado();

    // --- Pending review list ---
    const pendientesComunidades = new Set<string>();
    const pendientes: PendienteResumen[] = pendientesRows
      .filter((r) => r.length > 0 && r[0])
      .map((r) => {
        const comunidad = r[COL.comunidad] ?? '';
        if (comunidad) pendientesComunidades.add(comunidad);
        return {
          fecha: r[0] ?? '',
          descripcion: r[1] ?? '',
          importe: parseNumber(r[COL.importe]),
          categoriaSugerida: r[COL.categoria] ?? '',
          comunidad,
        };
      });

    // --- Aggregate counters over ALL movements (community + pending) by the
    // processing date, so they reflect activity regardless of whether a
    // movement was auto-classified or sent to review. ---
    let totalMovimientosMes = 0;
    const comunidadesSemana = new Set<string>();
    const gastos = new Map<string, number>();
    const comunidadResumen = new Map<string, number>();

    const communityRows: { comunidad: string; row: string[] }[] = [];
    batches.forEach((batch, idx) => {
      const comunidad = comunidadTitles[idx] ?? '';
      for (const row of batch.values) {
        if (row && row.length > 0 && row[0]) communityRows.push({ comunidad, row });
      }
    });
    for (const r of pendientesRows) {
      if (r && r.length > 0 && r[0]) {
        communityRows.push({ comunidad: r[COL.comunidad] ?? '', row: r });
      }
    }

    for (const { comunidad, row } of communityRows) {
      const fechaProceso = parseProceso(row[COL.fechaProceso]);
      if (!fechaProceso) continue;

      // Movements processed this calendar month.
      if (fechaProceso >= monthStart) {
        totalMovimientosMes += 1;
        const importe = parseNumber(row[COL.importe]);
        if (importe < 0) {
          const categoria = row[COL.categoria] || 'Otros';
          gastos.set(categoria, (gastos.get(categoria) ?? 0) + Math.abs(importe));
        }
      }

      // Communities with activity in the last 7 days.
      if (fechaProceso >= weekAgo && comunidad) {
        comunidadesSemana.add(comunidad);
        comunidadResumen.set(comunidad, (comunidadResumen.get(comunidad) ?? 0) + 1);
      }
    }

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
      ultimoProcesado: ultimo?.fecha ?? null,
      ultimoArchivo: ultimo?.archivo ?? null,
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
