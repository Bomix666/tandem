import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthedUser, requireWorkspace, AuthError } from "@/lib/telegram-auth";
import { logActivity } from "@/lib/activity";
import { notifyEvent } from "@/lib/notifications";
import { publish } from "@/lib/pubsub";
import { z } from "zod";

const presenceSchema = z.object({
  status: z.enum(["ONLINE", "AWAY", "OFFLINE", "WORKING"]),
  workingTaskId: z.string().nullable().optional(),
});

// Called on a heartbeat (e.g. every 20-30s while the Mini App is foregrounded)
// and whenever the user taps "Start working" / "Stop working" / backgrounds
// the app. AWAY/OFFLINE should also be set by a periodic sweep job that
// demotes any presence row whose lastSeenAt is stale, since a client can
// disappear without ever calling this route (app killed, phone locked).
export async function POST(request: Request) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);
    const body = presenceSchema.parse(await request.json());

    const previous = await prisma.presence.findUnique({ where: { userId: user.id } });

    const presence = await prisma.presence.upsert({
      where: { userId: user.id },
      update: { status: body.status, workingTaskId: body.workingTaskId ?? null, lastSeenAt: new Date() },
      create: { userId: user.id, status: body.status, workingTaskId: body.workingTaskId ?? null },
    });

    if (body.status === "WORKING" && body.workingTaskId && previous?.workingTaskId !== body.workingTaskId) {
      const task = await prisma.task.findUnique({ where: { id: body.workingTaskId } });
      if (task) {
        await logActivity(workspace.id, user.id, "work_started", { taskId: task.id, title: task.title });
        const otherMemberId = workspace.members.map((m) => m.userId).find((id) => id !== user.id);
        if (otherMemberId) {
          const prefs = await prisma.notificationPreference.findUnique({ where: { userId: otherMemberId } });
          if (prefs?.friendStartedWorking) {
            await notifyEvent(otherMemberId, "friend_started_working", task.id, { actorName: user.firstName, title: task.title });
          }
        }
      }
    } else if (previous?.status === "WORKING" && body.status !== "WORKING" && previous.workingTaskId) {
      const task = await prisma.task.findUnique({ where: { id: previous.workingTaskId } });
      if (task) await logActivity(workspace.id, user.id, "work_stopped", { taskId: task.id, title: task.title });
    }

    publish({ type: "presence_changed", workspaceId: workspace.id });

    return NextResponse.json({ presence });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.flatten() }, { status: 400 });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);
    const memberIds = workspace.members.map((m) => m.userId);
    const presences = await prisma.presence.findMany({ where: { userId: { in: memberIds } } });
    return NextResponse.json({ presences });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
