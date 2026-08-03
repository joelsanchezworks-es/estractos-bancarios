import { NextResponse, type NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { processSabadellPdf } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No se ha enviado ningún archivo' },
        { status: 400 },
      );
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json(
        { error: 'Este sistema procesa extractos PDF del Banco Sabadell.' },
        { status: 400 },
      );
    }

    const force = formData.get('force') === 'true';
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await processSabadellPdf(buffer, file.name, { force });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[api/process] Error:', err);
    const message = err instanceof Error ? err.message : 'Error procesando el archivo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
