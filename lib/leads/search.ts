// Конвейер поиска лидов: источники → объединение → дубли → проверка сайтов →
// скоринг → отбор. Внешние вызовы приходят через SearchDeps, поэтому
// конвейер тестируется без сети. Ничего не выдумывает: если источник не
// ответил — предупреждение и работа с тем, что есть; если не ответил никто —
// понятная ошибка.

import { LeadIndex, rejectKey } from "./dedupe";
import { applyAudit, applyChainSizes, candidateToDraft, enrichWithOsm, findOsmMatch } from "./merge";
import type { NicheSpec } from "./niches";
import { addressInCity, normalizeName } from "./normalize";
import { buildOfferPlan, type OfferPlan } from "./offer";
import { YANDEX_MAX_SKIP, YANDEX_PAGE_SIZE } from "./providers/yandex";
import type { SearchRequirements } from "./requirements";
import { scoreLead } from "./scoring";
import type { BusinessCandidate, LeadDraft, ScoreResult, SiteAudit, WebsiteKind } from "./types";

export interface SearchInput {
  niche: NicheSpec;
  city: string;
  requested: number;
  requirements: SearchRequirements;
  osmOnly: boolean;
  offset: number;
  excludeExisting: boolean; // «Найти ещё»: пропускать бизнесы, которые уже есть в базе
  excludeKeys: Set<string>; // ранее отклонённые кандидаты
}

export interface SearchProgress {
  stage: string;
  found: number;
  target: number;
  checked: number;
  filtered: number;
  warnings: string[];
}

export interface AcceptedLead {
  draft: LeadDraft;
  result: ScoreResult;
  offer: OfferPlan;
  existingId: string | null;
}

export interface SearchOutcome {
  accepted: AcceptedLead[];
  checked: number;
  filtered: number;
  skippedKnown: number;
  rejectedKeys: string[];
  nextOffset: number;
  exhausted: boolean;
  warnings: string[];
  sourceLabel: string;
}

export interface SearchDeps {
  yandexConfigured: boolean;
  osmEnabled: boolean;
  yandex: (p: { text: string; skip: number }) => Promise<{ items: BusinessCandidate[] }>;
  osm: (niche: NicheSpec, city: string, opts?: { budgetMs?: number }) => Promise<BusinessCandidate[]>;
  audit: (url: string) => Promise<SiteAudit>;
  index: LeadIndex;
  onProgress?: (p: SearchProgress) => void;
  now?: Date;
  concurrency?: number;
}

export class SearchNotConfiguredError extends Error {}
export class SearchFailedError extends Error {}

const OSM_SUPPLEMENT_BUDGET_MS = 20_000;
const OSM_ONLY_BUDGET_MS = 90_000;

const WEBSITE_RANK: Record<WebsiteKind, number> = { none: 0, social: 1, booking: 2, own: 3 };
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runLeadSearch(input: SearchInput, deps: SearchDeps): Promise<SearchOutcome> {
  const now = deps.now ?? new Date();
  const warnings: string[] = [];
  const progress: SearchProgress = { stage: "", found: 0, target: input.requested, checked: 0, filtered: 0, warnings };
  const report = (stage?: string) => {
    if (stage) progress.stage = stage;
    deps.onProgress?.({ ...progress, warnings: [...warnings] });
  };
  const ctx = { city: input.city, niche: input.niche };

  let useYandex = !input.osmOnly;
  if (useYandex && !deps.yandexConfigured) {
    throw new SearchNotConfiguredError("Не подключён API поиска бизнесов (YANDEX_PLACES_API_KEY).");
  }

  // --- 1. Яндекс: основной источник ---
  const yandexItems: BusinessCandidate[] = [];
  let exhausted = false;
  if (useYandex) {
    report("Запрашиваю Яндекс Карты…");
    const text = `${input.niche.query} ${input.city}`;
    const pages = Math.max(1, Math.min(3, Math.ceil((input.requested * 4) / YANDEX_PAGE_SIZE)));
    try {
      for (let i = 0; i < pages; i++) {
        const skip = input.offset + i * YANDEX_PAGE_SIZE;
        if (skip > YANDEX_MAX_SKIP) {
          exhausted = true;
          break;
        }
        const page = await deps.yandex({ text, skip });
        yandexItems.push(...page.items);
        if (page.items.length < YANDEX_PAGE_SIZE) {
          exhausted = true;
          break;
        }
      }
    } catch (err) {
      if (yandexItems.length > 0) {
        warnings.push(`⚠️ Яндекс ответил не полностью (${errMsg(err)}). Продолжаю с тем, что есть...`);
      } else if (deps.osmEnabled) {
        warnings.push(`⚠️ Не удалось получить данные из Яндекса (${errMsg(err)}). Продолжаю поиск по OpenStreetMap...`);
        useYandex = false;
      } else {
        throw new SearchFailedError(`Не удалось получить данные из Яндекса: ${errMsg(err)}`);
      }
      report();
    }
  }

  // --- 2. OSM: проверка и дополнение (или основной, если Яндекс недоступен) ---
  let osmItems: BusinessCandidate[] = [];
  let osmOk = false;
  if (deps.osmEnabled) {
    report(useYandex ? "Сверяю с OpenStreetMap…" : "Ищу в OpenStreetMap…");
    try {
      // OSM как дополнение к Яндексу не должен задерживать поиск: ждём его недолго.
      osmItems = await deps.osm(input.niche, input.city, { budgetMs: useYandex ? OSM_SUPPLEMENT_BUDGET_MS : OSM_ONLY_BUDGET_MS });
      osmOk = true;
    } catch (err) {
      if (!useYandex) {
        throw new SearchFailedError(
          (input.osmOnly
            ? "OpenStreetMap сейчас не отвечает — его публичные серверы перегружены. Попробуй повторить через несколько минут. Надёжнее всего подключить ключ Яндекса — это основной источник."
            : "Не удалось получить данные ни из Яндекса, ни из OpenStreetMap. Попробуй повторить через несколько минут.") +
            `\n\nПодробности: ${errMsg(err)}`
        );
      }
      warnings.push("⚠️ Не удалось получить данные из OpenStreetMap.\nПродолжаю поиск...");
      report();
    }
  }

  // --- 3. кандидаты ---
  let drafts: LeadDraft[];
  let pageSize: number;
  if (useYandex) {
    drafts = yandexItems
      .filter((c) => !c.address || addressInCity(c.address, input.city))
      .map((c) => candidateToDraft(c, ctx));
    applyChainSizes(drafts, yandexItems.map((c) => normalizeName(c.name)));
    if (osmOk) {
      const used = new Set<string>();
      for (const d of drafts) {
        const match = findOsmMatch(d, osmItems, used);
        if (match) {
          used.add(match.externalId);
          enrichWithOsm(d, match, input.city);
        }
      }
    }
    pageSize = yandexItems.length;
  } else {
    // смещение в выдаче Яндекса к списку OSM не относится — при откате на OSM начинаем с начала
    const osmOffset = input.osmOnly ? input.offset : 0;
    const slice = osmItems.slice(osmOffset);
    drafts = slice.map((c) => candidateToDraft(c, ctx));
    applyChainSizes(drafts, osmItems.map((c) => normalizeName(c.name)));
    pageSize = slice.length;
    exhausted = true;
  }

  // --- 4. дубли внутри выдачи (филиалы с общим телефоном/сайтом = один бизнес) ---
  const batch = new LeadIndex();
  const unique: [number, LeadDraft][] = [];
  drafts.forEach((d, i) => {
    if (batch.find(d)) return;
    batch.add({ id: String(i), ...d });
    unique.push([i, d]);
  });

  // --- 5. порядок: сначала те, с кем можно связаться, затем — точно из ниши,
  // затем — без собственного сайта; внутри — порядок источника. В OSM у многих
  // точек нет ни телефона, ни сайта — они уходят в конец и не съедают лимит.
  const contactRank = (d: LeadDraft) => (d.phones.length || d.emails.length || d.socials.length || d.websiteKind !== "none" ? 0 : 1);
  const queue = unique.sort(
    ([ia, a], [ib, b]) =>
      contactRank(a) - contactRank(b) ||
      Number(b.nicheMatch) - Number(a.nicheMatch) ||
      WEBSITE_RANK[a.websiteKind] - WEBSITE_RANK[b.websiteKind] ||
      ia - ib
  );

  // --- 6. проверка сайтов и отбор (несколько параллельно, бот при этом не ждёт) ---
  report("Проверяю бизнесы и сайты…");
  // Лимит — только на загрузку сайтов (сеть, до 10 с каждый); остальное считается мгновенно.
  const maxAudits = Math.min(45, input.requested * 3);
  let audits = 0;
  const accepted: AcceptedLead[] = [];
  const rejectedKeys: string[] = [];
  const processed = new Set<number>();
  let skippedKnown = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length && accepted.length < input.requested) {
      const [origIdx, d] = queue[cursor++]!;
      const key = rejectKey(d);
      const existing = deps.index.find(d);
      if (input.excludeKeys.has(key) || (existing && input.excludeExisting)) {
        skippedKnown++;
        processed.add(origIdx);
        continue;
      }
      const needsAudit = d.websiteKind === "own" && !!d.website && !input.requirements.noOwnSite;
      if (needsAudit && audits >= maxAudits) continue; // не проверили — останется для «Найти ещё»
      progress.checked++;
      if (needsAudit) {
        audits++;
        applyAudit(d, await deps.audit(d.website!));
      }
      const result = scoreLead(d, input.requirements, now);
      if (result.reject) {
        progress.filtered++;
        rejectedKeys.push(key);
        processed.add(origIdx);
      } else if (accepted.length < input.requested) {
        accepted.push({ draft: d, result, offer: buildOfferPlan(d, input.niche), existingId: existing?.id ?? null });
        progress.found = accepted.length;
        processed.add(origIdx);
      }
      // подходящий, но лишний (набрали нужное параллельно) — не помечаем, найдётся в «Найти ещё»
      report();
    }
  };
  await Promise.all(Array.from({ length: deps.concurrency ?? 5 }, worker));

  // Если в загруженной выдаче остались необработанные — «Найти ещё» начнёт с
  // того же места (обработанные отсеются как уже найденные/отклонённые).
  const allProcessed = drafts.every((_, i) => processed.has(i) || !unique.some(([u]) => u === i));
  const nextOffset = allProcessed ? input.offset + pageSize : input.offset;

  accepted.sort((a, b) => b.result.score - a.result.score);
  report("Готово");

  return {
    accepted,
    checked: progress.checked,
    filtered: progress.filtered,
    skippedKnown,
    rejectedKeys,
    nextOffset,
    exhausted: exhausted && allProcessed,
    warnings,
    sourceLabel: useYandex ? (osmOk ? "Яндекс Карты + OpenStreetMap" : "Яндекс Карты") : "OpenStreetMap",
  };
}
