import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prepareExtractoFromText } from '@/lib/pipeline';
import { createTimer } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 10; // Vercel hobby limit; this phase is a small read.
export const dynamic = 'force-dynamic';

/**
 * PHASE 1 of the interactive flow. The browser extracts the PDF text with
 * pdf.js and posts it here as JSON (tiny payload, avoids the 4.5MB request
 * limit). We validate the destination Sheet, dedup, and split expenses.
 */
export async function POST(req: NextRequest) {
  const t = createTimer('api/process/parse');
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  try {
    if (!process.env.GOOGLE_SHEETS_ID) {
      return NextResponse.json(
        { error: 'GOOGLE_SHEETS_ID no está configurado en el servidor.' },
        { status: 500 },
      );
    }

    const body = await req.json().catch(() => null);
    const text = typeof body?.text === 'string' ? body.text : '';
    const filename = typeof body?.filename === 'string' && body.filename ? body.filename : 'extracto.pdf';
    const force = body?.force === true || body?.force === 'true';

    if (!text.trim()) {
      return NextResponse.json(
        { error: 'El PDF no contiene texto seleccionable (¿es un PDF escaneado?).' },
        { status: 400 },
      );
    }

    t.log('start', { filename, chars: text.length, force });
    const prepared = await prepareExtractoFromText(text, filename, force);
    t.log('done', {
      comunidad: prepared.comunidad,
      duplicado: prepared.duplicado,
      gastos: prepared.gastos.length,
      ms: t.elapsed(),
    });

    return NextResponse.json({ ok: true, ...prepared });
  } catch (err) {
    t.error('POST', err);
    const message = err instanceof Error ? err.message : 'Error leyendo el extracto';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
