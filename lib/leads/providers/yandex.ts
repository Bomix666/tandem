// Яндекс «API Поиска по организациям» — тестовая интеграция (основной источник —
// локальная копия OpenStreetMap): условия Яндекса ограничивают хранение
// результатов, поэтому на нём не строится основная работа. Документация: https://yandex.ru/dev/geosearch/doc/ru/
// Ключ — YANDEX_PLACES_API_KEY в .env (Кабинет разработчика Яндекса).

import { leadsConfig } from "../config";
import { fetchJson, HttpError } from "../http";
import { redact } from "../redact";
import type { BusinessCandidate } from "../types";

export const YANDEX_PAGE_SIZE = 50; // максимум API за один запрос
export const YANDEX_MAX_SKIP = 1000;

export class ProviderError extends Error {
  constructor(
    message: string,
    public provider: "yandex" | "osm"
  ) {
    super(message);
  }
}

interface YandexFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    description?: string;
    CompanyMetaData?: {
      id?: string;
      name?: string;
      address?: string;
      url?: string;
      Phones?: { type?: string; formatted?: string }[];
      Categories?: { class?: string; name?: string }[];
      Hours?: { text?: string };
    };
  };
}

interface YandexResponse {
  features?: YandexFeature[];
  properties?: { ResponseMetaData?: { SearchResponse?: { found?: number } } };
}

export function parseYandexResponse(json: YandexResponse): { items: BusinessCandidate[]; found: number } {
  const items: BusinessCandidate[] = [];
  for (const f of json.features ?? []) {
    const meta = f.properties?.CompanyMetaData;
    if (!meta?.id || !(meta.name ?? f.properties?.name)) continue;
    const [lon, lat] = f.geometry?.coordinates ?? [];
    items.push({
      provider: "yandex",
      externalId: meta.id,
      name: (meta.name ?? f.properties?.name)!,
      categories: (meta.Categories ?? []).map((c) => c.name).filter((n): n is string => !!n),
      address: meta.address ?? f.properties?.description,
      lat,
      lon,
      websiteRaw: meta.url,
      phones: (meta.Phones ?? [])
        .filter((p) => !p.type || p.type === "phone")
        .map((p) => p.formatted)
        .filter((p): p is string => !!p),
      emails: [], // API не отдаёт email — берём только с сайта компании или из OSM
      socials: [],
      hours: meta.Hours?.text,
      sourceUrl: `https://yandex.ru/maps/org/${meta.id}/`,
    });
  }
  return { items, found: json.properties?.ResponseMetaData?.SearchResponse?.found ?? items.length };
}

// Бесплатный ключ — 500 запросов в сутки. Чтобы не тратить лимит впустую:
//  • страницы выдачи кешируются (повторный поиск и «Найти ещё» перечитывают те же страницы) —
//    длительность настраивается через YANDEX_PAGE_CACHE_MS (0 выключает кеш, см. leadsConfig);
//  • после ответа «Limit is exceeded» Яндекс не дёргаем до конца суток (по Москве) — сразу понятная ошибка;
//  • исчерпанный лимит и неверный ключ не повторяем — повтор только тратит запросы.
const pageCache = new Map<string, { at: number; value: ReturnType<typeof parseYandexResponse> }>();
let limitExceededUntil = 0;

export const YANDEX_LIMIT_MESSAGE =
  "исчерпан суточный лимит запросов к Яндексу (бесплатный ключ — 500 в сутки). Лимит сбросится завтра; расход виден в Кабинете разработчика";

/** Начало следующих суток по Москве (UTC+3), когда Яндекс обнуляет счётчик. */
function nextMoscowMidnight(now = Date.now()): number {
  const msk = new Date(now + 3 * 3600_000);
  msk.setUTCHours(24, 0, 0, 0);
  return msk.getTime() - 3 * 3600_000;
}

/** Для тестов: сбросить кеш и отметку исчерпанного лимита. */
export function resetYandexState() {
  pageCache.clear();
  limitExceededUntil = 0;
}

export async function searchYandex(params: { text: string; skip: number; results?: number }) {
  const apiKey = leadsConfig.yandexApiKey;
  if (!apiKey) throw new ProviderError("Яндекс API не настроен (YANDEX_PLACES_API_KEY)", "yandex");
  if (Date.now() < limitExceededUntil) throw new ProviderError(YANDEX_LIMIT_MESSAGE, "yandex");

  const url = new URL(leadsConfig.yandexApiUrl);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("text", params.text);
  url.searchParams.set("type", "biz");
  url.searchParams.set("lang", "ru_RU");
  url.searchParams.set("results", String(params.results ?? YANDEX_PAGE_SIZE));
  url.searchParams.set("skip", String(params.skip));

  const cacheKey = `${apiKey}|${params.text.toLowerCase()}|${params.skip}|${params.results ?? YANDEX_PAGE_SIZE}`;
  const cacheTtl = leadsConfig.yandexPageCacheMs;
  const cached = cacheTtl > 0 ? pageCache.get(cacheKey) : undefined;
  if (cached && Date.now() - cached.at < cacheTtl) return cached.value;

  // Повторяем только сбои сети и сервера (и 429 — «слишком часто»): отказ ключа и
  // исчерпанный суточный лимит повторять бессмысленно — это лишь тратит запросы.
  const attempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const json = await fetchJson<YandexResponse>(url.toString(), { timeoutMs: 15_000 });
      const value = parseYandexResponse(json);
      if (cacheTtl > 0) pageCache.set(cacheKey, { at: Date.now(), value });
      return value;
    } catch (err) {
      lastError = err;
      const status = err instanceof HttpError ? err.status : null;
      console.error(`Yandex search failed (attempt ${attempt}/${attempts}): ${redact((err as Error).message)}`);
      const retryable = status === null || status === 429 || status >= 500;
      if (!retryable || attempt === attempts) break;
      await new Promise((r) => setTimeout(r, leadsConfig.yandexRetryDelayMs * attempt));
    }
  }

  const detail = lastError instanceof Error ? lastError.message.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
  if (lastError instanceof HttpError && /limit is exceeded/i.test(detail)) {
    limitExceededUntil = nextMoscowMidnight();
    throw new ProviderError(YANDEX_LIMIT_MESSAGE, "yandex");
  }
  if (lastError instanceof HttpError && (lastError.status === 401 || lastError.status === 403)) {
    throw new ProviderError(`Яндекс отклонил ключ — он недействителен или не подключён к «API Поиска по организациям» (${detail})`, "yandex");
  }
  if (lastError instanceof HttpError && lastError.status === 429) {
    throw new ProviderError("Яндекс просит делать запросы реже — попробуй через минуту", "yandex");
  }
  const e = lastError as Error;
  throw new ProviderError(e.name === "TimeoutError" ? "Яндекс не ответил вовремя" : `ошибка Яндекса: ${e.message}`, "yandex");
}
