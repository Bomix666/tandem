// Яндекс «API Поиска по организациям» — основной источник бизнесов.
// Документация: https://yandex.ru/dev/geosearch/doc/ru/
// Ключ — YANDEX_PLACES_API_KEY в .env (Кабинет разработчика Яндекса).

import { leadsConfig } from "../config";
import { fetchJson, HttpError } from "../http";
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

export async function searchYandex(params: { text: string; skip: number; results?: number }) {
  const apiKey = leadsConfig.yandexApiKey;
  if (!apiKey) throw new ProviderError("Яндекс API не настроен (YANDEX_PLACES_API_KEY)", "yandex");

  const url = new URL(leadsConfig.yandexApiUrl);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("text", params.text);
  url.searchParams.set("type", "biz");
  url.searchParams.set("lang", "ru_RU");
  url.searchParams.set("results", String(params.results ?? YANDEX_PAGE_SIZE));
  url.searchParams.set("skip", String(params.skip));

  try {
    const json = await fetchJson<YandexResponse>(url.toString(), { timeoutMs: 15_000 });
    return parseYandexResponse(json);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      throw new ProviderError("ключ Яндекса недействителен или не подключён к «API Поиска по организациям»", "yandex");
    }
    if (err instanceof HttpError && err.status === 429) {
      throw new ProviderError("исчерпан лимит запросов к Яндексу", "yandex");
    }
    const e = err as Error;
    throw new ProviderError(e.name === "TimeoutError" ? "Яндекс не ответил вовремя" : `ошибка Яндекса: ${e.message}`, "yandex");
  }
}
