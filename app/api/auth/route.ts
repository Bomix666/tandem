import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireAuthedUser, getUserWorkspace, AuthError } from "@/lib/telegram-auth";
import { publish } from "@/lib/pubsub";

// Called once when the Mini App first opens. Resolves the user, and either
// returns their existing workspace or creates one (first user) — with the
// invite token they can hand to their friend via a Telegram deep link.
export async function GET(request: Request) {
  try {
    const user = await requireAuthedUser(request);
    let workspace = await getUserWorkspace(user.id);

    if (!workspace) {
      workspace = await prisma.workspace.create({
        data: {
          inviteToken: crypto.randomBytes(12).toString("hex"),
          members: { create: { userId: user.id } },
        },
        include: { members: true },
      });
      await prisma.notificationPreference.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    }

    return NextResponse.json({ user, workspace });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// POST /api/auth/join  { token: string }
// Handles a friend opening the `?startapp=invite_<token>` deep link.
export async function POST(request: Request) {
  try {
    const user = await requireAuthedUser(request);
    const { token } = await request.json();

    const existing = await getUserWorkspace(user.id);
    if (existing) return NextResponse.json({ error: "You already belong to a workspace" }, { status: 400 });

    const workspace = await prisma.workspace.findUnique({ where: { inviteToken: token }, include: { members: true } });
    if (!workspace) return NextResponse.json({ error: "Invite link is invalid" }, { status: 404 });
    if (workspace.members.length >= 2) {
      return NextResponse.json({ error: "This workspace already has two members" }, { status: 409 });
    }
    if (workspace.members.some((m) => m.userId === user.id)) {
      return NextResponse.json({ error: "You're already a member" }, { status: 400 });
    }

    await prisma.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id } });
    await prisma.notificationPreference.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
    // invite token is single-use once the workspace is full
    await prisma.workspace.update({ where: { id: workspace.id }, data: { inviteToken: null } });

    const updated = await prisma.workspace.findUnique({ where: { id: workspace.id }, include: { members: true } });
    publish({ type: "presence_changed", workspaceId: workspace.id });
    return NextResponse.json({ workspace: updated });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
