// Follow-up: напоминание вернуться к лиду. Это обычная задача в таск-менеджере
// («Follow-up: Black Barber», срок = дата напоминания), связанная с лидом и
// обращением (LeadTask kind FOLLOW_UP). На лид — один открытый follow-up:
// новая дата переносит существующий, а не создаёт дубль. В срок бот присылает
// сообщение ⏰ FOLLOW-UP с кнопками (уведомление lead_followup).

import type { Priority } from "@prisma/client";
import { logActivity } from "../activity";
import { cancelPendingReminders } from "../notifications";
import { prisma } from "../prisma";
import { changeLeadStatus, recordLeadEvent } from "./events";
import { completeLeadTasks } from "./lead-tasks";
import { AWAITING, applyOutcomeToLead, type OutreachOutcome, setOutreachOutcome } from "./outreach";
import { daysFromNow, endOfDay, formatDay, startOfDay } from "./time";

export const FOLLOWUP_NOTIFICATION = "lead_followup";
const PRIORITY: Record<string, Priority> = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };

const FOLLOWUP_INCLUDE = {
  task: true,
  lead: { select: { id: true, name: true, status: true, workspaceId: true, potential: true } },
} as const;

export async function openFollowUp(leadId: string) {
  return prisma.leadTask.findFirst({
    where: { leadId, kind: "FOLLOW_UP", task: { status: { not: "DONE" } } },
    orderBy: { createdAt: "desc" },
    include: FOLLOWUP_INCLUDE,
  });
}

/** Follow-up по id его задачи (callback-кнопки ссылаются на задачу). */
export async function getFollowUp(taskId: string, workspaceId: string) {
  const link = await prisma.leadTask.findFirst({ where: { taskId, kind: "FOLLOW_UP", task: { workspaceId } }, include: FOLLOWUP_INCLUDE });
  if (!link) return null;
  const outreach = link.outreachId ? await prisma.outreach.findUnique({ where: { id: link.outreachId } }) : null;
  return { ...link, outreach };
}
export type FollowUp = NonNullable<Awaited<ReturnType<typeof getFollowUp>>>;

async function scheduleNotice(taskId: string, userId: string, at: Date) {
  await prisma.notification.upsert({
    where: { taskId_userId_type: { taskId, userId, type: FOLLOWUP_NOTIFICATION } },
    update: { scheduledFor: at, sentAt: null },
    create: { taskId, userId, type: FOLLOWUP_NOTIFICATION, scheduledFor: at },
  });
}

/**
 * «⏰ Follow-up»: напомнить о лиде в дату `at`. Привязывается к последнему
 * отправленному обращению (если есть) — оно переходит в «⏳ Ждём ответа»,
 * лид тоже. Возвращает задачу и признак «создана / перенесена».
 */
export async function setFollowUp(params: { leadId: string; workspaceId: string; userId: string; at: Date; outreachId?: string | null }) {
  const { leadId, workspaceId, userId, at } = params;
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId } });
  if (!lead) return null;
  const outreach = params.outreachId
    ? await prisma.outreach.findFirst({ where: { id: params.outreachId, leadId } })
    : await prisma.outreach.findFirst({ where: { leadId, status: { in: AWAITING } }, orderBy: { sentAt: "desc" } });

  const title = `Follow-up: ${lead.name}`.slice(0, 200);
  const description = [
    `Лид: ${lead.name} (${lead.city})`,
    outreach?.sentAt ? `Написали: ${formatDay(outreach.sentAt)} (${outreach.channel === "EMAIL" ? "email" : outreach.channel.toLowerCase()}${outreach.recipient ? `, ${outreach.recipient}` : ""})` : "Обращения ещё не было",
    "Следующее действие: напомнить о себе или отметить ответ — в боте, раздел ⏰ Follow-up.",
  ].join("\n");

  const existing = await openFollowUp(leadId);
  let taskId: string;
  let created: boolean;
  if (existing) {
    await prisma.task.update({ where: { id: existing.taskId }, data: { deadlineAt: at, title } });
    await prisma.leadTask.update({ where: { id: existing.id }, data: { outreachId: outreach?.id ?? existing.outreachId } });
    taskId = existing.taskId;
    created = false;
  } else {
    const task = await prisma.task.create({
      data: { workspaceId, creatorId: userId, assigneeId: userId, title, description, deadlineAt: at, priority: PRIORITY[lead.potential] ?? "MEDIUM" },
    });
    await prisma.leadTask.create({ data: { leadId, taskId: task.id, kind: "FOLLOW_UP", outreachId: outreach?.id ?? null } });
    await logActivity(workspaceId, userId, "task_created", { taskId: task.id, title: task.title });
    taskId = task.id;
    created = true;
  }
  // обычные напоминания о дедлайне здесь лишние — вместо них одно сообщение ⏰ FOLLOW-UP в срок
  await cancelPendingReminders(taskId);
  await scheduleNotice(taskId, userId, at);

  if (outreach && AWAITING.includes(outreach.status)) {
    await prisma.outreach.update({ where: { id: outreach.id }, data: { followUpAt: at, status: outreach.status === "SENT" ? "WAITING" : outreach.status } });
    await changeLeadStatus({ leadId, workspaceId, status: "WAITING", actorId: userId, onlyFrom: ["FOUND", "NEW", "TO_CONTACT", "CONTACTED"], meta: { auto: "followup_set" } });
  }
  await recordLeadEvent({ workspaceId, leadId, type: "FOLLOWUP_SET", actorId: userId, meta: { taskId, at: at.toISOString(), outreachId: outreach?.id ?? null, rescheduled: !created } });
  return { taskId, created, at };
}

/** «⏰ Отложить» на N дней (от сегодня, в 10:00). */
export async function snoozeFollowUp(taskId: string, workspaceId: string, userId: string, days: number) {
  const fu = await getFollowUp(taskId, workspaceId);
  if (!fu || fu.task.status === "DONE") return null;
  return setFollowUp({ leadId: fu.leadId, workspaceId, userId, at: daysFromNow(days), outreachId: fu.outreachId });
}

export type FollowUpClose = OutreachOutcome | "again" | "done";

/**
 * «✅ Закрыть»: 👀 ответили / ❌ отказ / 🤝 клиент — итог обращения и лида;
 * 🔁 написал ещё раз — обращение «🔁 Follow-up», можно поставить новую дату;
 * ✔️ просто закрыть — без изменений статусов.
 */
export async function closeFollowUp(taskId: string, workspaceId: string, userId: string, how: FollowUpClose) {
  const fu = await getFollowUp(taskId, workspaceId);
  if (!fu) return null;
  if (how === "replied" || how === "rejected" || how === "client") {
    if (fu.outreach) await setOutreachOutcome(fu.outreach.id, workspaceId, how, userId);
    else await applyOutcomeToLead(fu.leadId, workspaceId, how, userId);
  } else {
    if (how === "again" && fu.outreach) {
      await prisma.outreach.update({ where: { id: fu.outreach.id }, data: { status: "FOLLOW_UP", followUpAt: null } });
      await recordLeadEvent({ workspaceId, leadId: fu.leadId, type: "OUTREACH_SENT", actorId: userId, meta: { outreachId: fu.outreach.id, followUp: true } });
    }
    await completeLeadTasks(fu.leadId, workspaceId, "FOLLOW_UP", userId, { outcome: how });
  }
  return fu;
}

export type FollowUpScope = "overdue" | "today" | "later";

export function followUpScope(at: Date, now = new Date()): FollowUpScope {
  if (at.getTime() < startOfDay(now).getTime()) return "overdue";
  if (at.getTime() <= endOfDay(now).getTime()) return "today";
  return "later";
}

/** Открытые follow-up пространства по сроку. */
export async function listFollowUps(workspaceId: string, page: number, pageSize = 8) {
  const where = { kind: "FOLLOW_UP" as const, task: { workspaceId, status: { not: "DONE" as const } } };
  const [items, total] = await Promise.all([
    prisma.leadTask.findMany({ where, orderBy: { task: { deadlineAt: "asc" } }, skip: page * pageSize, take: pageSize, include: FOLLOWUP_INCLUDE }),
    prisma.leadTask.count({ where }),
  ]);
  return { items, total };
}

export async function followUpCounts(workspaceId: string, now = new Date()) {
  const base = { kind: "FOLLOW_UP" as const };
  const open = { workspaceId, status: { not: "DONE" as const } };
  const [overdue, today, later] = await Promise.all([
    prisma.leadTask.count({ where: { ...base, task: { ...open, deadlineAt: { lt: startOfDay(now) } } } }),
    prisma.leadTask.count({ where: { ...base, task: { ...open, deadlineAt: { gte: startOfDay(now), lte: endOfDay(now) } } } }),
    prisma.leadTask.count({ where: { ...base, task: { ...open, deadlineAt: { gt: endOfDay(now) } } } }),
  ]);
  return { overdue, today, later };
}
