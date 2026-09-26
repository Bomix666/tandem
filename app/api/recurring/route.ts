import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuthedUser, requireWorkspace, AuthError } from "@/lib/telegram-auth";
import { z } from "zod";

const createRecurringSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  assigneeId: z.string(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  frequency: z.enum(["DAILY", "WEEKDAYS", "WEEKLY", "MONTHLY", "CUSTOM"]),
  weekdays: z.array(z.number().int().min(1).max(7)).default([]), // ISO: 1=Пн..7=Вс
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function POST(request: Request) {
  try {
    const user = await requireAuthedUser(request);
    const workspace = await requireWorkspace(user.id);
    const body = createRecurringSchema.parse(await request.json());

    if (body.frequency === "CUSTOM" && body.weekdays.length === 0) {
      return NextResponse.json({ error: "Выберите хотя бы один день недели" }, { status: 400 });
    }
    const assigneeIsMember = workspace.members.some((m) => m.userId === body.assigneeId);
    if (!assigneeIsMember) {
      return NextResponse.json({ error: "Assignee is not a workspace member" }, { status: 400 });
    }

    const recurrence = await prisma.recurringTask.create({
      data: {
        workspaceId: workspace.id,
        title: body.title,
        description: body.description,
        assigneeId: body.assigneeId,
        priority: body.priority,
        frequency: body.frequency,
        weekdays: body.weekdays,
        timeOfDay: body.timeOfDay,
      },
    });

    return NextResponse.json({ recurrence }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.flatten() }, { status: 400 });
    console.error(err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
