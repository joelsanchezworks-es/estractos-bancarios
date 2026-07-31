'use client';

import type { StatsResponse } from '@/lib/types';

function timeAgo(iso: string | null): string {
  if (!iso) return 'Sin datos';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'Sin datos';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d`;
}

interface CardProps {
  label: string;
  value: string;
  sub?: string;
  danger?: boolean;
  loading?: boolean;
}

function Card({ label, value, sub, danger, loading }: CardProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p
        className={`mt-2 text-3xl font-semibold ${
          danger ? 'text-red-500' : 'text-white'
        }`}
      >
        {loading ? '—' : value}
      </p>
      {!loading && sub && (
        <p className="mt-1 truncate text-xs text-neutral-500" title={sub}>
          {sub}
        </p>
      )}
    </div>
  );
}

export default function StatsBar({
  stats,
  loading,
}: {
  stats: StatsResponse | null;
  loading: boolean;
}) {
  const pendientes = stats?.pendientesRevision ?? 0;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="Movimientos este mes"
        value={String(stats?.totalMovimientosMes ?? 0)}
        loading={loading}
      />
      <Card
        label="Comunidades esta semana"
        value={String(stats?.comunidadesSemana ?? 0)}
        loading={loading}
      />
      <Card
        label="Pendientes de revisión"
        value={String(pendientes)}
        danger={pendientes > 0}
        loading={loading}
      />
      <Card
        label="Último extracto procesado"
        value={timeAgo(stats?.ultimoProcesado ?? null)}
        sub={stats?.ultimoArchivo ?? undefined}
        loading={loading}
      />
    </div>
  );
}
