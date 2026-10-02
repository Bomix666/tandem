"use client";

// Выбор даты follow-up: через 2 / 5 / 7 дней (в 10:00) или своя дата и время.

import { useState } from "react";
import { formatDayTime } from "./format";

export type FollowUpWhen = { days: number } | { at: string };

interface Props {
  /** Уже стоящая дата — новая заменит её. */
  current?: string | null;
  title?: string;
  busy?: boolean;
  onPick: (when: FollowUpWhen) => void;
  /** «Без напоминания» (после «✅ Я отправил»). */
  onSkip?: () => void;
}

function tomorrowAt10(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

export function FollowUpPicker({ current, title, busy, onPick, onSkip }: Props) {
  const [custom, setCustom] = useState(false);
  const [value, setValue] = useState(tomorrowAt10);
  const valid = value && new Date(value).getTime() > Date.now();

  return (
    <div className="picker">
      <div className="label">{title ?? "⏰ Когда напомнить?"}</div>
      {current && (
        <div className="o-hint" style={{ marginTop: 6 }}>
          Сейчас стоит {formatDayTime(current)} — новая дата заменит её.
        </div>
      )}
      <div className="chiprow">
        {[2, 5, 7].map((d) => (
          <button key={d} className="pickchip" disabled={busy} onClick={() => onPick({ days: d })}>
            Через {d} {d === 2 ? "дня" : "дней"}
          </button>
        ))}
        <button className={`pickchip${custom ? " active" : ""}`} onClick={() => setCustom(!custom)}>
          📅 Своя дата
        </button>
      </div>
      {custom && (
        <>
          <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
          <button className="secondary-btn" style={{ marginTop: 8 }} disabled={!valid || busy} onClick={() => onPick({ at: new Date(value).toISOString() })}>
            {valid ? "Поставить" : "Дата должна быть в будущем"}
          </button>
        </>
      )}
      {onSkip && (
        <button className="ghost-btn" onClick={onSkip}>
          Без напоминания
        </button>
      )}
      <div className="o-hint">Follow-up — задача в «Задачах»; в срок бот пришлёт напоминание с кнопками.</div>
    </div>
  );
}
