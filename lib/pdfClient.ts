// Browser-only: extract text from a PDF with pdf.js, falling back to OCR
// (Tesseract.js) for scanned/image PDFs that have no text layer.
//
// Runs entirely in the browser so the server only ever receives plain text
// (well under Vercel's 4.5MB request limit). OCR is CPU-heavy but client-side,
// so it is not subject to the serverless function time limit.

const OCR_LANG = 'spa';
// Below this many non-whitespace characters we treat the PDF as scanned.
const NATIVE_TEXT_MIN_CHARS = 50;
// Target raster width (px) when rendering a page for OCR. Higher = more
// accurate but slower.
const OCR_TARGET_WIDTH = 1600;

export interface ExtractProgress {
  phase: 'text' | 'ocr';
  page: number; // 1-based page being processed (0 before OCR starts)
  totalPages: number;
  pageProgress: number; // 0..1 within the current page (OCR only)
}

export interface ExtractResult {
  text: string;
  ocr: boolean; // whether OCR was used
}

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

/** Loads the PDF document with pdf.js (worker served same-origin from public/). */
async function loadPdf(file: File): Promise<any> {
  ensurePromiseWithResolvers();
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/** Extracts the native text layer (fast path for text PDFs). */
async function extractNativeText(doc: any): Promise<string> {
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(reconstructLines(content.items));
  }
  return pages.join('\n\n');
}

/** Renders a PDF page to a canvas for OCR. */
async function renderPageToCanvas(page: any): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1, OCR_TARGET_WIDTH / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No se pudo crear el lienzo (canvas) para OCR.');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** OCRs every page of the document with Tesseract.js, reporting progress. */
async function ocrDocument(
  doc: any,
  onProgress?: (p: ExtractProgress) => void,
): Promise<string> {
  const tesseract = await import('tesseract.js');
  const numPages: number = doc.numPages;
  let currentPage = 1;

  // Uses tesseract.js's version-matched CDN defaults for the worker, wasm core
  // and language data. The language data (~few MB for 'spa') is downloaded once
  // and cached by the browser (IndexedDB) for subsequent runs.
  const worker = await tesseract.createWorker(OCR_LANG, 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === 'recognizing text') {
        onProgress?.({
          phase: 'ocr',
          page: currentPage,
          totalPages: numPages,
          pageProgress: typeof m.progress === 'number' ? m.progress : 0,
        });
      }
    },
  });

  try {
    const texts: string[] = [];
    for (let p = 1; p <= numPages; p++) {
      currentPage = p;
      onProgress?.({ phase: 'ocr', page: p, totalPages: numPages, pageProgress: 0 });
      const page = await doc.getPage(p);
      const canvas = await renderPageToCanvas(page);
      const { data } = await worker.recognize(canvas);
      texts.push(data?.text ?? '');
      // Free the raster.
      canvas.width = 0;
      canvas.height = 0;
      onProgress?.({ phase: 'ocr', page: p, totalPages: numPages, pageProgress: 1 });
    }
    return texts.join('\n\n');
  } finally {
    await worker.terminate();
  }
}

/**
 * Extracts all text from a PDF File. Uses the native text layer when present;
 * otherwise (scanned/image PDF) falls back to OCR. `onProgress` reports OCR
 * progress page-by-page so the UI can show a progress bar.
 */
export async function extractPdfText(
  file: File,
  onProgress?: (p: ExtractProgress) => void,
): Promise<ExtractResult> {
  const doc = await loadPdf(file);
  try {
    onProgress?.({ phase: 'text', page: 0, totalPages: doc.numPages, pageProgress: 0 });
    const native = await extractNativeText(doc);
    if (native.replace(/\s+/g, '').length >= NATIVE_TEXT_MIN_CHARS) {
      return { text: native, ocr: false };
    }
    // No usable text layer -> scanned PDF -> OCR.
    const text = await ocrDocument(doc, onProgress);
    return { text, ocr: true };
  } finally {
    await doc.destroy();
  }
}
