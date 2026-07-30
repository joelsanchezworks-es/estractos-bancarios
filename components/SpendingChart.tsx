'use client';

import { getCategoryColor } from '@/lib/categories';
import type { StatsResponse } from '@/lib/types';

function formatEur(n: number): string {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(n);
}

export default function SpendingChart({
  data,
}: {
  data: StatsResponse['gastosPorCategoria'];
}) {
  const total = data.reduce((sum, d) => sum + d.total, 0);

  const RADIUS = 60;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const STROKE = 26;

  let offset = 0;
  const segments = data.map((d) => {
    const frac = total > 0 ? d.total / total : 0;
    const len = frac * CIRCUMFERENCE;
    const seg = {
      categoria: d.categoria,
      total: d.total,
      color: getCategoryColor(d.categoria).bg,
      len,
      offset,
      pct: Math.round(frac * 100),
    };
    offset += len;
    return seg;
  });

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <h2 className="mb-4 text-sm font-semibold text-white">Gastos por categoría (mes)</h2>

      {total === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-500">
          Sin gastos registrados este mes.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
            <circle
              cx="80"
              cy="80"
              r={RADIUS}
              fill="none"
              stroke="#1c1c1c"
              strokeWidth={STROKE}
            />
            {segments.map((seg) => (
              <circle
                key={seg.categoria}
                cx="80"
                cy="80"
                r={RADIUS}
                fill="none"
                stroke={seg.color}
                strokeWidth={STROKE}
                strokeDasharray={`${seg.len} ${CIRCUMFERENCE - seg.len}`}
                strokeDashoffset={-seg.offset}
                transform="rotate(-90 80 80)"
              />
            ))}
            <text
              x="80"
              y="76"
              textAnchor="middle"
              className="fill-white"
              style={{ fontSize: '18px', fontWeight: 600 }}
            >
              {formatEur(total)}
            </text>
            <text
              x="80"
              y="94"
              textAnchor="middle"
              className="fill-neutral-500"
              style={{ fontSize: '10px' }}
            >
              total gastos
            </text>
          </svg>

          <ul className="w-full space-y-2">
            {segments.map((seg) => (
              <li key={seg.categoria} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-sm"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="text-neutral-300">{seg.categoria}</span>
                </span>
                <span className="text-neutral-400">
                  {formatEur(seg.total)} <span className="text-neutral-600">· {seg.pct}%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
