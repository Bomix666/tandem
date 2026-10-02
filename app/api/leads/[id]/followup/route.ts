import { NextResponse } from "next/server";
import { z } from "zod";
import { setFollowUp } from "@/lib/leads/followups";
import { leadsAuth, leadsError, notFound } from "@/lib/leads/route-helpers";
import { daysFromNow } from "@/lib/leads/time";
import { publish } from "@/lib/pubsub";

export const dynamic = "force-dynamic";

const bodySchema = z.union([
  z.object({ days: z.number().int().min(1).max(365), outreachId: z.string().nullish() }),
  z.object({ at: z.string().datetime(), outreachId: z.string().nullish() }),
]);

// POST /api/leads/:id/followup { days | at, outreachId? } — «⏰ Follow-up»: напомнить о лиде.
// Задача «Follow-up: …» в таск-менеджере; на лид одна — новая дата переносит её.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, workspace } = await leadsAuth(request);
    const body = bodySchema.parse(await request.json());
    const at = "days" in body ? daysFromNow(body.days) : new Date(body.at);
    if (at.getTime() < Date.now() - 60_000) return NextResponse.json({ error: "past_date" }, { status: 400 });
    const r = await setFollowUp({ leadId: params.id, workspaceId: workspace.id, userId: user.id, at, outreachId: body.outreachId ?? null });
    if (!r) return notFound();
    publish({ type: "tasks_changed", workspaceId: workspace.id, payload: { taskId: r.taskId } });
    publish({ type: "leads_changed", workspaceId: workspace.id });
    return NextResponse.json({ followUp: { taskId: r.taskId, at: r.at.toISOString(), created: r.created } }, { status: r.created ? 201 : 200 });
  } catch (err) {
    return leadsError(err);
  }
}
