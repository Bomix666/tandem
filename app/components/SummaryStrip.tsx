"use client";

import { useEffect, useRef, useState } from "react";

function CountUp({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [value, setValue] = useState(0);
  const prevTarget = useRef<number | null>(null);

  useEffect(() => {
    if (prevTarget.current === target) return;
    prevTarget.current = target;
    const start = performance.now();
    const dur = 700;
    let raf: number;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return (
    <>
      {value}
      {suffix}
    </>
  );
}

export function SummaryStrip({ active, doneToday, avgProgress }: { active: number; doneToday: number; avgProgress: number }) {
  return (
    <div className="summary">
      <div className="cell">
        <div className="num">
          <CountUp target={active} />
        </div>
        <div className="cap label">Активно</div>
      </div>
      <div className="cell">
        <div className="num">
          <CountUp target={doneToday} />
        </div>
        <div className="cap label">Сделано сегодня</div>
      </div>
      <div className="cell prog">
        <div className="num">
          <CountUp target={avgProgress} suffix="%" />
        </div>
        <div className="cap label">Прогресс</div>
      </div>
    </div>
  );
}

export function DoneStats({ completed, onTimePct }: { completed: number; onTimePct: number }) {
  return (
    <div className="summary" style={{ marginTop: 14 }}>
      <div className="cell">
        <div className="num">
          <CountUp target={completed} />
        </div>
        <div className="cap label">Завершено</div>
      </div>
      <div className="cell">
        <div className="num">
          <CountUp target={onTimePct} suffix="%" />
        </div>
        <div className="cap label">Вовремя</div>
      </div>
    </div>
  );
}
