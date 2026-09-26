"use client";

import { haptic } from "@/lib/telegram-client";

export type ViewName = "home" | "tasks" | "done" | "activity";

export function BottomNav({ view, onChange }: { view: ViewName; onChange: (v: ViewName) => void }) {
  return (
    <nav className="bottom">
      <div className="nav-pill">
        <NavButton active={view === "home"} label="Главная" onClick={() => onChange("home")}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
        </NavButton>
        <NavButton active={view === "tasks"} label="Задачи" onClick={() => onChange("tasks")}>
          <rect x="4" y="4" width="16" height="16" rx="4" />
          <path d="M8 12h8M8 16h5" />
        </NavButton>
        <NavButton active={view === "done"} label="Готово" onClick={() => onChange("done")}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M8.5 12.5l2.3 2.3 4.7-5" />
        </NavButton>
        <NavButton active={view === "activity"} label="Активность" onClick={() => onChange("activity")}>
          <path d="M3 12h4l2 7 4-14 2 7h6" />
        </NavButton>
      </div>
    </nav>
  );
}

function NavButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={`nav-item${active ? " active" : ""}`}
      onClick={() => {
        haptic("light");
        onClick();
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        {children}
      </svg>
      <span>{label}</span>
    </button>
  );
}

export function Fab({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="fab"
      onClick={() => {
        haptic("medium");
        onClick();
      }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    </button>
  );
}
