import { NextResponse } from "next/server";
import { z } from "zod";
import { toOutreachDTO } from "@/lib/leads/dto";
import {
  discardDraft,
  getOutreach,
  getOutreachGenerator,
  markOutreachReady,
  markOutreachSent,
  outreachWarnings,
  prepareOutreach,
  setOutreachOutcome,
  updateOutreachContent,
} from "@/lib/leads/outreach";
import { mailboxUser } from "@/lib/leads/mail/account";
import { sendOutreachEmail } from "@/lib/leads/mail/send";
import { getLead } from "@/lib/leads/repository";
import { leadsAuth, leadsError, notFound } from "@/lib/leads/route-helpers";
import { publish } from "@/lib/pubsub";

export const dynamic = "force-dynamic";

type Params = { params: { oid: string } };

async function respond(id: string, workspaceId: string) {
  const o = await getOutreach(id, workspaceId);
  if (!o) return notFound();
  const mailbox = await mailboxUser(workspaceId);
  return NextResponse.json({ outreach: toOutreachDTO(o, { warnings: await outreachWarnings(o), engine: getOutreachGenerator().generator.label, mailbox }) });
}

// GET /api/leads/outreach/:oid — обращение для редактора.
export async function GET(request: Request, { params }: Params) {
  try {
    const { workspace } = await leadsAuth(request);
    return await respond(params.oid, workspace.id);
  } catch (err) {
    return leadsError(err);
  }
}

const patchSchema = z.union([
  z.object({ subject: z.string().max(200).nullish(), body: z.string().trim().min(10).max(4000) }),
  z.object({ action: z.enum(["regenerate", "ready", "send", "sent", "replied", "rejected", "client"]) }),
]);

/**
 * PATCH /api/leads/outreach/:oid
 *   { subject?, body } — свой текст (до отметки «отправлено»);
 *   { action } — 🔄 другой вариант · открыл почту · 📤 отправить с подключённой почты ·
 *   ✅ я отправил (сам) · 👀 ответили · ❌ отказ · 🤝 клиент.
 * «send» — единственное, что отправляет письмо, и только по нажатию пользователя.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { user, workspace } = await leadsAuth(request);
    const body = patchSchema.parse(await request.json());
    const o = await getOutreach(params.oid, workspace.id);
    if (!o) return notFound();

    let id = o.id;
    let ok = true;
    if ("body" in body) {
      ok = !!(await updateOutreachContent(o.id, workspace.id, { subject: body.subject, body: body.body }));
    } else {
      switch (body.action) {
        case "regenerate": {
          const lead = await getLead(o.leadId, workspace.id);
          if (!lead) return notFound();
          id = (await prepareOutreach({ lead, channel: o.channel, actorId: user.id, regenerate: true })).outreach.id;
          break;
        }
        case "ready":
          await markOutreachReady(o.id, workspace.id);
          break;
        case "send": {
          const r = await sendOutreachEmail(o.id, workspace.id, user.id);
          if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
          break;
        }
        case "sent":
          ok = !!(await markOutreachSent(o.id, workspace.id, user.id));
          break;
        default:
          ok = !!(await setOutreachOutcome(o.id, workspace.id, body.action, user.id));
      }
    }
    if (!ok) return NextResponse.json({ error: "not_editable" }, { status: 409 });
    publish({ type: "leads_changed", workspaceId: workspace.id });
    publish({ type: "tasks_changed", workspaceId: workspace.id });
    return await respond(id, workspace.id);
  } catch (err) {
    return leadsError(err);
  }
}

// DELETE /api/leads/outreach/:oid — «❌ Отмена» черновика (отправленные не удаляются).
export async function DELETE(request: Request, { params }: Params) {
  try {
    const { workspace } = await leadsAuth(request);
    const r = await discardDraft(params.oid, workspace.id);
    if (!r) return NextResponse.json({ error: "not_editable" }, { status: 409 });
    publish({ type: "leads_changed", workspaceId: workspace.id });
    return NextResponse.json({ leadId: r.leadId });
  } catch (err) {
    return leadsError(err);
  }
}
