import { NextResponse, type NextRequest } from 'next/server';
import { getDriveFile, listFolderFiles } from '@/lib/drive';
import { processSabadellPdf } from '@/lib/pipeline';
import type { SabProcessResult } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_FILES_PER_CALL = 10;

/**
 * Google Drive push-notification / manual webhook endpoint.
 *
 * Google Drive push notifications only signal that "something changed" in the
 * watched folder, so this endpoint:
 *   - processes a specific file when the request body carries `{ fileId }`, or
 *   - otherwise scans GOOGLE_DRIVE_FOLDER_ID and processes new (unhashed) files.
 *
 * The file hash dedup in the pipeline prevents reprocessing already-seen files.
 * Optionally protected by a shared secret (WEBHOOK_SECRET).
 */
export async function POST(req: NextRequest) {
  // Optional shared-secret protection.
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const token =
      req.headers.get('x-webhook-token') ??
      new URL(req.url).searchParams.get('token') ??
      '';
    if (token !== secret) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }
  }

  // Drive sends an initial "sync" handshake — acknowledge it and stop.
  if (req.headers.get('x-goog-resource-state') === 'sync') {
    return NextResponse.json({ ok: true, sync: true });
  }

  let fileId: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.fileId === 'string') fileId = body.fileId;
  } catch {
    // No JSON body (typical for Drive notifications) — fall back to folder scan.
  }

  const results: SabProcessResult[] = [];

  try {
    if (fileId) {
      const { name, buffer } = await getDriveFile(fileId);
      results.push(await processSabadellPdf(buffer, name));
    } else {
      const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
      if (!folderId) {
        return NextResponse.json(
          { error: 'GOOGLE_DRIVE_FOLDER_ID no configurado' },
          { status: 400 },
        );
      }

      const files = await listFolderFiles(folderId);
      let processedNew = 0;

      for (const f of files) {
        if (processedNew >= MAX_FILES_PER_CALL) break;
        // Only Sabadell PDFs.
        if (!f.name.toLowerCase().endsWith('.pdf')) continue;

        const { name, buffer } = await getDriveFile(f.id);
        const result = await processSabadellPdf(buffer, name);
        results.push(result);
        if (!result.duplicado) processedNew++;
      }
    }

    return NextResponse.json({ ok: true, procesados: results });
  } catch (err) {
    console.error('[api/webhook] Error:', err);
    const message = err instanceof Error ? err.message : 'Error en el webhook';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Health check.
export async function GET() {
  return NextResponse.json({ ok: true, service: 'drive-webhook' });
}
