"use client";

import { LEAD_STATUS_EMOJI, LEAD_STATUS_LABELS } from "@/lib/leads/labels";
import type { LeadDTO } from "@/types/leads";

/** Короткая сводка по сайту для списка: главное, из-за чего лид интересен. */
export function siteTag(lead: LeadDTO): { text: string; tone: "warn" | "good" | "" } {
  const s = lead.site;
  if (s.kind === "none") return { text: "нет сайта", tone: "warn" };
  if (s.kind === "social") return { text: `вместо сайта — ${lead.socials[0]?.label ?? "соцсеть"}`, tone: "warn" };
  if (s.kind === "booking") return { text: `вместо сайта — ${s.booking?.name ?? "онлайн-запись"}`, tone: "warn" };
  if (s.check === "unreachable" || s.check === "error_status") return { text: "сайт не открывается", tone: "warn" };
  if (s.check === "blocked") return { text: "сайт не проверен", tone: "" };
  if (s.issues.length) return { text: `сайт: ${s.issues[0]}`, tone: "warn" };
  return { text: s.modern ? "современный сайт" : "есть сайт", tone: s.modern ? "good" : "" };
}

export function LeadCard({ lead, onOpen }: { lead: LeadDTO; onOpen: () => void }) {
  const site = siteTag(lead);
  const where = [lead.category ?? lead.niche, lead.city].filter(Boolean).join(" · ");
  return (
    <div className="lead-card" onClick={onOpen}>
      <div className="lead-head">
        <div style={{ minWidth: 0 }}>
          <div className="lead-name">{lead.name}</div>
          <div className="lead-sub">{where}</div>
        </div>
        <div className={`score ${lead.potential.toLowerCase()}`}>{lead.score}</div>
      </div>
      <div className="tags">
        <span className={`tag ${site.tone}`}>{site.text}</span>
        {lead.phones.length > 0 && <span className="tag">телефон</span>}
        {lead.socials.length > 0 && <span className="tag">{lead.socials.map((s) => s.label).slice(0, 2).join(", ")}</span>}
        {lead.status !== "NEW" && (
          <span className="tag gold">
            {LEAD_STATUS_EMOJI[lead.status]} {LEAD_STATUS_LABELS[lead.status]}
          </span>
        )}
        {lead.saved && <span className="tag gold">❤️</span>}
        {lead.tasks.length > 0 && <span className="tag good">✓ задача</span>}
      </div>
    </div>
  );
}
