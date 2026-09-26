// OpenStreetMap — дополнительная проверка и дополнение данных (ключ не нужен).
// Nominatim — границы города, Overpass — бизнесы нужной ниши в этих границах.
// Правила использования: не чаще 1 запроса в секунду к Nominatim и понятный
// User-Agent — поэтому город кешируем, а запросов на поиск делаем по одному.

import { leadsConfig } from "../config";
import { fetchJson, HttpError } from "../http";
import type { NicheSpec } from "../niches";
import { escapeRegExp, socialFromHandle, uniq } from "../normalize";
import type { BusinessCandidate, SocialLink, SocialType } from "../types";
import { ProviderError } from "./yandex";

export type BBox = [south: number, west: number, north: number, east: number];

const cityCache = new Map<string, BBox>();

export async function geocodeCity(city: string): Promise<BBox> {
  const key = city.trim().toLowerCase();
  const cached = cityCache.get(key);
  if (cached) return cached;

  const url = new URL(`${leadsConfig.nominatimUrl}/search`);
  url.searchParams.set("q", city);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("featureType", "settlement");
  url.searchParams.set("accept-language", "ru");

  let rows: { boundingbox?: string[] }[];
  try {
    rows = await fetchJson(url.toString(), { timeoutMs: 15_000, headers: { "User-Agent": leadsConfig.userAgent } });
  } catch (err) {
    const why = err instanceof HttpError ? `HTTP ${err.status}` : (err as Error).name === "TimeoutError" ? "не ответил вовремя" : "нет соединения";
    throw new ProviderError(`OpenStreetMap: не удалось определить границы города (${why})`, "osm");
  }
  const bb = rows[0]?.boundingbox?.map(Number);
  if (!bb || bb.length !== 4 || bb.some((n) => Number.isNaN(n))) {
    throw new ProviderError(`OSM: город «${city}» не найден`, "osm");
  }
  const bbox: BBox = [bb[0]!, bb[2]!, bb[1]!, bb[3]!]; // Nominatim: [south, north, west, east]
  cityCache.set(key, bbox);
  return bbox;
}

// Ключи OSM, которыми отмечают заведения. Поиск по названию ограничиваем ими:
// регулярка по всем именованным объектам большого города (улицы, дома)
// не укладывается в таймаут Overpass.
const POI_KEYS = ["shop", "amenity", "craft", "office", "leisure", "healthcare"];

export function buildOverpassQuery(niche: NicheSpec, bbox: BBox, limit = 1500): string {
  const box = bbox.join(",");
  let parts: string[];
  if (niche.key === "custom") {
    const nameRe = niche.keywords.map(escapeRegExp).join("|").replace(/"/g, "");
    parts = nameRe ? POI_KEYS.map((k) => `nwr["${k}"]["name"~"${nameRe}",i](${box});`) : [];
  } else {
    parts = niche.osmFilters.map((f) => `nwr${f}["name"](${box});`);
  }
  return `[out:json][timeout:60];(${parts.join("")});out center tags ${limit};`;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const CATEGORY_RU: Record<string, string> = {
  hairdresser: "Парикмахерская",
  beauty: "Салон красоты",
  dentist: "Стоматология",
  car_repair: "Автосервис",
  cafe: "Кафе",
  fitness_centre: "Фитнес-центр",
  florist: "Цветочный магазин",
  mobile_phone: "Салон связи",
  electronics_repair: "Ремонт электроники",
};

const SOCIAL_TAGS: [string[], SocialType][] = [
  [["contact:instagram", "instagram"], "instagram"],
  [["contact:vk", "vk"], "vk"],
  [["contact:telegram", "telegram"], "telegram"],
  [["contact:whatsapp", "whatsapp"], "whatsapp"],
  [["contact:ok", "ok"], "ok"],
  [["contact:facebook", "facebook"], "facebook"],
];

const splitMulti = (v?: string) => (v ?? "").split(";").map((s) => s.trim()).filter(Boolean);

export function parseOverpass(json: { elements?: OverpassElement[] }): BusinessCandidate[] {
  const out: BusinessCandidate[] = [];
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    if (!t.name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;

    const socials: SocialLink[] = [];
    for (const [keys, type] of SOCIAL_TAGS) {
      const value = keys.map((k) => t[k]).find(Boolean);
      const s = value ? socialFromHandle(type, value) : null;
      if (s) socials.push(s);
    }

    const street = t["addr:street"];
    const house = t["addr:housenumber"];
    const kindTag = t.shop ?? t.amenity ?? t.craft ?? t.leisure ?? t.healthcare;
    // мужская парикмахерская в OSM: shop=hairdresser + hairdresser=barber или male=yes
    const isBarber = t.shop === "hairdresser" && (t.hairdresser === "barber" || t.male === "yes");

    out.push({
      provider: "osm",
      externalId: `${el.type}/${el.id}`,
      name: t.name,
      categories: isBarber ? ["Барбершоп"] : kindTag ? [CATEGORY_RU[kindTag] ?? kindTag] : [],
      address: street ? [street, house].filter(Boolean).join(", ") : undefined,
      lat,
      lon,
      websiteRaw: t["contact:website"] ?? t.website ?? t.url,
      phones: uniq([...splitMulti(t["contact:phone"]), ...splitMulti(t.phone), ...splitMulti(t["contact:mobile"])]),
      emails: uniq([...splitMulti(t["contact:email"]), ...splitMulti(t.email)]).map((e) => e.toLowerCase()),
      socials,
      hours: t.opening_hours,
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    });
  }
  // стабильный порядок — чтобы «Найти ещё» в режиме только OSM шло дальше по списку
  return out.sort((a, b) => a.externalId.localeCompare(b.externalId));
}

export async function searchOsm(niche: NicheSpec, city: string): Promise<BusinessCandidate[]> {
  if (niche.key === "custom" ? !niche.keywords.length : !niche.osmFilters.length) return [];
  const bbox = await geocodeCity(city);
  const body = new URLSearchParams({ data: buildOverpassQuery(niche, bbox) }).toString();
  const errors: string[] = [];
  // Публичные серверы Overpass часто перегружены — пробуем по очереди.
  for (const url of leadsConfig.overpassUrls) {
    try {
      const json = await fetchJson<{ elements?: OverpassElement[] }>(url, {
        method: "POST",
        timeoutMs: 45_000, // крупный город отдаётся за ~30 с; перегруженные зеркала обычно падают с 504 быстро
        headers: { "User-Agent": leadsConfig.userAgent, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      return parseOverpass(json);
    } catch (err) {
      const e = err as Error;
      const why = err instanceof HttpError ? `HTTP ${err.status}` : e.name === "TimeoutError" ? "не ответил вовремя" : "нет соединения";
      errors.push(`${new URL(url).host}: ${why}`);
    }
  }
  throw new ProviderError(`серверы OpenStreetMap не отвечают (${errors.join("; ")})`, "osm");
}
