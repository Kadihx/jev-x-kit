"use client";

import { useEffect, useState } from "react";

export default function ClockWidget() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="win-shadow w-fit border border-ink/80 bg-paper">
      <div className="bg-bar px-3 py-1.5 text-[11px] font-bold text-paper">
        Gatekeeper 1.1
      </div>
      <div className="space-y-1 p-3 text-[11px]">
        <div>confidence &gt; 0.85 → execute</div>
        <div>0.60 – 0.85 → speculative</div>
        <div>&lt; 0.60 → System 2</div>
        <div className="pt-1 text-ink/50">
          {now
            ? now.toLocaleTimeString("en-US", { hour12: false })
            : "00:00:00"}
        </div>
      </div>
    </div>
  );
}
