"use client";

import { useEffect, useState } from "react";

function fmtDuration(ms: number) {
  const neg = ms < 0;
  ms = Math.abs(ms);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
  if (h > 99) {
    const d = Math.floor(h / 24);
    return (neg ? "+" : "") + d + "д " + pad(h % 24) + "ч";
  }
  return (neg ? "+" : "") + pad(h) + ":" + pad(m) + ":" + pad(s);
}

export function countdownState(deadline: number): "normal" | "warning" | "critical" | "overdue" {
  const diff = deadline - Date.now();
  if (diff <= 0) return "overdue";
  if (diff < 30 * 60_000) return "critical";
  if (diff < 3 * 3600_000) return "warning";
  return "normal";
}

export function Countdown({ deadline, big = false }: { deadline: string; big?: boolean }) {
  const deadlineMs = new Date(deadline).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const diff = deadlineMs - now;
  const state = countdownState(deadlineMs);
  const text = diff > 0 ? fmtDuration(diff) : "ПРОСРОЧЕНО " + fmtDuration(diff);

  return (
    <div className={big ? `big mono ${state}` : `countdown ${state}`} suppressHydrationWarning>
      {text}
    </div>
  );
}

export function CountdownSubLabel({ deadline }: { deadline: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = new Date(deadline).getTime() - now;
  return <div className="cd-label">{diff > 0 ? "осталось" : "просрочено"}</div>;
}
