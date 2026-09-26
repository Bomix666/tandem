// «➕ Создать задачу» из лида — интеграция с существующим таск-менеджером.
// Задача создаётся в той же таблице Task и тем же путём, что и в Mini App:
// запись в ленту активности, напоминания о дедлайне, уведомление партнёру.

import type { Lead, Priority } from "@prisma/client";
import { logActivity } from "../activity";
import { notifyEvent, scheduleDeadlineReminders } from "../notifications";
import { prisma } from "../prisma";
import { formatScoreReasons, LEAD_STATUS_LABELS, POTENTIAL_LABELS } from "./labels";
import { socialLabel } from "./scoring";
import type { ScoreReason, SocialLink, SourceRef } from "./types";

const PRIORITY_BY_POTENTIAL: Record<Lead["potential"], Priority> = { HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW" };

export function taskTitleForLead(lead: Pick<Lead, "name">): string {
  return `Связаться с ${lead.name} — предложить сайт`.slice(0, 200);
}

/** Описание задачи: все данные лида, без выдуманных полей. */
export function buildTaskDescription(lead: Lead): string {
  const socials = (lead.socials as unknown as SocialLink[] | null) ?? [];
  const sources = (lead.sources as unknown as SourceRef[] | null) ?? [];
  const reasons = (lead.scoreReasons as unknown as ScoreReason[] | null) ?? [];
  const contacts = [...lead.phones, ...lead.emails];
  const lines = [
    "Тип: Продажа сайта",
    `Клиент: ${lead.name}`,
    `Город: ${lead.city}`,
    lead.address ? `Адрес: ${lead.address}` : null,
    `Ниша: ${lead.category ?? lead.niche}`,
    `Контакт: ${contacts.length ? contacts.join(", ") : "не найден"}`,
    socials.length ? `Соцсети: ${socials.map((s) => `${socialLabel(s.type)} ${s.url}`).join(", ")}` : null,
    `Сайт: ${lead.website ?? "не найден"}`,
    `Источник: ${sources.map((s) => s.url).join(", ")}`,
    `Причина обращения: ${formatScoreReasons(reasons, { positiveOnly: true }).join("; ") || "—"}`,
    `Предложение: ${lead.offer ?? "—"}`,
    `Статус лида: ${LEAD_STATUS_LABELS[lead.status]}`,
    `Lead Score: ${lead.score}/100 (потенциал: ${POTENTIAL_LABELS[lead.potential].toLowerCase()})`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n").slice(0, 4000);
}

export type TaskFromLeadResult =
  | { status: "created"; task: { id: string; title: string; deadlineAt: Date; priority: Priority } }
  | { status: "exists"; task: { id: string; title: string; createdAt: Date } }
  | { status: "not_found" };

export async function createTaskFromLead(params: {
  leadId: string;
  workspace: { id: string; members: { userId: string }[] };
  user: { id: string; firstName: string };
  force: boolean;
}): Promise<TaskFromLeadResult> {
  const { leadId, workspace, user, force } = params;
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, workspaceId: workspace.id },
    include: { tasks: { orderBy: { createdAt: "desc" }, take: 1, include: { task: true } } },
  });
  if (!lead) return { status: "not_found" };

  // Повторную задачу — только по явному подтверждению пользователя.
  const existing = lead.tasks[0]?.task;
  if (existing && !force) return { status: "exists", task: existing };

  const task = await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      creatorId: user.id,
      assigneeId: user.id,
      title: taskTitleForLead(lead),
      description: buildTaskDescription(lead),
      // как у /task без времени: срок через 24 часа, поменять можно в приложении
      deadlineAt: new Date(Date.now() + 24 * 3600_000),
      priority: PRIORITY_BY_POTENTIAL[lead.potential],
    },
  });
  await prisma.leadTask.create({ data: { leadId: lead.id, taskId: task.id } });

  await logActivity(workspace.id, user.id, "task_created", { taskId: task.id, title: task.title });
  await scheduleDeadlineReminders(task);
  const otherMemberId = workspace.members.map((m) => m.userId).find((id) => id !== user.id);
  if (otherMemberId) {
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId: otherMemberId } });
    if (!prefs || prefs.friendCreatedTask !== false) {
      await notifyEvent(otherMemberId, "friend_created_task", task.id, { actorName: user.firstName, title: task.title });
    }
  }

  return { status: "created", task };
}
