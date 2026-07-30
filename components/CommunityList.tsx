'use client';

import type { ComunidadResumen } from '@/lib/types';

export default function CommunityList({
  comunidades,
}: {
  comunidades: ComunidadResumen[];
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-white">Comunidades esta semana</h2>
      </div>

      {comunidades.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-neutral-500">
          Sin actividad esta semana.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {comunidades.map((c) => (
            <li key={c.nombre} className="flex items-center justify-between px-5 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-200">{c.nombre}</p>
                <p className="text-xs text-neutral-500">{c.movimientos} movimiento(s)</p>
              </div>
              <span
                className={`ml-3 inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  c.estado === 'Revisar'
                    ? 'bg-red-500/15 text-red-400'
                    : 'bg-green-500/15 text-green-400'
                }`}
              >
                {c.estado}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
