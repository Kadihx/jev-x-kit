import { ReactNode } from "react";

export default function WindowCard({
  title,
  version,
  children,
  className = "",
}: {
  title: string;
  version?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`win-shadow border border-ink/80 bg-paper ${className}`}>
      <div className="flex items-center justify-between bg-bar px-3 py-1.5 text-paper">
        <span className="text-xs font-bold tracking-wide">{title}</span>
        {version && <span className="text-[10px] opacity-60">{version}</span>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
