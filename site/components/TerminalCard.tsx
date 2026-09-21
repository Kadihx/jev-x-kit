import { ReactNode } from "react";

export default function TerminalCard({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`win-shadow border border-ink/80 bg-ink text-lime-400 ${className}`}>
      <div className="flex items-center gap-1.5 bg-bar px-3 py-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-pink-500/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-paper/40" />
        <span className="h-2.5 w-2.5 rounded-full bg-paper/20" />
        <span className="ml-2 truncate text-[11px] text-paper/70">{label}</span>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap p-4 text-[12px] leading-relaxed">
        {children}
      </pre>
    </div>
  );
}
