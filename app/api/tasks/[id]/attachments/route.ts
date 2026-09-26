import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthedUser, requireWorkspace, AuthError } from "@/lib/telegram-auth";
import { logActivity } from "@/lib/activity";
import { buildStorageKey, getUploadUrl, getDownloadUrl, isAllowedUpload } from "@/lib/storage";
import { z } from "zod";

const requestUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
});

// Step 1: client asks for a place to upload. We never accept the file
// bytes ourselves — the client PUTs directly to storage with the signed
// URL, then calls PATCH below to record the attachment once the upload
// succeeds. Keeps the Next.js app stateless and off the file-bytes path.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);
    const task = await prisma.task.findFirst({ where: { id: params.id, workspaceId: workspace.id } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const body = requestUploadSchema.parse(await request.json());
    if (!isAllowedUpload(body.mimeType, body.size)) {
      return NextResponse.json({ error: "File type not allowed or too large (20MB max)" }, { status: 400 });
    }

    const storageKey = buildStorageKey(task.id, body.filename);
    const uploadUrl = await getUploadUrl(storageKey, body.mimeType);

    return NextResponse.json({ uploadUrl, storageKey });
  } catch (err) {
    return errorResponse(err);
  }
}

const confirmSchema = z.object({
  storageKey: z.string().min(1),
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
});

// Step 2: client confirms the upload landed in storage; we record it.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);
    const task = await prisma.task.findFirst({ where: { id: params.id, workspaceId: workspace.id } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const body = confirmSchema.parse(await request.json());
    if (!isAllowedUpload(body.mimeType, body.size)) {
      return NextResponse.json({ error: "File type not allowed or too large (20MB max)" }, { status: 400 });
    }
    if (!body.storageKey.startsWith(`tasks/${task.id}/`)) {
      // storage keys are namespaced per task in buildStorageKey(); reject
      // anything that doesn't match to stop cross-task key guessing.
      return NextResponse.json({ error: "Invalid storage key" }, { status: 400 });
    }

    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId: task.id,
        uploaderId: user.id,
        filename: body.filename,
        mimeType: body.mimeType,
        size: body.size,
        storageKey: body.storageKey,
      },
    });

    await logActivity(workspace.id, user.id, "attachment_added", { taskId: task.id, title: task.title, filename: body.filename });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

// List a task's attachments, each with a short-lived signed download URL.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);
    const task = await prisma.task.findFirst({ where: { id: params.id, workspaceId: workspace.id } });
    if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

    const attachments = await prisma.taskAttachment.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "desc" } });
    const withUrls = await Promise.all(
      attachments.map(async (a) => ({ ...a, downloadUrl: await getDownloadUrl(a.storageKey) }))
    );

    return NextResponse.json({ attachments: withUrls });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof z.ZodError) return NextResponse.json({ error: err.flatten() }, { status: 400 });
  console.error(err);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
