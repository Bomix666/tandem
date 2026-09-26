import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthedUser, requireWorkspace, AuthError } from "@/lib/telegram-auth";
import { logActivity } from "@/lib/activity";
import { notifyCommentAdded } from "@/lib/notifications";
import { publish } from "@/lib/pubsub";
import { z } from "zod";

const commentSchema = z.object({ text: z.string().min(1).max(2000) });

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);
    const task = await prisma.task.findFirst({ where: { id: params.id, workspaceId: workspace.id } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const comments = await prisma.taskComment.findMany({
      where: { taskId: task.id },
      orderBy: { createdAt: "asc" },
      include: { author: true },
    });

    return NextResponse.json({ comments });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);
    const task = await prisma.task.findFirst({ where: { id: params.id, workspaceId: workspace.id } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const { text } = commentSchema.parse(await request.json());

    const comment = await prisma.taskComment.create({
      data: { taskId: task.id, authorId: user.id, text },
      include: { author: true },
    });

    await logActivity(workspace.id, user.id, "comment_added", { taskId: task.id, title: task.title });
    await notifyCommentAdded(task, user.id, text);
    publish({ type: "comments_changed", workspaceId: workspace.id, payload: { taskId: task.id } });

    return NextResponse.json({ comment }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.flatten() }, { status: 400 });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
