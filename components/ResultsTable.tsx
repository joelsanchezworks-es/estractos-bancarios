'use client';

import type { MovimientoClasificado } from '@/lib/types';
import CategoryBadge from './CategoryBadge';

function formatImporte(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(n);
}

export default function ResultsTable({
  movimientos,
}: {
  movimientos: MovimientoClasificado[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-white">Resultados del último extracto</h2>
      </div>

      {movimientos.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-neutral-500">
          Sube un extracto para ver los movimientos clasificados.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-3 font-medium">Fecha</th>
                <th className="px-4 py-3 font-medium">Descripción</th>
                <th className="px-4 py-3 text-right font-medium">Importe</th>
                <th className="px-4 py-3 font-medium">Categoría</th>
                <th className="px-4 py-3 font-medium">Confianza</th>
                <th className="px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m, i) => (
                <tr
                  key={`${m.fecha}-${i}`}
                  className="border-b border-border/50 last:border-0 hover:bg-surface-2/50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-300">{m.fecha}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-neutral-200" title={m.descripcion}>
                    {m.descripcion || '—'}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right font-medium ${
                      m.importe < 0 ? 'text-red-400' : 'text-green-400'
                    }`}
                  >
                    {formatImporte(m.importe)}
                  </td>
                  <td className="px-4 py-3">
                    <CategoryBadge categoria={m.categoria} />
                  </td>
                  <td className="px-4 py-3 capitalize text-neutral-400">{m.confianza}</td>
                  <td className="px-4 py-3">
                    {m.revisar ? (
                      <span className="inline-flex items-center rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-400">
                        Pendiente
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-semibold text-green-400">
                        OK
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
