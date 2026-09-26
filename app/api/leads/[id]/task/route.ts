import { NextResponse } from "next/server";
import { z } from "zod";
import { createTaskFromLead } from "@/lib/leads/lead-tasks";
import { leadsAuth, leadsError, notFound } from "@/lib/leads/route-helpers";
import { publish } from "@/lib/pubsub";

const bodySchema = z.object({ force: z.boolean().optional() });

// POST /api/leads/:id/task { force? } — «➕ Создать задачу» из лида.
// Если задача уже есть и force не передан — { status: "exists", task }:
// приложение спрашивает подтверждение, повторная задача — только с force.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, workspace } = await leadsAuth(request);
    const { force } = bodySchema.parse(await request.json().catch(() => ({})));
    const result = await createTaskFromLead({ leadId: params.id, workspace, user, force: !!force });

    if (result.status === "not_found") return notFound();
    if (result.status === "exists") return NextResponse.json({ status: "exists", task: result.task });

    publish({ type: "tasks_changed", workspaceId: workspace.id, payload: { taskId: result.task.id } });
    publish({ type: "leads_changed", workspaceId: workspace.id });
    return NextResponse.json({ status: "created", task: result.task }, { status: 201 });
  } catch (err) {
    return leadsError(err);
  }
}
