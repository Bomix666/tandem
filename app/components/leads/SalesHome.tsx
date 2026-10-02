"use client";

// Верх вкладки «Клиенты» — Sales OS: что сегодня, одно «⚡ ближайшее
// действие» и воронка. Только реальные данные (/api/leads/dashboard); любая
// плитка ведёт в нужный список.

import type { DashboardDTO, LeadFilterDTO, NextActionDTO } from "@/types/leads";
import { relativeDay } from "./format";

export type SalesTarget =
  | { kind: "filter"; filter: LeadFilterDTO }
  | { kind: "outreach"; status: "REPLIED" | "DRAFT" }
  | { kind: "followups" }
  | { kind: "lead"; leadId: string }
  | { kind: "outreachItem"; outreachId: string }
  | { kind: "search" };

interface Props {
  dashboard: DashboardDTO | null;
  onGo: (t: SalesTarget) => void;
}

function nextText(n: NextActionDTO): { act: string; target: SalesTarget } {
  switch (n.kind) {
    case "followup":
      return { act: `follow-up: напомнить о себе · ${n.at ? relativeDay(n.at) : ""}`, target: { kind: "followups" } };
    case "reply":
      return { act: "пришёл ответ — договориться о следующем шаге", target: { kind: "lead", leadId: n.leadId } };
    case "send":
      return { act: "отправить предложение", target: n.outreachId ? { kind: "outreachItem", outreachId: n.outreachId } : { kind: "lead", leadId: n.leadId } };
    case "prepare":
      return { act: "подготовить предложение", target: { kind: "lead", leadId: n.leadId } };
    case "hot":
      return { act: `горячий лид · ${n.score}/100 — взять в работу`, target: { kind: "lead", leadId: n.leadId } };
    case "upcoming":
      return { act: `follow-up ${n.at ? relativeDay(n.at) : ""}`, target: { kind: "followups" } };
  }
}

function Tile({ n, cap, tone, onClick }: { n: number | undefined; cap: string; tone?: "lime" | "amber" | "rust"; onClick: () => void }) {
  const zero = !n;
  return (
    <button className={`tile${zero ? " zero" : tone ? ` ${tone}` : ""}`} onClick={onClick}>
      <div className="n">{n ?? "—"}</div>
      <div className="cap">{cap}</div>
    </button>
  );
}

export function SalesHome({ dashboard: d, onGo }: Props) {
  const today = d?.today;
  const p = d?.pipeline;
  const stages: { label: string; n: number; filter: LeadFilterDTO }[] = p
    ? [
        { label: "🆕 Новые", n: p.fresh, filter: "n" },
        { label: "📩 Связаться", n: p.toContact, filter: "t" },
        { label: "⏳ Ждут ответа", n: p.waiting, filter: "w" },
        { label: "💬 Переговоры", n: p.negotiation, filter: "g" },
        { label: "🤝 Клиенты", n: p.clients, filter: "c" },
      ]
    : [];
  const max = Math.max(1, ...stages.map((s) => s.n));
  const next = d?.next ? nextText(d.next) : null;
  const raw = new Date(d?.date ?? Date.now()).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
  const date = raw.charAt(0).toUpperCase() + raw.slice(1);

  return (
    <>
      <div className="os-head">
        <div>
          <div className="os-title">
            <span className="dot" /> Sales OS
          </div>
          <div className="os-date">{date}</div>
        </div>
        <div className="label">сегодня</div>
      </div>

      <div className="today-grid">
        <Tile n={today?.newLeads} cap="НОВЫЕ" tone="lime" onClick={() => onGo({ kind: "filter", filter: "d" })} />
        <Tile n={today?.toProcess} cap="ОБРАБОТАТЬ" tone="amber" onClick={() => onGo({ kind: "filter", filter: "t" })} />
        <Tile n={today?.followUps} cap="FOLLOW-UP" tone={d && d.followUps.overdue > 0 ? "rust" : "amber"} onClick={() => onGo({ kind: "followups" })} />
        <Tile n={today?.replies} cap="ОТВЕТОВ" tone="lime" onClick={() => onGo({ kind: "outreach", status: "REPLIED" })} />
        <Tile n={today?.hot} cap="🔥 ГОРЯЧИХ" tone="amber" onClick={() => onGo({ kind: "filter", filter: "h" })} />
        <Tile n={p?.clients} cap="КЛИЕНТОВ" tone="lime" onClick={() => onGo({ kind: "filter", filter: "c" })} />
      </div>

      {next && d?.next ? (
        <div className="next-card" onClick={() => onGo(next.target)}>
          <div className="bolt">⚡</div>
          <div className="what">
            <div className="k">Ближайшее действие</div>
            <div className="name">{d.next.name}</div>
            <div className="act">→ {next.act}</div>
          </div>
          <div className="go">›</div>
        </div>
      ) : (
        <div className="next-card idle" onClick={() => onGo({ kind: "search" })}>
          <div className="bolt">⚡</div>
          <div className="what">
            <div className="k" style={{ color: "var(--ink-dim)" }}>
              Ближайшее действие
            </div>
            <div className="name">Срочных дел нет</div>
            <div className="act">→ найди новых клиентов</div>
          </div>
          <div className="go" style={{ color: "var(--ink-dim)" }}>
            ›
          </div>
        </div>
      )}

      {p && (
        <div className="funnel">
          <div className="funnel-head">
            <div className="label">Воронка</div>
            <div className="label">{stages.reduce((s, x) => s + x.n, 0)} в работе</div>
          </div>
          {stages.map((s, i) => (
            <div key={s.label} className={`funnel-row${i === stages.length - 1 ? " last" : ""}`} onClick={() => onGo({ kind: "filter", filter: s.filter })}>
              <div className="lbl">{s.label}</div>
              <div className="bar">
                <i style={{ width: `${s.n ? Math.max(4, (s.n / max) * 100) : 0}%` }} />
              </div>
              <div className="cnt">{s.n}</div>
            </div>
          ))}
          {d && (
            <div className="funnel-foot">
              <span className="label">📨 Сегодня</span>
              <span>
                <b>{d.outreachToday.drafted}</b> подготовлено · <b>{d.outreachToday.sent}</b> отправлено · <b>{d.outreachToday.replies}</b> ответов
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
