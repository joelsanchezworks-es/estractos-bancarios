// pdf-parse ships types only for its root entry point. We import the internal
// lib path directly to avoid the debug-mode test-file read in the package root,
// so we declare the subpath module here.
declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PDFInfo {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
    text: string;
  }

  function pdf(
    dataBuffer: Buffer | Uint8Array,
    options?: Record<string, unknown>,
  ): Promise<PDFInfo>;

  export = pdf;
}
