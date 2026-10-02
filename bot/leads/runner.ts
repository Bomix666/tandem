// Запуск поиска из бота. Сам поиск — общий фоновый job (lib/leads/jobs.ts,
// им же пользуется Mini App); бот лишь показывает прогресс, редактируя одно
// сообщение не чаще раза в 1,5 с, а по завершении — итог и первую карточку.

import type { Api, InlineKeyboard } from "grammy";
import type { LeadSearch } from "@prisma/client";
import { isSearchBusy, startSearchJob, type LeadSource } from "../../lib/leads/jobs";
import { getLead, getSearchLeadAt } from "../../lib/leads/repository";
import type { SearchProgress } from "../../lib/leads/search";
import { leadCardKeyboard, notConfiguredText, NO_PREVIEW, progressText, renderLeadCard, summaryKeyboard, summaryText, type Nav } from "./format";

export interface LaunchParams {
  chatId: number;
  workspaceId: string;
  userId: string;
  niche: string;
  city: string;
  requested: number;
  extra: string | null;
  source: LeadSource;
  parent?: LeadSearch;
}

export async function launchSearch(api: Api, p: LaunchParams): Promise<"started" | "busy" | "not_configured"> {
  if (await isSearchBusy(p.workspaceId)) return "busy";

  const initial: SearchProgress = {
    stage: "Начинаю…",
    candidates: 0,
    found: 0,
    target: p.requested,
    checked: 0,
    filtered: 0,
    withEmail: 0,
    needsReview: 0,
    warnings: [],
  };
  const msg = await api.sendMessage(p.chatId, progressText(p, initial), { parse_mode: "HTML" });

  let lastText = "";
  const edit = async (text: string, reply_markup?: InlineKeyboard) => {
    if (text === lastText && !reply_markup) return;
    lastText = text;
    await api
      .editMessageText(p.chatId, msg.message_id, text, { parse_mode: "HTML", reply_markup, link_preview_options: NO_PREVIEW })
      .catch((err: Error) => {
        if (!/message is not modified/i.test(err.message)) console.error("Progress edit failed:", err.message);
      });
  };

  let latest: SearchProgress | null = null;
  const timer = setInterval(() => {
    if (latest) void edit(progressText(p, latest));
  }, 1500);

  const result = await startSearchJob(
    { ...p, chatId: p.chatId },
    {
      onProgress: (pr) => {
        latest = pr;
      },
      onFinish: async (done, { outcome, breakdown }) => {
        clearInterval(timer);
        await edit(summaryText(done, breakdown, { sourceLabel: outcome.sourceLabel, skippedKnown: outcome.skippedKnown }), summaryKeyboard(done));
        if (done.found > 0) await sendSearchCard(api, p.chatId, done.id, done.workspaceId, 0);
      },
      onError: async (failed, err) => {
        clearInterval(timer);
        const message = err instanceof Error ? err.message : String(err);
        await edit(`⚠️ <b>Поиск не выполнен</b>\n\n${message.replace(/</g, "&lt;")}`, failed ? summaryKeyboard(failed) : undefined);
      },
    }
  );

  if (result.status !== "started") {
    clearInterval(timer);
    await edit(result.status === "busy" ? "⏳ Поиск уже идёт — дождись результата." : notConfiguredText());
  }
  return result.status;
}

/** Навигация по подборке: кнопка «Следующий» знает, какой лид показать дальше. */
export function searchNav(searchId: string, position: number, total: number): Nav {
  const next = position + 1;
  return next < total
    ? { label: "Следующий ›", data: `ld:nx:s:${searchId}:${next}` }
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
