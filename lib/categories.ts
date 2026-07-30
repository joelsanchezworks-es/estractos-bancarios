// Category configuration shared by the Claude prompt, the Sheets routing logic
// and the UI badges. Keep this list in sync with the Claude system prompt.

export const CATEGORIAS = [
  'Luz',
  'Agua',
  'Seguro',
  'Reparacion Electrica',
  'Fontaneria',
  'Jardineria',
  'Limpieza',
  'Cuotas',
  'Otros',
] as const;

export type Categoria = (typeof CATEGORIAS)[number];

export const PENDIENTE_LABEL = 'Pendiente Revision';

interface BadgeColor {
  bg: string;
  text: string;
}

// Badge colours per the spec. Hex values are used inline (rather than Tailwind
// class names) so dynamic categories are never purged from the CSS bundle.
export const CATEGORY_COLORS: Record<string, BadgeColor> = {
  Luz: { bg: '#22c55e', text: '#052e16' },
  Agua: { bg: '#22c55e', text: '#052e16' },
  Seguro: { bg: '#3b82f6', text: '#0b1e3f' },
  Cuotas: { bg: '#3b82f6', text: '#0b1e3f' },
  'Reparacion Electrica': { bg: '#f97316', text: '#2a1206' },
  Fontaneria: { bg: '#f97316', text: '#2a1206' },
  Jardineria: { bg: '#eab308', text: '#2a2205' },
  Limpieza: { bg: '#eab308', text: '#2a2205' },
  Otros: { bg: '#6b7280', text: '#f9fafb' },
  [PENDIENTE_LABEL]: { bg: '#ef4444', text: '#fef2f2' },
};

const DEFAULT_COLOR: BadgeColor = { bg: '#6b7280', text: '#f9fafb' };

export function getCategoryColor(categoria: string): BadgeColor {
  return CATEGORY_COLORS[categoria] ?? DEFAULT_COLOR;
}

/** Normalizes a model-provided category to one of the exact allowed values. */
export function normalizeCategoria(value: unknown): Categoria {
  if (typeof value !== 'string') return 'Otros';
  const cleaned = value.trim().toLowerCase();
  const match = CATEGORIAS.find((c) => c.toLowerCase() === cleaned);
  return (match as Categoria) ?? 'Otros';
}
