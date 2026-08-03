'use client';

import type { SabProcessResult } from '@/lib/types';

function formatEur(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(n);
}

export default function ResultsTable({ result }: { result: SabProcessResult | null }) {
  if (!result) {
    return (
      <div className="rounded-2xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-white">Resumen del último extracto</h2>
        </div>
        <p className="px-5 py-10 text-center text-sm text-neutral-500">
          Sube un extracto PDF del Sabadell para ver el resumen de actualizaciones.
        </p>
      </div>
    );
  }

  const { updates, totalesPorCategoria, totalesPorMes } = result;

  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-white">
          Resumen — {result.comunidad || 'comunidad'}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {result.tabCreada && (
            <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 font-semibold text-blue-400">
              Pestaña creada
            </span>
          )}
          <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 font-semibold text-green-400">
            {result.celdasActualizadas} celda(s) actualizada(s)
          </span>
          {result.ignorados > 0 && (
            <span className="rounded-full bg-neutral-500/15 px-2.5 py-0.5 font-semibold text-neutral-300">
              {result.ignorados} ignorado(s)
            </span>
          )}
          {result.pendientes.length > 0 && (
            <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 font-semibold text-red-400">
              {result.pendientes.length} pendiente(s)
            </span>
          )}
        </div>
      </div>

      {result.error && (
        <p className="mx-5 mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {result.error}
        </p>
      )}

      {updates.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-neutral-500">
          No se actualizó ninguna celda.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-3 font-medium">Concepto</th>
                  <th className="px-4 py-3 font-medium">Categoría</th>
                  <th className="px-4 py-3 font-medium">Mes</th>
                  <th className="px-4 py-3 text-right font-medium">Importe</th>
                  <th className="px-4 py-3 text-right font-medium">Celda ant.</th>
                  <th className="px-4 py-3 text-right font-medium">Celda nueva</th>
                </tr>
              </thead>
              <tbody>
                {updates.map((u, i) => (
                  <tr
                    key={`${u.celda}-${i}`}
                    className="border-b border-border/50 last:border-0 hover:bg-surface-2/50"
                  >
                    <td className="max-w-xs truncate px-4 py-3 text-neutral-200" title={u.concepto}>
                      {u.concepto}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-neutral-300">
                      <span className="font-mono text-xs text-neutral-500">{u.codigo}</span>{' '}
                      {u.categoria}
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{u.mes}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-white">
                      {formatEur(u.importe)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-neutral-500">
                      {formatEur(u.celdaAnterior)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-green-400">
                      {formatEur(u.celdaNueva)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-border p-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                Totales por categoría
              </p>
              <ul className="space-y-1 text-sm">
                {totalesPorCategoria.map((t) => (
                  <li key={t.categoria} className="flex justify-between">
                    <span className="truncate text-neutral-300">{t.categoria}</span>
                    <span className="ml-3 shrink-0 text-neutral-400">{formatEur(t.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
                Totales por mes
              </p>
              <ul className="space-y-1 text-sm">
                {totalesPorMes.map((t) => (
                  <li key={t.mes} className="flex justify-between">
                    <span className="text-neutral-300">{t.mes}</span>
                    <span className="ml-3 shrink-0 text-neutral-400">{formatEur(t.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
