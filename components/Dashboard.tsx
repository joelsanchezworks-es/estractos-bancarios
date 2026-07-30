'use client';

import { useCallback, useEffect, useState } from 'react';
import { signOut } from 'next-auth/react';
import type { ProcessResult, StatsResponse } from '@/lib/types';
import StatsBar from './StatsBar';
import DropZone from './DropZone';
import ResultsTable from './ResultsTable';
import CommunityList from './CommunityList';
import SpendingChart from './SpendingChart';

function formatEur(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(n);
}

export default function Dashboard({
  userName,
  sheetUrl,
}: {
  userName: string;
  sheetUrl: string;
}) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastResult, setLastResult] = useState<ProcessResult | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats', { cache: 'no-store' });
      if (res.ok) {
        const data: StatsResponse = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Error cargando estadísticas', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleProcessed = useCallback(
    (result: ProcessResult) => {
      setLastResult(result);
      // Refresh aggregated stats after a successful, non-duplicate import.
      if (!result.duplicado) loadStats();
    },
    [loadStats],
  );

  const effectiveSheetUrl = stats?.sheetUrl || sheetUrl;
  const pendientes = stats?.pendientes ?? [];

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 ring-1 ring-accent/30">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#f97316"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M3 10h18" />
                <path d="M7 15h4" />
              </svg>
            </span>
            <span className="text-base font-semibold text-white">Extractos Bancarios</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden items-center gap-2 text-sm text-neutral-400 sm:flex">
              <span className="pulse-dot inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
              Sistema activo
            </span>
            <span className="hidden text-sm text-neutral-300 sm:inline">
              Bienvenido, <span className="font-medium text-white">{userName}</span>
            </span>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-neutral-300 transition hover:border-accent hover:text-white"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <StatsBar stats={stats} loading={loading} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* Left column (60%) */}
          <div className="space-y-6 lg:col-span-3">
            <DropZone onProcessed={handleProcessed} />
            <ResultsTable movimientos={lastResult?.movimientos ?? []} />
          </div>

          {/* Right column (40%) */}
          <div className="space-y-6 lg:col-span-2">
            <CommunityList comunidades={stats?.comunidades ?? []} />

            {/* Pending review */}
            <div className="rounded-2xl border border-border bg-surface">
              <div className="border-b border-border px-5 py-4">
                <h2 className="text-sm font-semibold text-white">
                  Pendientes de revisión
                  {pendientes.length > 0 && (
                    <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
                      {pendientes.length}
                    </span>
                  )}
                </h2>
              </div>
              {pendientes.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-neutral-500">
                  No hay movimientos pendientes.
                </p>
              ) : (
                <ul className="max-h-64 divide-y divide-border/50 overflow-y-auto">
                  {pendientes.slice(0, 30).map((p, i) => (
                    <li key={`${p.fecha}-${i}`} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-red-300" title={p.descripcion}>
                            {p.descripcion || '—'}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {p.fecha} · {p.comunidad} · sugerida: {p.categoriaSugerida}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-medium text-red-400">
                          {formatEur(p.importe)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <a
              href={effectiveSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-3 font-semibold text-white transition hover:bg-accent-hover"
            >
              Ver Google Sheet completo
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>

            <SpendingChart data={stats?.gastosPorCategoria ?? []} />
          </div>
        </div>
      </main>
    </div>
  );
}
