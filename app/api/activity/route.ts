import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthedUser, requireWorkspace, AuthError } from "@/lib/telegram-auth";

export async function GET(request: Request) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);

    const { searchParams } = new URL(request.url);
    const limit = Math.min(50, Number(searchParams.get("limit")) || 20);

    const activity = await prisma.taskActivity.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { actor: { select: { id: true, firstName: true } }, task: { select: { id: true, title: true } } },
    });

    return NextResponse.json({ activity });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
