export default function CornerFrame({
  className = "",
  dark = false,
}: {
  className?: string;
  dark?: boolean;
}) {
  const color = dark ? "text-paper/60" : "text-ink/40";
  return (
    <div className={`pointer-events-none absolute inset-4 ${className}`}>
      <span className={`absolute -top-1 -left-1 h-4 w-4 border-l-2 border-t-2 ${color}`} />
      <span className={`absolute -top-1 -right-1 h-4 w-4 border-r-2 border-t-2 ${color}`} />
      <span className={`absolute -bottom-1 -left-1 h-4 w-4 border-l-2 border-b-2 ${color}`} />
      <span className={`absolute -bottom-1 -right-1 h-4 w-4 border-r-2 border-b-2 ${color}`} />
    </div>
  );
}
