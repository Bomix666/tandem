// Главный экран Sales OS: что сегодня, воронка, обращения за день и одно
// «⚡ Ближайшее действие». Только реальные данные из БД — ничего не выдумываем.

import type { LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { followUpCounts } from "./followups";
import { endOfDay, startOfDay } from "./time";

/** «Горячий» лид: высокий потенциал, но ещё не связались. */
export const HOT_STATUSES: LeadStatus[] = ["FOUND", "NEW", "TO_CONTACT"];
export const hotWhere = (workspaceId: string): Prisma.LeadWhereInput => ({ workspaceId, potential: "HIGH", status: { in: HOT_STATUSES } });

export type NextAction =
  | { kind: "followup"; taskId: string; leadId: string; name: string; at: Date; overdue: boolean }
  | { kind: "reply"; outreachId: string; leadId: string; name: string }
  | { kind: "send"; outreachId: string; leadId: string; name: string }
  | { kind: "prepare"; leadId: string; name: string }
  | { kind: "hot"; leadId: string; name: string; score: number }
  | { kind: "upcoming"; taskId: string; leadId: string; name: string; at: Date };

export interface Dashboard {
  today: { newLeads: number; toProcess: number; followUps: number; replies: number; hot: number };
  pipeline: { fresh: number; toContact: number; waiting: number; negotiation: number; clients: number };
  outreachToday: { drafted: number; sent: number; replies: number };
  followUps: { overdue: number; today: number; later: number };
  next: NextAction | null;
}

export async function getDashboard(workspaceId: string, now = new Date()): Promise<Dashboard> {
  const dayStart = startOfDay(now);
  const events = (type: Prisma.LeadEventWhereInput["type"]) => prisma.leadEvent.count({ where: { workspaceId, type, createdAt: { gte: dayStart } } });

  const [byStatus, newToday, drafted, sent, repliesToday, awaitingReply, hot, followUps] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
    events("FOUND"),
    events("OUTREACH_DRAFTED"),
    events("OUTREACH_SENT"),
    events("REPLY_RECEIVED"),
    prisma.outreach.count({ where: { workspaceId, status: "REPLIED" } }),
    prisma.lead.count({ where: hotWhere(workspaceId) }),
    followUpCounts(workspaceId, now),
  ]);
  const n = (...s: LeadStatus[]) => byStatus.filter((g) => s.includes(g.status)).reduce((sum, g) => sum + g._count._all, 0);

  return {
    today: { newLeads: newToday, toProcess: n("TO_CONTACT"), followUps: followUps.overdue + followUps.today, replies: awaitingReply, hot },
    pipeline: { fresh: n("FOUND", "NEW"), toContact: n("TO_CONTACT"), waiting: n("CONTACTED", "WAITING"), negotiation: n("NEGOTIATION"), clients: n("CLIENT") },
    outreachToday: { drafted, sent, replies: repliesToday },
    followUps,
    next: await nextAction(workspaceId, now),
  };
}

/**
 * Что сделать первым: просроченный/сегодняшний follow-up → ответ клиента →
 * отправить готовый черновик → подготовить предложение тому, с кем надо
 * связаться → горячий лид → ближайший будущий follow-up.
 */
export async function nextAction(workspaceId: string, now = new Date()): Promise<NextAction | null> {
  const fu = await prisma.leadTask.findFirst({
    where: { kind: "FOLLOW_UP", task: { workspaceId, status: { not: "DONE" }, deadlineAt: { lte: endOfDay(now) } } },
    orderBy: { task: { deadlineAt: "asc" } },
    include: { task: true, lead: { select: { name: true } } },
  });
  if (fu) return { kind: "followup", taskId: fu.taskId, leadId: fu.leadId, name: fu.lead.name, at: fu.task.deadlineAt, overdue: fu.task.deadlineAt < now };

  const replied = await prisma.outreach.findFirst({ where: { workspaceId, status: "REPLIED" }, orderBy: { repliedAt: "asc" }, include: { lead: { select: { name: true } } } });
  if (replied) return { kind: "reply", outreachId: replied.id, leadId: replied.leadId, name: replied.lead.name };

  const draft = await prisma.outreach.findFirst({
    where: { workspaceId, status: { in: ["READY", "DRAFT"] } },
    orderBy: [{ status: "desc" }, { updatedAt: "desc" }], // READY раньше DRAFT
    include: { lead: { select: { name: true } } },
  });
  if (draft) return { kind: "send", outreachId: draft.id, leadId: draft.leadId, name: draft.lead.name };

  const toContact = await prisma.lead.findFirst({ where: { workspaceId, status: "TO_CONTACT" }, orderBy: [{ score: "desc" }, { createdAt: "asc" }] });
  if (toContact) return { kind: "prepare", leadId: toContact.id, name: toContact.name };

  const hot = await prisma.lead.findFirst({ where: hotWhere(workspaceId), orderBy: [{ score: "desc" }, { createdAt: "desc" }] });
  if (hot) return { kind: "hot", leadId: hot.id, name: hot.name, score: hot.score };

  const later = await prisma.leadTask.findFirst({
    where: { kind: "FOLLOW_UP", task: { workspaceId, status: { not: "DONE" } } },
    orderBy: { task: { deadlineAt: "asc" } },
    include: { task: true, lead: { select: { name: true } } },
  });
  if (later) return { kind: "upcoming", taskId: later.taskId, leadId: later.leadId, name: later.lead.name, at: later.task.deadlineAt };
  return null;
}
