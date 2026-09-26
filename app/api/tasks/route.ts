import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthedUser, requireWorkspace, AuthError } from "@/lib/telegram-auth";
import { logActivity } from "@/lib/activity";
import { scheduleDeadlineReminders, notifyEvent } from "@/lib/notifications";
import { publish } from "@/lib/pubsub";
import { z } from "zod";

const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  assigneeId: z.string(),
  deadlineAt: z.string().datetime(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  progress: z.number().int().min(0).max(100).default(0),
  recurrenceId: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);

    const { searchParams } = new URL(request.url);
    const includeDone = searchParams.get("status") === "done";

    const tasks = await prisma.task.findMany({
      where: {
        workspaceId: workspace.id,
        status: includeDone ? "DONE" : { not: "DONE" },
      },
      orderBy: includeDone ? { completedAt: "desc" } : { deadlineAt: "asc" },
      include: { assignee: true, creator: true, _count: { select: { comments: true, attachments: true } } },
    });

    return NextResponse.json({ tasks });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);

    const body = createTaskSchema.parse(await request.json());

    // assignee must be a member of this same two-person workspace
    const assigneeIsMember = workspace.members.some((m) => m.userId === body.assigneeId);
    if (!assigneeIsMember) {
      return NextResponse.json({ error: "Assignee is not a workspace member" }, { status: 400 });
    }

    const task = await prisma.task.create({
      data: {
        workspaceId: workspace.id,
        creatorId: user.id,
        assigneeId: body.assigneeId,
        title: body.title,
        description: body.description,
        deadlineAt: new Date(body.deadlineAt),
        priority: body.priority,
        progress: body.progress,
        status: body.progress >= 100 ? "DONE" : body.progress > 0 ? "IN_PROGRESS" : "TODO",
        recurrenceId: body.recurrenceId,
      },
      include: { assignee: true, creator: true },
    });

    await logActivity(workspace.id, user.id, "task_created", { taskId: task.id, title: task.title });
    await scheduleDeadlineReminders(task);

    // Notify the other member: two distinct events depending on whether the
    // task lands on them (assigned_new_task) or just appears in the shared
    // workspace assigned to the creator (friend_created_task).
    const otherMemberId = workspace.members.map((m) => m.userId).find((id) => id !== user.id);
    if (otherMemberId) {
      const prefs = await prisma.notificationPreference.findUnique({ where: { userId: otherMemberId } });
      if (task.assigneeId === otherMemberId) {
        if (!prefs || prefs.assignedNewTask !== false) {
          await notifyEvent(otherMemberId, "assigned_new_task", task.id, { title: task.title });
        }
      } else if (!prefs || prefs.friendCreatedTask !== false) {
        await notifyEvent(otherMemberId, "friend_created_task", task.id, { actorName: user.firstName, title: task.title });
      }
    }

    publish({ type: "tasks_changed", workspaceId: workspace.id, payload: { taskId: task.id } });

    return NextResponse.json({ task }, { status: 201 });
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
