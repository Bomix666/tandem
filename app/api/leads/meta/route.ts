import { NextResponse } from "next/server";
import { z } from "zod";
import { isYandexConfigured, leadsConfig } from "@/lib/leads/config";
import { toSearchDTO } from "@/lib/leads/dto";
import { CITY_PRESETS, NICHE_PRESETS } from "@/lib/leads/niches";
import { getOutreachGenerator } from "@/lib/leads/outreach";
import { osmLocalStatus } from "@/lib/leads/providers/osm-local";
import { getActiveSearch, getLeadSettings, getLeadStats, setAvgCheck, setSenderField } from "@/lib/leads/repository";
import { leadsAuth, leadsError } from "@/lib/leads/route-helpers";
import type { LeadsMetaDTO } from "@/types/leads";

// ответы зависят от пользователя (Telegram initData) — никакого статического рендера
export const dynamic = "force-dynamic";

async function buildMeta(workspaceId: string): Promise<LeadsMetaDTO> {
  const [stats, active, osmStatus, settings] = await Promise.all([
    getLeadStats(workspaceId),
    getActiveSearch(workspaceId),
    osmLocalStatus().catch(() => "состояние неизвестно"),
    getLeadSettings(workspaceId),
  ]);
  return {
    yandex: isYandexConfigured(),
    osm: leadsConfig.osmEnabled,
    osmStatus,
    proposalLabel: getOutreachGenerator().generator.label,
    niches: NICHE_PRESETS.map((n) => n.label),
    cities: CITY_PRESETS,
    stats,
    activeSearch: active ? toSearchDTO(active) : null,
    sender: { name: settings.senderName, company: settings.companyName, portfolioUrl: settings.portfolioUrl, contact: settings.senderContact },
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

const text = z.string().trim().max(200).nullable().optional();
const patchSchema = z.object({
  avgCheck: z.number().int().min(1).max(100_000_000).optional(),
  sender: z
    .object({
      name: text,
      company: text,
      portfolioUrl: z.string().trim().max(200).regex(/^https?:\/\/\S+\.\S+/i).nullable().optional().or(z.literal("")),
      contact: text,
    })
    .optional(),
});

// PATCH /api/leads/meta { avgCheck?, sender? } — средний чек и подпись в письмах.
export async function PATCH(request: Request) {
  try {
    const { workspace } = await leadsAuth(request);
    const { avgCheck, sender } = patchSchema.parse(await request.json());
    if (avgCheck) await setAvgCheck(workspace.id, avgCheck);
    if (sender) {
      const fields = { name: "name", company: "company", portfolioUrl: "portfolio", contact: "contact" } as const;
      for (const [key, field] of Object.entries(fields) as [keyof typeof fields, (typeof fields)[keyof typeof fields]][]) {
        if (sender[key] !== undefined) await setSenderField(workspace.id, field, sender[key] || null);
      }
    }
    return NextResponse.json(await buildMeta(workspace.id));
  } catch (err) {
    return leadsError(err);
  }
}
