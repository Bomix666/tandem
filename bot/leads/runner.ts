// Фоновый запуск поиска. grammY обрабатывает апдейты по очереди, поэтому
// долгий поиск нельзя ждать внутри обработчика — запускаем его отдельно, а
// прогресс показываем, редактируя одно сообщение (не чаще раза в 1,5 с).

import type { Api, InlineKeyboard } from "grammy";
import type { LeadSearch } from "@prisma/client";
import { isYandexConfigured, leadsConfig } from "../../lib/leads/config";
import { resolveNiche } from "../../lib/leads/niches";
import { searchOsm } from "../../lib/leads/providers/osm";
import { searchYandex } from "../../lib/leads/providers/yandex";
import {
  createLeadSearch,
  failLeadSearch,
  finishLeadSearch,
  getLead,
  getSearchLeadAt,
  hasRunningSearch,
  loadLeadIndex,
  loadRejectedKeys,
  potentialBreakdown,
  saveSearchOutcome,
} from "../../lib/leads/repository";
import { parseRequirements } from "../../lib/leads/requirements";
import { runLeadSearch, SearchNotConfiguredError, type SearchProgress } from "../../lib/leads/search";
import { auditWebsite } from "../../lib/leads/site-audit";
import { leadCardKeyboard, notConfiguredText, NO_PREVIEW, progressText, renderLeadCard, summaryKeyboard, summaryText, type Nav } from "./format";

const runningWorkspaces = new Set<string>();

export interface LaunchParams {
  chatId: number;
  workspaceId: string;
  userId: string;
  niche: string;
  city: string;
  requested: number;
  extra: string | null;
  osmOnly: boolean;
  parent?: LeadSearch;
}

export async function launchSearch(api: Api, p: LaunchParams): Promise<"started" | "busy"> {
  if (runningWorkspaces.has(p.workspaceId) || (await hasRunningSearch(p.workspaceId))) return "busy";
  runningWorkspaces.add(p.workspaceId);
  try {
    const search = await createLeadSearch({
      workspaceId: p.workspaceId,
      userId: p.userId,
      chatId: p.chatId,
      niche: p.niche,
      city: p.city,
      requested: p.requested,
      extra: p.extra,
      osmOnly: p.osmOnly,
      parentId: p.parent?.id,
      offset: p.parent?.nextOffset ?? 0,
    });
    const initial: SearchProgress = { stage: "Начинаю…", found: 0, target: p.requested, checked: 0, filtered: 0, warnings: [] };
    const msg = await api.sendMessage(p.chatId, progressText(search, initial), { parse_mode: "HTML" });
    void runJob(api, search, p.chatId, msg.message_id)
      .catch((err) => console.error("Lead search job crashed:", err))
      .finally(() => runningWorkspaces.delete(p.workspaceId));
    return "started";
  } catch (err) {
    runningWorkspaces.delete(p.workspaceId);
    throw err;
  }
}

async function runJob(api: Api, search: LeadSearch, chatId: number, messageId: number) {
  let lastText = "";
  const edit = async (text: string, reply_markup?: InlineKeyboard) => {
    if (text === lastText && !reply_markup) return;
    lastText = text;
    await api
      .editMessageText(chatId, messageId, text, { parse_mode: "HTML", reply_markup, link_preview_options: NO_PREVIEW })
      .catch((err: Error) => {
        if (!/message is not modified/i.test(err.message)) console.error("Progress edit failed:", err.message);
      });
  };

  let latest: SearchProgress | null = null;
  const timer = setInterval(() => {
    if (latest) void edit(progressText(search, latest));
  }, 1500);

  try {
    const niche = resolveNiche(search.niche);
    const isMore = search.parentId !== null;
    const [index, excludeKeys] = await Promise.all([
      loadLeadIndex(search.workspaceId),
      isMore ? loadRejectedKeys(search.workspaceId, search.niche, search.city) : Promise.resolve(new Set<string>()),
    ]);

    const outcome = await runLeadSearch(
      {
        niche,
        city: search.city,
        requested: search.requested,
        requirements: parseRequirements(search.extra),
        osmOnly: search.osmOnly,
        offset: search.nextOffset,
        excludeExisting: isMore,
        excludeKeys,
      },
      {
        yandexConfigured: isYandexConfigured(),
        osmEnabled: leadsConfig.osmEnabled,
        yandex: searchYandex,
        osm: searchOsm,
        audit: (url) => auditWebsite(url),
        index,
        onProgress: (p) => {
          latest = p;
        },
      }
    );
    clearInterval(timer);

    const { saved } = await saveSearchOutcome({ searchId: search.id, workspaceId: search.workspaceId, userId: search.userId, outcome });
    const done = await finishLeadSearch(search.id, outcome, saved);
    const breakdown = await potentialBreakdown(search.id);
    await edit(summaryText(done, breakdown, { sourceLabel: outcome.sourceLabel, skippedKnown: outcome.skippedKnown }), summaryKeyboard(done));

    if (saved > 0) await sendSearchCard(api, chatId, search.id, search.workspaceId, 0);
  } catch (err) {
    clearInterval(timer);
    const warnings = (latest as SearchProgress | null)?.warnings ?? [];
    const message = err instanceof Error ? err.message : String(err);
    const failed = await failLeadSearch(search.id, message, warnings).catch(() => null);
    const text = err instanceof SearchNotConfiguredError ? notConfiguredText() : `⚠️ <b>Поиск не выполнен</b>\n\n${message.replace(/</g, "&lt;")}`;
    await edit(text, failed ? summaryKeyboard({ ...failed, found: 0 }) : undefined);
  }
}

/** Навигация по подборке: кнопка «Следующий» знает, какой лид показать дальше. */
export function searchNav(searchId: string, position: number, total: number): Nav {
  const next = position + 1;
  return next < total
    ? { label: "➡️ Следующий", data: `ld:nx:s:${searchId}:${next}` }
    : { label: "🏁 Последний в подборке", data: `ld:nx:s:${searchId}:${next}` };
}

export async function sendSearchCard(api: Api, chatId: number, searchId: string, workspaceId: string, position: number) {
  const found = await getSearchLeadAt(searchId, workspaceId, position);
  if (!found?.lead) return false;
  const lead = await getLead(found.lead.id, workspaceId);
  if (!lead) return false;
  const nav = searchNav(searchId, position, found.total);
  await api.sendMessage(chatId, renderLeadCard(lead, { number: position + 1 }), {
    parse_mode: "HTML",
    reply_markup: leadCardKeyboard(lead, nav),
    link_preview_options: NO_PREVIEW,
  });
  return true;
}
