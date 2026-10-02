"use client";

// Раздел «📨 Outreach»: обращения по статусам CRM — черновики, готовые,
// отправленные, ждём ответа, ответы, follow-up, отказ, клиент.

import { useEffect, useRef, useState } from "react";
import { CHANNEL_EMOJI, OUTREACH_STATUS_EMOJI, OUTREACH_STATUS_LABELS } from "@/lib/leads/labels";
import * as leadsApi from "@/lib/leads-api";
import type { OutreachDTO, OutreachStatusDTO } from "@/types/leads";
import { formatDate, formatDayTime } from "./format";
import { statusTone } from "./OutreachSheet";

const ORDER: OutreachStatusDTO[] = ["DRAFT", "READY", "SENT", "WAITING", "REPLIED", "FOLLOW_UP", "REJECTED", "CLIENT"];
const SHORT: Record<OutreachStatusDTO, string> = {
  DRAFT: "Черновики",
  READY: "Готово",
  SENT: "Отправлено",
  WAITING: "Ждём",
  REPLIED: "Ответы",
  FOLLOW_UP: "Follow-up",
  REJECTED: "Отказ",
  CLIENT: "Клиент",
};

interface Props {
  status: OutreachStatusDTO;
  onStatus: (s: OutreachStatusDTO) => void;
  reloadKey: number;
  onOpen: (outreachId: string) => void;
}

function subline(o: OutreachDTO): string {
  const parts = [o.sentAt ? `отправлено ${formatDate(o.sentAt)}` : `изменено ${formatDate(o.updatedAt)}`];
  if (o.followUpAt) parts.push(`⏰ ${formatDayTime(o.followUpAt)}`);
  if (o.recipient) parts.push(o.recipient);
  return parts.join(" · ");
}

export function OutreachSection({ status, onStatus, reloadKey, onOpen }: Props) {
  const [data, setData] = useState<{ counts: Record<OutreachStatusDTO, number>; items: OutreachDTO[]; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const chips = useRef<HTMLDivElement>(null);

  // выбранный статус может быть за краем ленты (переход с дашборда) — прокручиваем к нему
  useEffect(() => {
    const row = chips.current;
    const active = row?.querySelector<HTMLElement>(".active");
    if (row && active) row.scrollLeft = active.offsetLeft - row.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
  }, [status, data]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    leadsApi
      .listOutreach(status)
      .then((r) => !cancelled && setData(r))
      .catch(() => void 0)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [status, reloadKey]);

  return (
    <>
      <div className="chiprow scroll" ref={chips}>
        {ORDER.map((s) => (
          <div key={s} className={`pickchip${status === s ? " active" : ""}`} onClick={() => onStatus(s)}>
            {OUTREACH_STATUS_EMOJI[s]} {SHORT[s]}
            <span className="cnt">{data?.counts[s] ?? 0}</span>
          </div>
        ))}
      </div>
      <div className="section-head" style={{ marginTop: 18 }}>
        <div className="title">{OUTREACH_STATUS_LABELS[status]}</div>
        <div className="count">{loading ? "…" : `${data?.total ?? 0} всего`}</div>
      </div>
      <div className="os-list stagger">
        {!loading && !data?.items.length && (
          <div className="empty">
            <div className="headline serif">Здесь пока пусто</div>
            <div className="sub">Письма и сообщения готовятся из карточки лида — «✨ Подготовить письмо» или «💬 Сообщение». Отправляешь ты сам.</div>
          </div>
        )}
        {data?.items.map((o) => (
          <div key={o.id} className="o-card" onClick={() => onOpen(o.id)}>
            <div className="o-top">
              <div className="o-chan">{CHANNEL_EMOJI[o.channel]}</div>
              <div className="o-main">
                <div className="o-name">{o.leadName}</div>
                <div className="o-sub">{subline(o)}</div>
              </div>
              <span className={`pill ${statusTone(o.status)}`}>{OUTREACH_STATUS_EMOJI[o.status]}</span>
            </div>
            {o.subject && <div className="o-sub" style={{ marginTop: 8, color: "var(--ink)" }}>{o.subject}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
