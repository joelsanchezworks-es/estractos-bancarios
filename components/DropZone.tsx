'use client';

import { useRef, useState, type DragEvent } from 'react';
import type { SabProcessResult } from '@/lib/types';

const STAGES = [
  '📄 Leyendo PDF del Sabadell…',
  '📋 Verificando pestaña en Sheet…',
  '🤖 Clasificando movimientos con Claude…',
  '✍️ Actualizando celdas en Sheet…',
];

const ACCEPTED = ['.pdf'];

type Status = 'idle' | 'processing' | 'done' | 'error';

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

    // Advance the visible stage while the request is in flight (best-effort UX).
    const timer = setInterval(() => {
      setStage((s) => (s < STAGES.length - 1 ? s + 1 : s));
    }, 1200);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (force) formData.append('force', 'true');

      const res = await fetch('/api/process', { method: 'POST', body: formData });
      clearInterval(timer);

      const data = await res.json();

      if (!res.ok) {
        setStatus('error');
        setMessage(data?.error ?? 'Error procesando el archivo.');
        return;
      }

      const result = data as SabProcessResult;

      if (result.duplicado) {
        setStatus('done');
        setMessage('Este PDF ya se había procesado (duplicado). Marca "Forzar reproceso" para repetirlo.');
      } else if (result.error) {
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
      clearInterval(timer);
      console.error(err);
      setStatus('error');
      setMessage('Error de red al procesar el archivo.');
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const progressPct =
    status === 'done' ? 100 : status === 'processing' ? ((stage + 1) / (STAGES.length + 1)) * 100 : 0;

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
                  {status === 'done' ? '✅ Completado' : STAGES[stage]}
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
