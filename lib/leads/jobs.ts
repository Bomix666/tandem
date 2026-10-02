// Фоновый запуск поиска — общий для Mini App (API) и Telegram-бота.
// Поиск идёт отдельно от запроса/апдейта: прогресс раз в ~1,5 с пишется в
// LeadSearch (приложение его опрашивает), а вызывающая сторона может
// подписаться на хуки (бот так обновляет сообщение с прогрессом).

import type { LeadSearch } from "@prisma/client";
import { publish } from "../pubsub";
import { isYandexConfigured, leadsConfig } from "./config";
import { enrichContacts } from "./contacts";
import { redact, redactError } from "./redact";
import { resolveNiche } from "./niches";
import { searchOsmBest } from "./providers/osm-local";
import { searchYandex } from "./providers/yandex";
import {
  createLeadSearch,
  failLeadSearch,
  finishLeadSearch,
  hasRunningSearch,
  loadLeadIndex,
  loadRejectedKeys,
  potentialBreakdown,
  saveSearchOutcome,
  updateSearchProgress,
} from "./repository";
import { parseRequirements } from "./requirements";
import { runLeadSearch, type SearchOutcome, type SearchProgress } from "./search";
import { auditWebsite } from "./site-audit";

export interface StartSearchParams {
  workspaceId: string;
  userId: string;
  chatId?: number | null;
  niche: string;
  city: string;
  requested: number;
  extra: string | null;
  /** Откуда брать бизнесы: OSM (основной) или Яндекс (тестовая интеграция). */
  source: LeadSource;
  /** «Найти ещё»: продолжение этого поиска с пропуском уже найденного. */
  parent?: LeadSearch | null;
}

export interface SearchJobHooks {
  onProgress?: (p: SearchProgress) => void;
  onFinish?: (search: LeadSearch, info: { outcome: SearchOutcome; breakdown: Awaited<ReturnType<typeof potentialBreakdown>> }) => Promise<void> | void;
  onError?: (search: LeadSearch | null, error: unknown) => Promise<void> | void;
}

export type LeadSource = "osm" | "yandex";

export type StartSearchResult = { status: "started"; search: LeadSearch } | { status: "busy" } | { status: "not_configured" };

const runningWorkspaces = new Set<string>();

/** Идёт ли уже поиск в этом пространстве (в этом процессе или в другом — бот/приложение). */
export async function isSearchBusy(workspaceId: string): Promise<boolean> {
  return runningWorkspaces.has(workspaceId) || (await hasRunningSearch(workspaceId));
}

export async function startSearchJob(params: StartSearchParams, hooks: SearchJobHooks = {}): Promise<StartSearchResult> {
  if (params.source === "yandex" && !isYandexConfigured()) return { status: "not_configured" };
  if (await isSearchBusy(params.workspaceId)) return { status: "busy" };

  runningWorkspaces.add(params.workspaceId);
  let search: LeadSearch;
  try {
    search = await createLeadSearch({
      workspaceId: params.workspaceId,
      userId: params.userId,
      chatId: params.chatId ?? null,
      niche: params.niche,
      city: params.city,
      requested: params.requested,
      extra: params.extra,
      source: params.source,
      parentId: params.parent?.id,
      offset: params.parent?.nextOffset ?? 0,
    });
  } catch (err) {
    runningWorkspaces.delete(params.workspaceId);
    throw err;
  }

  publish({ type: "leads_changed", workspaceId: params.workspaceId });
  void runSearchJob(search, hooks)
    .catch((err) => console.error("Lead search job crashed:", redactError(err)))
    .finally(() => runningWorkspaces.delete(params.workspaceId));
  return { status: "started", search };
}

async function runSearchJob(search: LeadSearch, hooks: SearchJobHooks) {
  let latest: SearchProgress | null = null;
  let dirty = false;
  const flush = async () => {
    if (!dirty || !latest) return;
    dirty = false;
    await updateSearchProgress(search.id, latest).catch((err) => console.error("Search progress update failed:", redactError(err)));
  };
  const timer = setInterval(() => void flush(), 1500);

  try {
    const isMore = search.parentId !== null;
    const [index, excludeKeys] = await Promise.all([
      loadLeadIndex(search.workspaceId),
      isMore ? loadRejectedKeys(search.workspaceId, search.niche, search.city) : Promise.resolve(new Set<string>()),
    ]);

    const outcome = await runLeadSearch(
      {
        niche: resolveNiche(search.niche),
        city: search.city,
        requested: search.requested,
        requirements: parseRequirements(search.extra),
        osmOnly: search.source !== "yandex",
        offset: search.nextOffset,
        excludeExisting: isMore,
        excludeKeys,
      },
      {
        yandexConfigured: isYandexConfigured(),
        osmEnabled: leadsConfig.osmEnabled,
        yandex: searchYandex,
        osm: searchOsmBest,
        audit: (url) => auditWebsite(url),
        contacts: (draft) => enrichContacts(draft),
        index,
        onProgress: (p) => {
          latest = p;
          dirty = true;
          hooks.onProgress?.(p);
        },
      }
    );
    clearInterval(timer);

    const { saved } = await saveSearchOutcome({ searchId: search.id, workspaceId: search.workspaceId, userId: search.userId, outcome });
    const done = await finishLeadSearch(search.id, outcome, saved);
    const breakdown = await potentialBreakdown(search.id);
    publish({ type: "leads_changed", workspaceId: search.workspaceId });
    await hooks.onFinish?.(done, { outcome, breakdown });
  } catch (err) {
    clearInterval(timer);
    const warnings = (latest as SearchProgress | null)?.warnings ?? [];
    const message = redact(err instanceof Error ? err.message : String(err));
    const failed = await failLeadSearch(search.id, message, warnings).catch(() => null);
    publish({ type: "leads_changed", workspaceId: search.workspaceId });
    await hooks.onError?.(failed, err);
  }
}
