/**
 * A minimal, non-interactive trend line for dense contexts (hero stat
 * chips) where a full TrendChart would be too heavy. Decorative-only —
 * the number beside it already carries the value, so no tooltip/legend.
 */
export function Sparkline({
  data,
  color = "currentColor",
  height = 28,
}: {
  data: number[];
  color?: string;
  height?: number;
}) {
  const width = 100;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-7 w-full overflow-visible" aria-hidden>
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity="0.85" />
    </svg>
  );
}

/** Bar-form variant, for chips whose story is discrete daily activity
 * rather than a continuous trend. */
export function SparkBars({ data, color = "currentColor", height = 28 }: { data: number[]; color?: string; height?: number }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex h-7 items-end gap-[3px]" aria-hidden>
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-[2px]"
          style={{ height: `${Math.max((v / max) * height, 2)}px`, backgroundColor: color, opacity: 0.7 + (i / data.length) * 0.3 }}
        />
      ))}
    </div>
  );
}
