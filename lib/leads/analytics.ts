// Аналитика воронки по реальным данным: текущие статусы лидов + история
// (LeadEvent). «Связались» — лид, которому отправили обращение или которого
// перевели дальше «📩 Связаться»; «Ответили» — отмечен ответ или переговоры.
// Лид, получивший потом отказ, всё равно считается связавшимся/ответившим.

import type { LeadStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { getLeadSettings } from "./repository";

const CONTACTED: LeadStatus[] = ["CONTACTED", "WAITING", "NEGOTIATION", "CLIENT"];
const REPLIED: LeadStatus[] = ["NEGOTIATION", "CLIENT"];

export type AnalyticsPeriod = 7 | 30 | null; // дней; null — за всё время

export interface Analytics {
  period: AnalyticsPeriod;
  total: number;
  found: number;
  saved: number;
  contacted: number;
  replied: number;
  negotiation: number;
  clients: number;
  rejected: number;
  outreach: { drafted: number; sent: number; replies: number };
  /** Доли 0..1; null — не из чего считать (делить не на что). */
  rates: { contact: number | null; reply: number | null; conversion: number | null };
  avgCheck: number;
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export async function getAnalytics(workspaceId: string, period: AnalyticsPeriod, now = new Date()): Promise<Analytics> {
  const since = period ? new Date(now.getTime() - period * 86_400_000) : undefined;
  const leads = await prisma.lead.findMany({
    where: { workspaceId, ...(since ? { createdAt: { gte: since } } : {}) },
    select: { id: true, status: true, saved: true },
  });
  const ids = leads.map((l) => l.id);
  const events = ids.length
    ? await prisma.leadEvent.findMany({
        where: { leadId: { in: ids }, type: { in: ["FOUND", "SAVED", "STATUS_CHANGED", "OUTREACH_SENT", "REPLY_RECEIVED"] } },
        select: { leadId: true, type: true, toStatus: true },
      })
    : [];
  const byLead = new Map<string, typeof events>();
  for (const e of events) byLead.set(e.leadId, [...(byLead.get(e.leadId) ?? []), e]);

  let found = 0;
  let saved = 0;
  let contacted = 0;
  let replied = 0;
  let negotiation = 0;
  for (const l of leads) {
    const ev = byLead.get(l.id) ?? [];
    const reachedStatus = (list: LeadStatus[]) => list.includes(l.status) || ev.some((e) => e.type === "STATUS_CHANGED" && e.toStatus && list.includes(e.toStatus));
    if (ev.some((e) => e.type === "FOUND") || l.status === "FOUND") found++;
    if (l.saved || ev.some((e) => e.type === "SAVED")) saved++;
    if (reachedStatus(CONTACTED) || ev.some((e) => e.type === "OUTREACH_SENT")) contacted++;
    if (reachedStatus(REPLIED) || ev.some((e) => e.type === "REPLY_RECEIVED")) replied++;
    if (reachedStatus(REPLIED)) negotiation++;
  }
  const clients = leads.filter((l) => l.status === "CLIENT").length;
  const rejected = leads.filter((l) => l.status === "REJECTED" || l.status === "NOT_FIT").length;

  const outreachEvents = (type: "OUTREACH_DRAFTED" | "OUTREACH_SENT" | "REPLY_RECEIVED") =>
    prisma.leadEvent.count({ where: { workspaceId, type, ...(since ? { createdAt: { gte: since } } : {}) } });
  const [drafted, sent, replies, settings] = await Promise.all([
    outreachEvents("OUTREACH_DRAFTED"),
    outreachEvents("OUTREACH_SENT"),
    outreachEvents("REPLY_RECEIVED"),
    getLeadSettings(workspaceId),
  ]);

  return {
    period,
    total: leads.length,
    found,
    saved,
    contacted,
    replied,
    negotiation,
    clients,
    rejected,
    outreach: { drafted, sent, replies },
    rates: { contact: ratio(contacted, leads.length), reply: ratio(replied, contacted), conversion: ratio(clients, contacted) },
    avgCheck: settings.avgCheck,
  };
}
