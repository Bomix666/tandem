"use client";

// Раздел «⏰ Follow-up»: открытые напоминания по сроку — просроченные,
// сегодняшние, будущие. Отложить или закрыть с итогом прямо из списка.

import { useEffect, useState } from "react";
import { CHANNEL_EMOJI, LEAD_STATUS_EMOJI, LEAD_STATUS_LABELS } from "@/lib/leads/labels";
import * as leadsApi from "@/lib/leads-api";
import { haptic, hapticSuccess } from "@/lib/telegram-client";
import { useWorkspace } from "@/lib/workspace-context";
import type { FollowUpDTO } from "@/types/leads";
import { formatDate, formatDayTime, relativeDay } from "./format";

interface Props {
  reloadKey: number;
  onOpenLead: (leadId: string) => void;
  onChanged: () => void;
}

const CLOSE: { how: leadsApi.FollowUpClose; label: string; toast: string }[] = [
  { how: "replied", label: "👀 Ответили", toast: "👀 Ответ отмечен · лид → 💬 Переговоры" },
  { how: "again", label: "🔁 Написал ещё раз", toast: "🔁 Отмечено — поставь новую дату" },
  { how: "client", label: "🤝 Клиент", toast: "🤝 Клиент! Поздравляю" },
  { how: "rejected", label: "❌ Отказ", toast: "❌ Отказ отмечен" },
  { how: "done", label: "✔️ Просто закрыть", toast: "Follow-up закрыт" },
];

export function FollowUpsSection({ reloadKey, onOpenLead, onChanged }: Props) {
  const { showToast } = useWorkspace();
  const [data, setData] = useState<{ items: FollowUpDTO[]; total: number; counts: { overdue: number; today: number; later: number } } | null>(null);
  const [expanded, setExpanded] = useState<{ id: string; mode: "snooze" | "close" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    leadsApi
      .listFollowUps()
      .then((r) => !cancelled && setData(r))
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, [reloadKey, tick]);

  async function act(f: FollowUpDTO, action: { action: "snooze"; days: number } | { action: "close"; how: leadsApi.FollowUpClose }, toast: string) {
    haptic("medium");
    setBusy(true);
    try {
      await leadsApi.followUpAction(f.taskId, action);
      hapticSuccess();
      showToast(toast);
      setExpanded(null);
      setTick((t) => t + 1);
      onChanged();
    } catch {
      showToast("Не получилось — попробуй ещё раз");
    } finally {
      setBusy(false);
    }
  }

  const c = data?.counts;
  return (
    <>
      <div className="fu-sum">
        <div className="stat-cell">
          <div className="n" style={{ color: c?.overdue ? "var(--rust)" : undefined }}>{c?.overdue ?? "—"}</div>
          <div className="cap">🔴 Просрочено</div>
        </div>
        <div className="stat-cell">
          <div className="n" style={{ color: c?.today ? "var(--amber)" : undefined }}>{c?.today ?? "—"}</div>
          <div className="cap">🟠 Сегодня</div>
        </div>
        <div className="stat-cell">
          <div className="n">{c?.later ?? "—"}</div>
          <div className="cap">⚪ Позже</div>
        </div>
      </div>

      <div className="os-list">
        {data && !data.items.length && (
          <div className="empty">
            <div className="headline serif">Напоминаний нет</div>
            <div className="sub">Follow-up ставится после «✅ Я отправил» или из карточки лида.</div>
          </div>
        )}
        {data?.items.map((f) => (
          <div key={f.taskId} className={`fu-card ${f.scope}`}>
            <div className="o-top">
              <div className="o-main">
                <div className="o-name">{f.leadName}</div>
                <div className="when">
                  <b>{formatDayTime(f.at)}</b> · {relativeDay(f.at)}
                </div>
                <div className="o-sub" style={{ marginTop: 3 }}>
                  {LEAD_STATUS_EMOJI[f.leadStatus]} {LEAD_STATUS_LABELS[f.leadStatus]}
                  {f.outreach?.sentAt ? ` · ${CHANNEL_EMOJI[f.outreach.channel]} написали ${formatDate(f.outreach.sentAt)}` : " · обращения ещё не было"}
                </div>
              </div>
            </div>
            <div className="fu-actions">
              <div className="pickchip" onClick={() => onOpenLead(f.leadId)}>
                👀 Лид
              </div>
              <div className={`pickchip${expanded?.id === f.taskId && expanded.mode === "snooze" ? " active" : ""}`} onClick={() => setExpanded(expanded?.id === f.taskId && expanded.mode === "snooze" ? null : { id: f.taskId, mode: "snooze" })}>
                ⏰ Отложить
              </div>
              <div className={`pickchip${expanded?.id === f.taskId && expanded.mode === "close" ? " active" : ""}`} onClick={() => setExpanded(expanded?.id === f.taskId && expanded.mode === "close" ? null : { id: f.taskId, mode: "close" })}>
                ✅ Закрыть
              </div>
            </div>
            {expanded?.id === f.taskId && (
              <div className="fu-actions">
                {expanded.mode === "snooze"
                  ? [1, 3, 7].map((d) => (
                      <button key={d} className="pickchip" disabled={busy} onClick={() => act(f, { action: "snooze", days: d }, `⏰ Отложено на ${d} дн.`)}>
                        +{d} {d === 1 ? "день" : d === 3 ? "дня" : "дней"}
                      </button>
                    ))
                  : CLOSE.map((x) => (
                      <button key={x.how} className="pickchip" disabled={busy} onClick={() => act(f, { action: "close", how: x.how }, x.toast)}>
                        {x.label}
                      </button>
                    ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
