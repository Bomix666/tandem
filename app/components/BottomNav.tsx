"use client";

// Нижнее меню оболочки: плавающая «пилюля» с четырьмя разделами и поднятой
// центральной кнопкой действия (новая задача; на «Клиентах» — поиск клиентов).

import { haptic } from "@/lib/telegram-client";

export type ViewName = "home" | "tasks" | "leads" | "activity";

export function BottomNav({ view, onChange, onCenter }: { view: ViewName; onChange: (v: ViewName) => void; onCenter: () => void }) {
  return (
    <nav className="bottom">
      <div className="nav-pill">
        <NavButton active={view === "home"} label="Главная" onClick={() => onChange("home")}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
        </NavButton>
        <NavButton active={view === "tasks"} label="Задачи" onClick={() => onChange("tasks")}>
          <rect x="5" y="4.5" width="14" height="16" rx="3" />
          <path d="M9 3.5h6v3H9zM9 12l2 2 4-4" />
        </NavButton>
        <button
          className="nav-center"
          aria-label={view === "leads" ? "Найти клиентов" : "Новая задача"}
          onClick={() => {
            haptic("medium");
            onCenter();
          }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M11 3.5c.3 3.9 1.6 5.2 5.5 5.5-3.9.3-5.2 1.6-5.5 5.5-.3-3.9-1.6-5.2-5.5-5.5 3.9-.3 5.2-1.6 5.5-5.5Z" />
            <path d="M17.5 13c.2 2.4 1 3.2 3.5 3.5-2.5.3-3.3 1.1-3.5 3.5-.3-2.4-1.1-3.2-3.5-3.5 2.4-.3 3.2-1.1 3.5-3.5Z" />
          </svg>
        </button>
        <NavButton active={view === "leads"} label="Клиенты" onClick={() => onChange("leads")}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </NavButton>
        <NavButton active={view === "activity"} label="Лента" onClick={() => onChange("activity")}>
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
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
      <span>{label}</span>
    </button>
  );
}
