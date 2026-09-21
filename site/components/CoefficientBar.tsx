export default function CoefficientBar({
  label,
  multiplier,
  value,
  maxMultiplier,
  highlight = false,
}: {
  label: string;
  multiplier: number;
  value: string;
  maxMultiplier: number;
  highlight?: boolean;
}) {
  const pct = Math.min(100, (multiplier / maxMultiplier) * 100);
  return (
    <div className="border-b border-ink/15 py-3 last:border-none">
      <div className="flex items-center justify-between text-sm">
        <span
          className={`tag-pill font-bold ${highlight ? "bg-lime-400/70" : ""}`}
        >
          {label}
        </span>
        <span className="font-bold">{multiplier}x</span>
        <span className="text-ink/60">{value}</span>
      </div>
      <div className="mt-2 h-[3px] w-full bg-ink/10">
        <div
          className={`h-full ${highlight ? "bg-ink" : "bg-ink/50"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
