// Copies the pdf.js worker into public/ so it is served from our own origin
// (same-origin module worker). Runs on postinstall so the deployed worker
// always matches the installed pdfjs-dist version. The worker file is also
// committed as a fallback in case install scripts are skipped.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const destDir = path.join(__dirname, '..', 'public');
const dest = path.join(destDir, 'pdf.worker.min.mjs');

try {
  if (!fs.existsSync(src)) {
    console.warn('[copy-pdf-worker] source not found, keeping committed worker:', src);
    process.exit(0);
  }
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('[copy-pdf-worker] copied worker ->', dest);
} catch (err) {
  // Non-fatal: a committed public/pdf.worker.min.mjs is the fallback.
  console.error('[copy-pdf-worker] failed (non-fatal):', err.message);
  process.exit(0);
}
