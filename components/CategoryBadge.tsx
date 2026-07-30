import { getCategoryColor } from '@/lib/categories';

export default function CategoryBadge({ categoria }: { categoria: string }) {
  const { bg, text } = getCategoryColor(categoria);
  return (
    <span
      style={{ backgroundColor: bg, color: text }}
      className="inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold"
    >
      {categoria}
    </span>
  );
}
