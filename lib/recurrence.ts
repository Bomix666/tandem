import { prisma } from "./prisma";
import type { RecurringTask } from "@prisma/client";
import { scheduleDeadlineReminders } from "./notifications";

/**
 * Call this right after a task with a recurrenceId is marked DONE.
 * Creates exactly the *next* occurrence — not a batch of future tasks —
 * keeping the table small and every occurrence editable independently.
 */
export async function createNextOccurrence(recurrence: RecurringTask, completedAt: Date) {
  if (!recurrence.active) return null;

  const next = nextOccurrenceDate(recurrence, completedAt);
  if (!next) return null;

  const task = await prisma.task.create({
    data: {
      workspaceId: recurrence.workspaceId,
      creatorId: recurrence.assigneeId,
      assigneeId: recurrence.assigneeId,
      title: recurrence.title,
      description: recurrence.description,
      priority: recurrence.priority,
      deadlineAt: next,
      recurrenceId: recurrence.id,
    },
  });

  await scheduleDeadlineReminders(task);
  return task;
}

function nextOccurrenceDate(recurrence: RecurringTask, after: Date): Date | null {
  const [h, m] = recurrence.timeOfDay.split(":").map(Number) as [number, number];

  switch (recurrence.frequency) {
    case "NEVER":
      return null;
    case "DAILY":
      return atTime(addDays(after, 1), h, m);
    case "WEEKDAYS": {
      let d = addDays(after, 1);
      while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
      return atTime(d, h, m);
    }
    case "WEEKLY":
      return atTime(addDays(after, 7), h, m);
    case "MONTHLY": {
      const d = new Date(after);
      d.setMonth(d.getMonth() + 1);
      return atTime(d, h, m);
    }
    case "CUSTOM": {
      if (!recurrence.weekdays.length) return null;
      let d = addDays(after, 1);
      for (let i = 0; i < 8; i++) {
        // Prisma stores ISO weekday 1=Mon..7=Sun; JS Date#getDay is 0=Sun..6=Sat
        const iso = d.getDay() === 0 ? 7 : d.getDay();
        if (recurrence.weekdays.includes(iso)) return atTime(d, h, m);
        d = addDays(d, 1);
      }
      return null;
    }
    default:
      return null;
  }
}

function addDays(d: Date, n: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function atTime(d: Date, h: number, m: number) {
  const copy = new Date(d);
  copy.setHours(h, m, 0, 0);
  return copy;
}
