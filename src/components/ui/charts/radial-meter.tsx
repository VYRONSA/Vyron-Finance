import { AnimatedNumber } from "@/components/ui/animated-number";

/**
 * A single ratio against a limit — Recovery Health in the hero. Per the
 * dataviz skill's form table ("single ratio against a limit -> Meter,
 * same-ramp track"): the unfilled track is a lighter step of the same
 * hue as the fill, so state reads across the whole ring, not just the arc.
 */
export function RadialMeter({
  value,
  size = 128,
  strokeWidth = 10,
  color = "var(--color-vf-red-400)",
  trackColor = "rgba(47,151,224,0.16)",
  label,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - clamped / 100);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={label ?? `${clamped}%`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.9s cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-mono text-2xl font-semibold tabular-nums text-vf-on-dark">
          <AnimatedNumber value={Math.round(clamped)} suffix="%" />
        </span>
      </div>
    </div>
  );
}
