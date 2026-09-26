import { NextResponse } from "next/server";
import { z } from "zod";
import { toLeadDTO } from "@/lib/leads/dto";
import { LEAD_STATUS_ORDER } from "@/lib/leads/labels";
import { getLead, setLeadStatus } from "@/lib/leads/repository";
import { leadsAuth, leadsError, notFound } from "@/lib/leads/route-helpers";
import { prisma } from "@/lib/prisma";
import { publish } from "@/lib/pubsub";

// ответы зависят от пользователя (Telegram initData) — никакого статического рендера
export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

export async function GET(request: Request, { params }: Params) {
  try {
    const { workspace } = await leadsAuth(request);
    const lead = await getLead(params.id, workspace.id);
    return lead ? NextResponse.json({ lead: toLeadDTO(lead) }) : notFound();
  } catch (err) {
    return leadsError(err);
  }
}

const patchSchema = z.object({
  status: z.enum(LEAD_STATUS_ORDER as [string, ...string[]]).optional(),
  saved: z.boolean().optional(),
});

// PATCH /api/leads/:id { status?, saved? } — CRM-статус и «❤️ Сохранить».
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { workspace } = await leadsAuth(request);
    const body = patchSchema.parse(await request.json());
    const lead = await getLead(params.id, workspace.id);
    if (!lead) return notFound();

    if (body.status && body.status !== lead.status) {
      await setLeadStatus(lead.id, workspace.id, body.status as (typeof LEAD_STATUS_ORDER)[number]);
    }
    if (body.saved !== undefined && body.saved !== lead.saved) {
      await prisma.lead.update({ where: { id: lead.id }, data: { saved: body.saved } });
    }
    publish({ type: "leads_changed", workspaceId: workspace.id });
    const fresh = await getLead(lead.id, workspace.id);
    return NextResponse.json({ lead: toLeadDTO(fresh!) });
  } catch (err) {
    return leadsError(err);
  }
}
