import { NextResponse } from "next/server";
import { z } from "zod";
import { toOutreachDTO } from "@/lib/leads/dto";
import { getOutreach, outreachWarnings, prepareOutreach } from "@/lib/leads/outreach";
import { mailboxUser } from "@/lib/leads/mail/account";
import { getLead } from "@/lib/leads/repository";
import { leadsAuth, leadsError, notFound } from "@/lib/leads/route-helpers";
import { publish } from "@/lib/pubsub";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ channel: z.enum(["EMAIL", "TELEGRAM", "WHATSAPP", "SOCIAL"]), regenerate: z.boolean().optional() });

// POST /api/leads/:id/outreach { channel } — «✨ Подготовить письмо» / «💬 Сообщение».
// Один открытый черновик на лид и канал: повторный вызов открывает его.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, workspace } = await leadsAuth(request);
    const { channel, regenerate } = bodySchema.parse(await request.json());
    const lead = await getLead(params.id, workspace.id);
    if (!lead) return notFound();
    const p = await prepareOutreach({ lead, channel, actorId: user.id, regenerate });
    const o = await getOutreach(p.outreach.id, workspace.id);
    if (!o) return notFound();
    if (!p.reused) publish({ type: "leads_changed", workspaceId: workspace.id });
    const mailbox = await mailboxUser(workspace.id);
    return NextResponse.json({ outreach: toOutreachDTO(o, { warnings: await outreachWarnings(o), engine: p.engine, mailbox }), reused: p.reused }, { status: p.reused ? 200 : 201 });
  } catch (err) {
    return leadsError(err);
  }
}
