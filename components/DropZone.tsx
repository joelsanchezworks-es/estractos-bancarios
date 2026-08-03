'use client';

import { useRef, useState, type DragEvent } from 'react';
import type { PreparedExtracto, SabProcessResult } from '@/lib/types';
import { extractPdfText, type ExtractProgress } from '@/lib/pdfClient';

const STAGES = [
  '📄 Extrayendo texto del PDF…',
  '📋 Validando y leyendo el extracto…',
  '🤖 Clasificando movimientos con Claude…',
  '✍️ Actualizando celdas en el Sheet…',
];

const ACCEPTED = ['.pdf'];
// Concepts per classify request: keep each server call within one Claude batch
// so it stays well under Vercel's 10s function limit.
const CHUNK_SIZE = 15;

type Status = 'idle' | 'processing' | 'done' | 'error';

/** POSTs JSON and returns the parsed response, surfacing the EXACT error. */
async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    // Genuine network failure (offline / DNS / CORS).
    throw new Error(`No se pudo conectar con el servidor (${url}).`);
  }

  const raw = await res.text();
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    // Non-JSON body (e.g. a Vercel timeout/crash HTML page).
  }

  if (!res.ok) {
    const errMsg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : '';
    if (errMsg) throw new Error(errMsg);
    const snippet = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new Error(
      `Error ${res.status}${res.statusText ? ' ' + res.statusText : ''}${snippet ? ` — ${snippet}` : ''}`,
    );
  }

  if (data == null) throw new Error(`Respuesta no válida del servidor (${url}).`);
  return data as T;
}

/** Builds a minimal result object for the duplicate short-circuit. */
function duplicateResult(prepared: PreparedExtracto, filename: string): SabProcessResult {
  return {
    comunidad: prepared.comunidad ?? '',
    archivo: prepared.archivo ?? filename,
    tabCreada: false,
    duplicado: true,
    totalMovimientos: prepared.totalMovimientos ?? 0,
    ignorados: prepared.ignorados ?? 0,
    celdasActualizadas: 0,
    updates: [],
    pendientes: [],
    totalesPorCategoria: [],
    totalesPorMes: [],
    sheetUrl: prepared.sheetUrl ?? '',
  };
}

export default function DropZone({
  onProcessed,
}: {
  onProcessed: (result: SabProcessResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [stage, setStage] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState('');
  const [fileName, setFileName] = useState('');
  const [force, setForce] = useState(false);
  const [ocr, setOcr] = useState<{ page: number; total: number; pct: number } | null>(null);

  function hasValidExtension(name: string): boolean {
    return ACCEPTED.some((ext) => name.toLowerCase().endsWith(ext));
  }

  async function handleFile(file: File) {
    if (!hasValidExtension(file.name)) {
      setStatus('error');
      setMessage('Solo se admiten extractos PDF del Banco Sabadell.');
      return;
    }

    setFileName(file.name);
    setStatus('processing');
    setStage(0);
    setMessage('');
    setOcr(null);

    try {
      // --- Phase 0 (browser): extract text (pdf.js), OCR if scanned ---
      setStage(0);
      setMessage('📄 Extrayendo texto del PDF…');
      let extracted;
      try {
        extracted = await extractPdfText(file, (p: ExtractProgress) => {
          if (p.phase === 'ocr') {
            const total = Math.max(1, p.totalPages);
            const pct = Math.round(((p.page - 1 + p.pageProgress) / total) * 100);
            setOcr({ page: p.page, total: p.totalPages, pct });
            setMessage(
              `📸 PDF escaneado detectado, aplicando OCR (idioma español)… página ${p.page}/${p.totalPages}`,
            );
          }
        });
      } catch (e) {
        throw new Error(
          'No se pudo leer el PDF en el navegador: ' + (e instanceof Error ? e.message : String(e)),
        );
      }
      setOcr(null);
      const text = extracted.text;
      if (!text.trim()) {
        throw new Error(
          extracted.ocr
            ? 'El OCR no reconoció texto en el PDF escaneado. Comprueba que el escaneo sea legible.'
            : 'El PDF no contiene texto seleccionable (¿es un PDF escaneado?).',
        );
      }

      // --- Phase 1: parse + validate destination (server) ---
      setStage(1);
      const prepared = await postJson<PreparedExtracto>('/api/process/parse', {
        text,
        filename: file.name,
        force,
      });

      if (prepared.duplicado) {
        setStatus('done');
        setMessage(
          'Este PDF ya se había procesado (duplicado). Marca "Forzar reproceso" para repetirlo.',
        );
        onProcessed(duplicateResult(prepared, file.name));
        return;
      }

      const gastos = prepared.gastos ?? [];

      // --- Phase 2: classify concepts in small chunks ---
      setStage(2);
      const codigos: string[] = [];
      for (let i = 0; i < gastos.length; i += CHUNK_SIZE) {
        const chunk = gastos.slice(i, i + CHUNK_SIZE);
        setMessage(`🤖 Clasificando ${Math.min(i + chunk.length, gastos.length)}/${gastos.length}…`);
        const r = await postJson<{ codigos?: string[] }>('/api/process/classify', {
          conceptos: chunk.map((g) => g.concepto),
        });
        const cs = Array.isArray(r.codigos) ? r.codigos : [];
        for (let j = 0; j < chunk.length; j++) codigos.push(cs[j] ?? '');
      }

      // --- Phase 3: write to the Sheet (server) ---
      setStage(3);
      setMessage('');
      const classified = gastos.map((g, i) => ({ ...g, codigo: codigos[i] ?? '' }));
      const result = await postJson<SabProcessResult>('/api/process/apply', {
        comunidad: prepared.comunidad,
        hash: prepared.hash,
        archivo: prepared.archivo,
        already: prepared.already,
        totalMovimientos: prepared.totalMovimientos,
        ignorados: prepared.ignorados,
        gastos: classified,
      });

      if (result.error) {
        setStatus('error');
        setMessage(result.error);
      } else {
        setStatus('done');
        setMessage(
          `✅ Completado — ${result.comunidad}: ${result.celdasActualizadas} celda(s) actualizada(s)` +
            (result.pendientes.length > 0 ? ` · ${result.pendientes.length} pendiente(s)` : ''),
        );
      }

      onProcessed(result);
    } catch (err) {
      console.error('[DropZone]', err);
      setOcr(null);
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Error procesando el archivo.');
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const progressPct =
    status === 'done'
      ? 100
      : ocr
        ? ocr.pct
        : status === 'processing'
          ? ((stage + 1) / (STAGES.length + 1)) * 100
          : 0;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
          dragging
            ? 'border-accent bg-accent/10'
            : 'border-accent/50 bg-surface hover:border-accent hover:bg-accent/5'
        }`}
      >
        <svg
          width="44"
          height="44"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#f97316"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="mt-4 text-lg font-medium text-white">
          Arrastra el extracto PDF del Sabadell aquí
        </p>
        <p className="mt-1 text-sm text-neutral-400">o haz clic para seleccionar archivo</p>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
      </div>

      <label className="mt-3 flex w-fit cursor-pointer select-none items-center gap-2 text-sm text-neutral-400">
        <input
          type="checkbox"
          checked={force}
          onChange={(e) => setForce(e.target.checked)}
          className="h-4 w-4 rounded border-border bg-surface-2 accent-[#f97316]"
        />
        Forzar reproceso (ignorar detección de duplicados)
      </label>

      {(status === 'processing' || status === 'done' || status === 'error') && (
        <div className="mt-4 rounded-xl border border-border bg-surface p-4">
          {fileName && (
            <p className="mb-2 truncate text-sm text-neutral-400">{fileName}</p>
          )}

          {status !== 'error' && (
            <>
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-white">
                  {status === 'done'
                    ? '✅ Completado'
                    : ocr
                      ? `📸 OCR en curso — página ${ocr.page}/${ocr.total}`
                      : STAGES[stage]}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </>
          )}

          {message && (
            <p
              className={`mt-3 text-sm ${
                status === 'error' ? 'text-red-400' : 'text-neutral-300'
              }`}
            >
              {message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
