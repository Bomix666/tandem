import { NextResponse } from "next/server";
import { toLeadDTO, toSearchDTO } from "@/lib/leads/dto";
import { getSearch, getSearchLeads, potentialBreakdown } from "@/lib/leads/repository";
import { leadsAuth, leadsError, notFound } from "@/lib/leads/route-helpers";

// ответы зависят от пользователя (Telegram initData) — никакого статического рендера
export const dynamic = "force-dynamic";

// GET /api/leads/searches/:id — прогресс поиска, а после завершения — итог и его лиды.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { workspace } = await leadsAuth(request);
    const search = await getSearch(params.id, workspace.id);
    if (!search) return notFound();
    if (search.status === "RUNNING") return NextResponse.json({ search: toSearchDTO(search), leads: [] });

    const [leads, breakdown] = await Promise.all([getSearchLeads(search.id, workspace.id), potentialBreakdown(search.id)]);
    return NextResponse.json({ search: toSearchDTO(search, breakdown), leads: leads.map(toLeadDTO) });
  } catch (err) {
    return leadsError(err);
  }
}
