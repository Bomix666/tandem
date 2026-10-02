import { NextResponse } from "next/server";
import { toLeadDTO } from "@/lib/leads/dto";
import { listLeads, type LeadFilter } from "@/lib/leads/repository";
import { leadsAuth, leadsError } from "@/lib/leads/route-helpers";

// ответы зависят от пользователя (Telegram initData) — никакого статического рендера
export const dynamic = "force-dynamic";

const FILTERS: LeadFilter[] = ["a", "h", "f", "d", "n", "t", "w", "g", "c", "r"];
const PAGE_SIZE = 20;

// GET /api/leads?filter=a&q=барбер&page=0 — «Мои лиды»: фильтр по статусу + поиск по названию.
export async function GET(request: Request) {
  try {
    const { workspace } = await leadsAuth(request);
    const params = new URL(request.url).searchParams;
    const filterParam = params.get("filter") ?? "a";
    const filter: LeadFilter = (FILTERS as string[]).includes(filterParam) ? (filterParam as LeadFilter) : "a";
    const query = params.get("q")?.trim().slice(0, 60) || undefined;
    const page = Math.max(0, Number(params.get("page")) || 0);

    const { items, total } = await listLeads(workspace.id, filter, page, query, PAGE_SIZE);
    return NextResponse.json({ leads: items.map(toLeadDTO), total, page, pageSize: PAGE_SIZE });
  } catch (err) {
    return leadsError(err);
  }
}
