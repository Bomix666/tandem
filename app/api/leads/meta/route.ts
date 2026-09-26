import { NextResponse } from "next/server";
import { z } from "zod";
import { isYandexConfigured, leadsConfig } from "@/lib/leads/config";
import { toSearchDTO } from "@/lib/leads/dto";
import { CITY_PRESETS, NICHE_PRESETS } from "@/lib/leads/niches";
import { getProposalGenerator } from "@/lib/leads/proposal";
import { getActiveSearch, getLeadStats, setAvgCheck } from "@/lib/leads/repository";
import { leadsAuth, leadsError } from "@/lib/leads/route-helpers";
import type { LeadsMetaDTO } from "@/types/leads";

// ответы зависят от пользователя (Telegram initData) — никакого статического рендера
export const dynamic = "force-dynamic";

async function buildMeta(workspaceId: string): Promise<LeadsMetaDTO> {
  const [stats, active] = await Promise.all([getLeadStats(workspaceId), getActiveSearch(workspaceId)]);
  return {
    yandex: isYandexConfigured(),
    osm: leadsConfig.osmEnabled,
    proposalLabel: getProposalGenerator().generator.label,
    niches: NICHE_PRESETS.map((n) => n.label),
    cities: CITY_PRESETS,
    stats,
    activeSearch: active ? toSearchDTO(active) : null,
  };
}

// GET /api/leads/meta — настройки источников, пресеты, статистика и идущий поиск.
export async function GET(request: Request) {
  try {
    const { workspace } = await leadsAuth(request);
    return NextResponse.json(await buildMeta(workspace.id));
  } catch (err) {
    return leadsError(err);
  }
}

const patchSchema = z.object({ avgCheck: z.number().int().min(1).max(100_000_000) });

// PATCH /api/leads/meta { avgCheck } — средний чек для расчёта в статистике.
export async function PATCH(request: Request) {
  try {
    const { workspace } = await leadsAuth(request);
    const { avgCheck } = patchSchema.parse(await request.json());
    await setAvgCheck(workspace.id, avgCheck);
    return NextResponse.json(await buildMeta(workspace.id));
  } catch (err) {
    return leadsError(err);
  }
}
