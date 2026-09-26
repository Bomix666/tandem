import { prisma } from "./prisma";
import type { Prisma, Task } from "@prisma/client";
import { sendTelegramMessage } from "./telegram-send";

/**
 * Deadline reminder offsets. Each maps to a NotificationPreference field
 * name so we can check whether the recipient wants that particular offset.
 */
const DEADLINE_OFFSETS: { minutesBefore: number; type: string; prefField: string }[] = [
  { minutesBefore: 24 * 60, type: "deadline_24h", prefField: "deadline24h" },
  { minutesBefore: 3 * 60, type: "deadline_3h", prefField: "deadline3h" },
  { minutesBefore: 60, type: "deadline_1h", prefField: "deadline1h" },
  { minutesBefore: 30, type: "deadline_30m", prefField: "deadline30m" },
  { minutesBefore: 10, type: "deadline_10m", prefField: "deadline10m" },
];

/**
 * Creates (or leaves alone, via the unique [taskId, userId, type]
 * constraint) one Notification row per configured offset, for whichever
 * offsets still lie in the future. A separate cron job (see
 * app/api/notifications/cron/route.ts) later scans for due rows and sends
 * them — this function only *schedules*, it never sends synchronously from
 * a request handler.
 */
export async function scheduleDeadlineReminders(task: Task) {
  const prefs = await prisma.notificationPreference.findUnique({ where: { userId: task.assigneeId } });

  for (const offset of DEADLINE_OFFSETS) {
    if (prefs && prefs[offset.prefField as keyof typeof prefs] === false) continue;

    const scheduledFor = new Date(task.deadlineAt.getTime() - offset.minutesBefore * 60_000);
    if (scheduledFor.getTime() <= Date.now()) continue; // offset already in the past

    await prisma.notification
      .upsert({
        where: { taskId_userId_type: { taskId: task.id, userId: task.assigneeId, type: offset.type } },
        update: { scheduledFor, sentAt: null },
        create: {
          taskId: task.id,
          userId: task.assigneeId,
          type: offset.type,
          scheduledFor,
        },
      })
      .catch(() => void 0); // race-safe: unique constraint prevents duplicates
  }
}

export async function cancelPendingReminders(taskId: string) {
  await prisma.notification.deleteMany({ where: { taskId, sentAt: null } });
}

export async function notifyEvent(
  recipientId: string,
  type: string,
  taskId: string | null,
  payload: Record<string, unknown>
) {
  // Immediate (non-deadline) events are scheduled "now" so the same cron
  // sweep delivers them within its next tick, keeping one send pathway.
  await prisma.notification.create({
    data: { userId: recipientId, taskId: taskId ?? undefined, type, payload: payload as Prisma.InputJsonObject, scheduledFor: new Date() },
  });
}

export async function notifyCommentAdded(task: Task, authorId: string, text: string) {
  const recipientId = task.assigneeId === authorId ? task.creatorId : task.assigneeId;
  if (recipientId === authorId) return; // don't notify yourself
  const prefs = await prisma.notificationPreference.findUnique({ where: { userId: recipientId } });
  if (prefs && prefs.commentAdded === false) return;
  await notifyEvent(recipientId, "comment_added", task.id, { title: task.title, text: text.slice(0, 140) });
}

/**
 * Finds tasks whose deadline has passed, are still open, and haven't
 * already gotten a task_overdue notification — schedules exactly one per
 * task per assignee. Call this from the cron sweep alongside
 * deliverDueNotifications(); it only schedules, delivery still goes
 * through the normal due-notification path.
 */
export async function scheduleOverdueNotifications() {
  const overdue = await prisma.task.findMany({
    where: {
      status: { not: "DONE" },
      deadlineAt: { lt: new Date() },
      notifications: { none: { type: "task_overdue" } },
    },
    select: { id: true, title: true, assigneeId: true },
  });

  for (const task of overdue) {
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId: task.assigneeId } });
    if (prefs && prefs.taskOverdue === false) continue;
    await notifyEvent(task.assigneeId, "task_overdue", task.id, { title: task.title }).catch(() => void 0);
  }

  return overdue.length;
}

/**
 * Called by the cron route. Finds due, unsent notifications and delivers
 * them via the Telegram Bot API, then marks them sent. Batches per-run so
 * a slow Telegram API never blocks request handlers.
 */
export async function deliverDueNotifications(limit = 50) {
  const due = await prisma.notification.findMany({
    where: { sentAt: null, scheduledFor: { lte: new Date() } },
    take: limit,
    include: { user: true, task: true },
    orderBy: { scheduledFor: "asc" },
  });

  for (const n of due) {
    const text = renderNotificationText(n.type, n.task?.title, n.payload as Record<string, unknown> | null);
    try {
      await sendTelegramMessage(n.user.telegramId, text);
      await prisma.notification.update({ where: { id: n.id }, data: { sentAt: new Date() } });
    } catch (e) {
      console.error("Failed to deliver notification", n.id, e);
      // leave sentAt null; next cron tick retries
    }
  }

  return due.length;
}

function renderNotificationText(type: string, taskTitle?: string, payload?: Record<string, unknown> | null) {
  switch (type) {
    case "deadline_24h": return `⏳ «${taskTitle}» — срок через 24 часа.`;
    case "deadline_3h": return `⏳ «${taskTitle}» — срок через 3 часа.`;
    case "deadline_1h": return `⏳ «${taskTitle}» — срок через 1 час.`;
    case "deadline_30m": return `⏳ «${taskTitle}» — срок через 30 минут.`;
    case "deadline_10m": return `⏳ «${taskTitle}» — срок через 10 минут.`;
    case "task_overdue": return `⚠️ «${taskTitle}» просрочена.`;
    case "friend_created_task": return `${payload?.actorName ?? "Ваш партнёр по рабочему пространству"} создал(а) «${taskTitle}».`;
    case "assigned_new_task": return `Вам назначена задача «${taskTitle}».`;
    case "friend_completed_task": return `✓ ${payload?.actorName ?? "Ваш партнёр"} завершил(а) «${taskTitle}».`;
    case "friend_started_working": return `${payload?.actorName ?? "Ваш партнёр"} начал(а) работу над «${taskTitle}».`;
    case "comment_added": return `💬 Новый комментарий к «${taskTitle}»: ${payload?.text ?? ""}`;
    default: return `Обновление по задаче «${taskTitle}».`;
  }
}
