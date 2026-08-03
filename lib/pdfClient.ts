// Browser-only: extract the text layer from a PDF with pdf.js.
//
// This runs entirely in the browser so we send the server plain text instead of
// the full PDF (which can exceed Vercel's 4.5MB request limit -> HTTP 413).

/** pdf.js v4 uses Promise.withResolvers; polyfill for browsers that lack it. */
function ensurePromiseWithResolvers(): void {
  const P = Promise as unknown as { withResolvers?: unknown };
  if (typeof P.withResolvers !== 'function') {
    P.withResolvers = function <T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };
  }
}

interface TextItemLike {
  str?: string;
  transform?: number[];
  hasEOL?: boolean;
}

/**
 * Rebuilds line structure from pdf.js text items. The Sabadell parser expects
 * each movement roughly on its own line, so we group items by their vertical
 * position (transform[5]) and order them left-to-right (transform[4]).
 */
function reconstructLines(items: unknown[]): string {
  const out: string[] = [];
  let current: { x: number; str: string }[] = [];
  let prevY: number | null = null;

  const flush = () => {
    if (current.length === 0) return;
    current.sort((a, b) => a.x - b.x);
    const line = current
      .map((s) => s.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) out.push(line);
    current = [];
  };

  for (const raw of items) {
    const it = raw as TextItemLike;
    if (typeof it.str !== 'string') continue;
    const x = it.transform?.[4] ?? 0;
    const y = it.transform?.[5] ?? 0;
    if (prevY !== null && Math.abs(y - prevY) > 3) flush();
    current.push({ x, str: it.str });
    prevY = y;
    if (it.hasEOL) {
      flush();
      prevY = null;
    }
  }
  flush();
  return out.join('\n');
}

/** Extracts all text from a PDF File, preserving line breaks between rows. */
export async function extractPdfText(file: File): Promise<string> {
  ensurePromiseWithResolvers();

  const pdfjs = await import('pdfjs-dist');
  // Same-origin module worker (copied into public/ by scripts/copy-pdf-worker.js).
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pages.push(reconstructLines(content.items));
    }
    return pages.join('\n\n');
  } finally {
    await doc.destroy();
  }
}
