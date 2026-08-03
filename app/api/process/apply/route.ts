import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { applyClassifiedGastos } from '@/lib/pipeline';
import { createTimer } from '@/lib/log';
import type { ClassifiedGasto } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 10; // Vercel hobby limit; only Sheets writes happen here.
export const dynamic = 'force-dynamic';

/**
 * PHASE 3 of the interactive flow. Writes the classified expenses into the
 * community tab (accumulating), sends unmatched ones to "Pendiente Revision",
 * and records the file hash. Returns the full SabProcessResult; a Sheets error
 * comes back as { ...result, error } (HTTP 200) so the UI shows the exact cause.
 */
export async function POST(req: NextRequest) {
  const t = createTimer('api/process/apply');
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  try {
    if (!process.env.GOOGLE_SHEETS_ID_CLIENTE && !process.env.GOOGLE_SHEETS_ID) {
      return NextResponse.json(
        { error: 'GOOGLE_SHEETS_ID_CLIENTE no está configurado en el servidor.' },
        { status: 500 },
      );
    }

    const body = await req.json().catch(() => null);
    const comunidad = typeof body?.comunidad === 'string' ? body.comunidad : '';
    const gastos = Array.isArray(body?.gastos) ? (body.gastos as ClassifiedGasto[]) : null;

    if (!comunidad || !gastos) {
      return NextResponse.json(
        { error: 'Datos incompletos para actualizar el Sheet (falta comunidad o movimientos).' },
        { status: 400 },
      );
    }

    t.log('start', { comunidad, gastos: gastos.length });
    const result = await applyClassifiedGastos({
      comunidad,
      hash: typeof body?.hash === 'string' ? body.hash : '',
      archivo: typeof body?.archivo === 'string' ? body.archivo : 'extracto.pdf',
      already: body?.already === true,
      totalMovimientos: Number(body?.totalMovimientos) || 0,
      ignorados: Number(body?.ignorados) || 0,
      gastos,
      titular: typeof body?.titular === 'string' ? body.titular : undefined,
      noMapeada: body?.noMapeada === true,
    });
    t.log('done', { celdas: result.celdasActualizadas, error: result.error ?? null, ms: t.elapsed() });

    return NextResponse.json(result);
  } catch (err) {
    t.error('POST', err);
    const message = err instanceof Error ? err.message : 'Error actualizando el Sheet';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
