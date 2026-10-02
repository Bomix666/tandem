import { NextResponse } from "next/server";
import { z } from "zod";
import { toFollowUpDTO } from "@/lib/leads/dto";
import { closeFollowUp, getFollowUp, snoozeFollowUp } from "@/lib/leads/followups";
import { leadsAuth, leadsError, notFound } from "@/lib/leads/route-helpers";
import { publish } from "@/lib/pubsub";

export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ action: z.literal("snooze"), days: z.number().int().min(1).max(60) }),
  z.object({ action: z.literal("close"), how: z.enum(["replied", "rejected", "client", "again", "done"]) }),
]);

/**
 * POST /api/leads/followups/:taskId
 *   { action: "snooze", days } — ⏰ отложить;
 *   { action: "close", how } — ✅ закрыть: ответили / отказ / клиент / написал ещё раз / просто закрыть.
 */
export async function POST(request: Request, { params }: { params: { taskId: string } }) {
  try {
    const { user, workspace } = await leadsAuth(request);
    const body = bodySchema.parse(await request.json());
    const existing = await getFollowUp(params.taskId, workspace.id);
    if (!existing) return notFound();
    if (existing.task.status === "DONE") return NextResponse.json({ error: "closed" }, { status: 409 });

    if (body.action === "snooze") await snoozeFollowUp(params.taskId, workspace.id, user.id, body.days);
    else await closeFollowUp(params.taskId, workspace.id, user.id, body.how);

    publish({ type: "tasks_changed", workspaceId: workspace.id, payload: { taskId: params.taskId } });
    publish({ type: "leads_changed", workspaceId: workspace.id });
    const fresh = await getFollowUp(params.taskId, workspace.id);
    return NextResponse.json({ followUp: fresh ? toFollowUpDTO(fresh) : null });
  } catch (err) {
    return leadsError(err);
  }
}
