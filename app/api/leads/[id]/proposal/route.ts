import { NextResponse } from "next/server";
import { createOutreachDraft } from "@/lib/leads/outreach";
import { getLead } from "@/lib/leads/repository";
import { leadsAuth, leadsError, notFound } from "@/lib/leads/route-helpers";

// POST /api/leads/:id/proposal — «✨ Создать предложение» по фактам лида:
// черновик письма (Outreach DRAFT). Ничего не отправляется.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, workspace } = await leadsAuth(request);
    const lead = await getLead(params.id, workspace.id);
    if (!lead) return notFound();

    const draft = await createOutreachDraft({ lead, channel: "EMAIL", actorId: user.id });
    return NextResponse.json({
      text: draft.text.body,
      subject: draft.text.subject ?? null,
      recipient: draft.recipient,
      warnings: draft.text.warnings,
      engine: draft.engine,
      note: draft.note,
    });
  } catch (err) {
    return leadsError(err);
  }
}
