import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthedUser, requireWorkspace, AuthError } from "@/lib/telegram-auth";
import { logActivity } from "@/lib/activity";
import { scheduleDeadlineReminders, cancelPendingReminders, notifyEvent } from "@/lib/notifications";
import { createNextOccurrence } from "@/lib/recurrence";
import { publish } from "@/lib/pubsub";
import { z } from "zod";

const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  assigneeId: z.string().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional(),
  progress: z.number().int().min(0).max(100).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  deadlineAt: z.string().datetime().optional(),
});

async function loadOwnedTask(userId: string, taskId: string) {
  const workspace = await requireWorkspace(userId);
  const task = await prisma.task.findFirst({ where: { id: taskId, workspaceId: workspace.id } });
  if (!task) {
    const err = new Error("Task not found") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return { workspace, task };
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuthedUser(request);
    const { workspace, task } = await loadOwnedTask(user.id, params.id);
    const body = updateTaskSchema.parse(await request.json());

    const wasDone = task.status === "DONE";
    const deadlineChanged = body.deadlineAt && new Date(body.deadlineAt).getTime() !== task.deadlineAt.getTime();
    const progressChanged = body.progress !== undefined && body.progress !== task.progress;

    const updated = await prisma.task.update({
      where: { id: task.id },
      data: {
        ...body,
        deadlineAt: body.deadlineAt ? new Date(body.deadlineAt) : undefined,
        completedAt: body.status === "DONE" && !wasDone ? new Date() : body.status && body.status !== "DONE" ? null : undefined,
      },
      include: { assignee: true, creator: true },
    });

    if (body.status === "DONE" && !wasDone) {
      await logActivity(workspace.id, user.id, "task_completed", { taskId: task.id, title: updated.title });
      await cancelPendingReminders(task.id);

      // Tell the other member — never yourself.
      const otherMemberId = workspace.members.map((m) => m.userId).find((id) => id !== user.id);
      if (otherMemberId) {
        const prefs = await prisma.notificationPreference.findUnique({ where: { userId: otherMemberId } });
        if (!prefs || prefs.friendCompletedTask !== false) {
          await notifyEvent(otherMemberId, "friend_completed_task", task.id, { actorName: user.firstName, title: updated.title });
        }
      }

      // Recurring task: spin up exactly the next occurrence, nothing more.
      if (updated.recurrenceId) {
        const recurrence = await prisma.recurringTask.findUnique({ where: { id: updated.recurrenceId } });
        if (recurrence) await createNextOccurrence(recurrence, updated.completedAt ?? new Date());
      }
    } else if (wasDone && body.status && body.status !== "DONE") {
      await logActivity(workspace.id, user.id, "task_reopened", { taskId: task.id, title: updated.title });
    } else {
      if (deadlineChanged) {
        await logActivity(workspace.id, user.id, "deadline_changed", { taskId: task.id, title: updated.title });
        await cancelPendingReminders(task.id);
        await scheduleDeadlineReminders(updated);
      }
      if (progressChanged) {
        await logActivity(workspace.id, user.id, "progress_changed", { taskId: task.id, progress: updated.progress });
      }
      if (!deadlineChanged && !progressChanged) {
        await logActivity(workspace.id, user.id, "task_updated", { taskId: task.id, title: updated.title });
      }
    }

    publish({ type: "tasks_changed", workspaceId: workspace.id, payload: { taskId: task.id } });

    return NextResponse.json({ task: updated });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuthedUser(request);
    const { workspace, task } = await loadOwnedTask(user.id, params.id);
    await prisma.task.delete({ where: { id: task.id } });
    await logActivity(workspace.id, user.id, "task_deleted", { title: task.title });
    publish({ type: "tasks_changed", workspaceId: workspace.id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof z.ZodError) return NextResponse.json({ error: err.flatten() }, { status: 400 });
  const status = (err as { status?: number })?.status ?? 500;
  console.error(err);
  return NextResponse.json({ error: "Something went wrong" }, { status });
}
