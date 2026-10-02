import { NextResponse } from "next/server";
import { toFollowUpDTO } from "@/lib/leads/dto";
import { followUpCounts, listFollowUps } from "@/lib/leads/followups";
import { leadsAuth, leadsError } from "@/lib/leads/route-helpers";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// GET /api/leads/followups?page=0 — открытые follow-up по сроку и счётчики.
export async function GET(request: Request) {
  try {
    const { workspace } = await leadsAuth(request);
    const page = Math.max(0, Number(new URL(request.url).searchParams.get("page")) || 0);
    const now = new Date();
    const [list, counts] = await Promise.all([listFollowUps(workspace.id, page, PAGE_SIZE), followUpCounts(workspace.id, now)]);
    const outreachIds = list.items.map((i) => i.outreachId).filter((id): id is string => !!id);
    const outreach = outreachIds.length ? await prisma.outreach.findMany({ where: { id: { in: outreachIds } } }) : [];
    const items = list.items.map((i) => toFollowUpDTO({ ...i, outreach: outreach.find((o) => o.id === i.outreachId) ?? null }, now));
    return NextResponse.json({ items, total: list.total, counts, page, pageSize: PAGE_SIZE });
  } catch (err) {
    return leadsError(err);
  }
}
