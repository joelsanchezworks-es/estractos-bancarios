import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { classifyConceptos } from '@/lib/claude';
import { createTimer } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 10; // Vercel hobby limit; client sends small chunks.
export const dynamic = 'force-dynamic';

/**
 * PHASE 2 of the interactive flow. Classifies a CHUNK of concepts into codes.
 * The browser calls this repeatedly with small chunks so each request stays
 * within one Claude batch (and well under the 10s function limit).
 */
export async function POST(req: NextRequest) {
  const t = createTimer('api/process/classify');
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY no está configurada en el servidor.' },
        { status: 500 },
      );
    }

    const body = await req.json().catch(() => null);
    const conceptos = Array.isArray(body?.conceptos) ? body.conceptos.map((c: unknown) => String(c ?? '')) : null;
    if (!conceptos) {
      return NextResponse.json({ error: 'Faltan los conceptos a clasificar.' }, { status: 400 });
    }

    t.log('classify', { n: conceptos.length });
    const codigos = await classifyConceptos(conceptos);
    t.log('done', { n: codigos.length, ms: t.elapsed() });

    return NextResponse.json({ ok: true, codigos });
  } catch (err) {
    t.error('POST', err);
    const message = err instanceof Error ? err.message : 'Error clasificando los conceptos';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
