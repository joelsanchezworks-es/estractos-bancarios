import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getSheetTitles,
  getValues,
  getUltimoProcesado,
  getSheetUrl,
  SYSTEM_SHEETS,
  PENDIENTE_SHEET,
} from '@/lib/sheets';
import type { StatsResponse, ComunidadResumen, PendienteResumen } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseNumber(value: unknown): number {
  if (value == null || value === '') return 0;
  const direct = Number(value);
  if (!Number.isNaN(direct)) return direct;
  const es = parseFloat(String(value).replace(/\./g, '').replace(',', '.'));
  return Number.isNaN(es) ? 0 : es;
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

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const sheetUrl = getSheetUrl();

  if (!process.env.GOOGLE_SHEETS_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    return NextResponse.json({ ...EMPTY_STATS, sheetUrl });
  }

  try {
    const titles = await getSheetTitles();
    const comunidadTitles = titles.filter(
      (t) => !SYSTEM_SHEETS.has(t) && !t.startsWith('_'),
    );

    // Pending review rows: fecha | concepto | importe | comunidad | sugerencia
    const pendientesRows = titles.includes(PENDIENTE_SHEET)
      ? await getValues(`'${PENDIENTE_SHEET.replace(/'/g, "''")}'!A2:E`)
      : [];

    const pendientesComunidades = new Set<string>();
    const pendientes: PendienteResumen[] = pendientesRows
      .filter((r) => r.length > 0 && r[0])
      .map((r) => {
        const comunidad = r[3] ?? '';
        if (comunidad) pendientesComunidades.add(comunidad);
        return {
          fecha: r[0] ?? '',
          descripcion: r[1] ?? '',
          importe: parseNumber(r[2]),
          categoriaSugerida: r[4] ?? '',
          comunidad,
        };
      });

    const comunidades: ComunidadResumen[] = comunidadTitles
      .map((nombre) => ({
        nombre,
        movimientos: 0,
        estado: pendientesComunidades.has(nombre) ? ('Revisar' as const) : ('OK' as const),
      }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    const ultimo = await getUltimoProcesado();

    const response: StatsResponse = {
      totalMovimientosMes: 0,
      comunidadesSemana: comunidadTitles.length,
      pendientesRevision: pendientes.length,
      ultimoProcesado: ultimo?.fecha ?? null,
      ultimoArchivo: ultimo?.archivo ?? null,
      comunidades,
      pendientes,
      gastosPorCategoria: [],
      sheetUrl,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error('[api/stats] Error:', err);
    return NextResponse.json({ ...EMPTY_STATS, sheetUrl });
  }
}
