import { NextResponse } from "next/server";
import type { OutreachStatus } from "@prisma/client";
import { toOutreachDTO } from "@/lib/leads/dto";
import { getOutreach, getOutreachGenerator, listOutreach, OUTREACH_STATUS_ORDER, outreachCounts, outreachWarnings } from "@/lib/leads/outreach";
import { leadsAuth, leadsError } from "@/lib/leads/route-helpers";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// GET /api/leads/outreach?status=DRAFT&page=0 — раздел «📨 Outreach»: счётчики и список по статусу.
export async function GET(request: Request) {
  try {
    const { workspace } = await leadsAuth(request);
    const params = new URL(request.url).searchParams;
    const raw = params.get("status") ?? "DRAFT";
    const status: OutreachStatus = (OUTREACH_STATUS_ORDER as string[]).includes(raw) ? (raw as OutreachStatus) : "DRAFT";
    const page = Math.max(0, Number(params.get("page")) || 0);
    const [counts, list] = await Promise.all([outreachCounts(workspace.id), listOutreach(workspace.id, status, page, PAGE_SIZE)]);
    const engine = getOutreachGenerator().generator.label;
    const items = [];
    for (const row of list.items) {
      const o = await getOutreach(row.id, workspace.id);
      if (o) items.push(toOutreachDTO(o, { warnings: await outreachWarnings(o), engine }));
    }
    return NextResponse.json({ counts, items, total: list.total, page, pageSize: PAGE_SIZE });
  } catch (err) {
    return leadsError(err);
  }
}
