"use client";

import { useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { haptic } from "@/lib/telegram-client";
import * as api from "@/lib/api";
import type { Priority } from "@/types";
import type { RecurrenceFrequency } from "@/lib/api";

const DEADLINE_OPTIONS: { key: string; label: string; compute: () => number }[] = [
  {
    key: "today",
    label: "Сегодня",
    compute: () => {
      const d = new Date();
      d.setHours(18, 0, 0, 0);
      if (d.getTime() < Date.now()) d.setTime(Date.now() + 3600_000);
      return d.getTime();
    },
  },
  {
    key: "tomorrow",
    label: "Завтра",
    compute: () => {
      const d = new Date(Date.now() + 24 * 3600_000);
      d.setHours(12, 0, 0, 0);
      return d.getTime();
    },
  },
  { key: "week", label: "На этой неделе", compute: () => Date.now() + 4 * 24 * 3600_000 },
  { key: "nextweek", label: "На следующей", compute: () => Date.now() + 9 * 24 * 3600_000 },
];

const PRIORITIES: { key: Priority; label: string }[] = [
  { key: "LOW", label: "Низкий" },
  { key: "MEDIUM", label: "Средний" },
  { key: "HIGH", label: "Высокий" },
  { key: "URGENT", label: "Срочно" },
];

const REPEAT_OPTIONS: { key: RecurrenceFrequency | "NEVER"; label: string }[] = [
  { key: "NEVER", label: "Никогда" },
  { key: "DAILY", label: "Каждый день" },
  { key: "WEEKDAYS", label: "По будням" },
  { key: "WEEKLY", label: "Каждую неделю" },
  { key: "MONTHLY", label: "Каждый месяц" },
  { key: "CUSTOM", label: "Свои дни" },
];

const WEEKDAY_LABELS: { iso: number; label: string }[] = [
  { iso: 1, label: "ПН" },
  { iso: 2, label: "ВТ" },
  { iso: 3, label: "СР" },
  { iso: 4, label: "ЧТ" },
  { iso: 5, label: "ПТ" },
  { iso: 6, label: "СБ" },
  { iso: 7, label: "ВС" },
];

function parseQuick(text: string) {
  let title = text;
  let deadline: number | null = null;
  const lower = text.toLowerCase();
  const timeMatch = lower.match(/(\d{1,2})(:(\d{2}))?\s*(am|pm)?/);
  let base: Date | null = null;

  if (/(tomorrow|завтра)/.test(lower)) {
    base = new Date(Date.now() + 24 * 3600_000);
    title = title.replace(/tomorrow/i, "").replace(/завтра/i, "");
  } else if (/(tonight|сегодня вечером)/.test(lower)) {
    base = new Date();
    title = title.replace(/tonight/i, "").replace(/сегодня вечером/i, "");
  } else if (/(today|сегодня)/.test(lower)) {
    base = new Date();
    title = title.replace(/today/i, "").replace(/сегодня/i, "");
  }

  if (base && timeMatch?.[0].trim()) {
    let h = parseInt(timeMatch[1]!, 10);
    const m = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    if (timeMatch[4] === "pm" && h < 12) h += 12;
    base.setHours(h, m, 0, 0);
    title = title.replace(timeMatch[0], "");
    deadline = base.getTime();
  } else if (base) {
    base.setHours(18, 0, 0, 0);
    deadline = base.getTime();
  }

  return { title: title.replace(/\s+/g, " ").trim(), deadline };
}

export function NewTaskSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, otherMemberId, createTask, showToast, refreshAll } = useWorkspace();
  const [quick, setQuick] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [assignee, setAssignee] = useState<string>(user?.id ?? "");
  const [deadlineKey, setDeadlineKey] = useState<string | null>(null);
  const [customDeadline, setCustomDeadline] = useState<number | null>(null);
  const [priority, setPriority] = useState<Priority>("MEDIUM");
  const [repeat, setRepeat] = useState<RecurrenceFrequency | "NEVER">("NEVER");
  const [repeatWeekdays, setRepeatWeekdays] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const effectiveAssignee = assignee || user?.id || "";

  function reset() {
    setQuick("");
    setTitle("");
    setDesc("");
    setAssignee(user?.id ?? "");
    setDeadlineKey(null);
    setCustomDeadline(null);
    setPriority("MEDIUM");
    setRepeat("NEVER");
    setRepeatWeekdays([]);
  }

  function handleQuickChange(v: string) {
    setQuick(v);
    const parsed = parseQuick(v);
    setTitle(parsed.title);
    if (parsed.deadline) {
      setCustomDeadline(parsed.deadline);
      setDeadlineKey("custom");
    }
  }

  function toggleWeekday(iso: number) {
    setRepeatWeekdays((prev) => (prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort()));
  }

  async function submit() {
    const finalTitle = title.trim() || quick.trim();
    if (!finalTitle) {
      showToast("Сначала укажите название");
      return;
    }
    if (repeat === "CUSTOM" && repeatWeekdays.length === 0) {
      showToast("Выберите хотя бы один день недели");
      return;
    }
    const deadlineMs = customDeadline ?? Date.now() + 24 * 3600_000;
    setSubmitting(true);
    try {
      let recurrenceId: string | undefined;
      if (repeat !== "NEVER") {
        const deadlineDate = new Date(deadlineMs);
        const timeOfDay = `${String(deadlineDate.getHours()).padStart(2, "0")}:${String(deadlineDate.getMinutes()).padStart(2, "0")}`;
        const { recurrence } = await api.createRecurringTask({
          title: finalTitle,
          description: desc.trim() || undefined,
          assigneeId: effectiveAssignee,
          priority,
          frequency: repeat,
          weekdays: repeat === "CUSTOM" ? repeatWeekdays : [],
          timeOfDay,
        });
        recurrenceId = recurrence.id;
      }

      await createTask({
        title: finalTitle,
        description: desc.trim() || undefined,
        assigneeId: effectiveAssignee,
        deadlineAt: new Date(deadlineMs).toISOString(),
        priority,
        ...(recurrenceId ? { recurrenceId } : {}),
      });
      haptic("medium");
      reset();
      onClose();
    } catch {
      showToast("Не удалось создать задачу");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className={`scrim${open ? " show" : ""}`} onClick={onClose} />
      <div className={`sheet${open ? " show" : ""}`}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div className="htitle">Новая задача</div>
          <button className="iconbtn" onClick={onClose}>✕</button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label className="flabel label">Быстрое добавление</label>
            <input type="text" placeholder="Закончить презентацию завтра в 18:00" value={quick} onChange={(e) => handleQuickChange(e.target.value)} />
          </div>
          <div className="field">
            <label className="flabel label">Название</label>
            <input type="text" placeholder="Название задачи" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label className="flabel label">Описание</label>
            <textarea placeholder="Необязательные детали" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="field">
            <label className="flabel label">Исполнитель</label>
            <div className="assignee-row">
              {[user?.id, otherMemberId].filter(Boolean).map((uid) => (
                <div
                  key={uid}
                  className={`assignee-pick${effectiveAssignee === uid ? " active" : ""}`}
                  onClick={() => setAssignee(uid!)}
                >
                  <div className={`avatar ${uid === user?.id ? "you" : "alex"}`} style={{ width: 22, height: 22, fontSize: 9 }}>
                    {uid === user?.id ? "В" : "П"}
                  </div>
                  <span>{uid === user?.id ? "Вы" : "Партнёр"}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="flabel label">Дедлайн</label>
            <div className="chiprow">
              {DEADLINE_OPTIONS.map((o) => (
                <div
                  key={o.key}
                  className={`pickchip${deadlineKey === o.key ? " active" : ""}`}
                  onClick={() => {
                    setDeadlineKey(o.key);
                    setCustomDeadline(o.compute());
                  }}
                >
                  {o.label}
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="flabel label">Приоритет</label>
            <div className="chiprow">
              {PRIORITIES.map((p) => (
                <div
                  key={p.key}
                  className={`pickchip priority-${p.key.toLowerCase()}${priority === p.key ? " active" : ""}`}
                  onClick={() => setPriority(p.key)}
                >
                  {p.label}
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="flabel label">Повтор</label>
            <div className="chiprow">
              {REPEAT_OPTIONS.map((r) => (
                <div key={r.key} className={`pickchip${repeat === r.key ? " active" : ""}`} onClick={() => setRepeat(r.key)}>
                  {r.label}
                </div>
              ))}
            </div>
            {repeat === "CUSTOM" && (
              <div className="chiprow" style={{ marginTop: 8 }}>
                {WEEKDAY_LABELS.map((w) => (
                  <div
                    key={w.iso}
                    className={`pickchip${repeatWeekdays.includes(w.iso) ? " active" : ""}`}
                    onClick={() => toggleWeekday(w.iso)}
                  >
                    {w.label}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="primary-btn" onClick={submit} disabled={submitting}>
            {submitting ? "Создаём…" : "Создать задачу"}
          </button>
        </div>
      </div>
    </>
  );
}
