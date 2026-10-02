// Границы города или региона для поиска по локальной копии OSM. Определяются
// через Nominatim один раз на запрос пользователя и хранятся в OsmArea —
// любой город России работает сразу, без справочника.

import { prisma } from "../../prisma";
import { leadsConfig } from "../config";
import { fetchJson, HttpError } from "../http";
import { ProviderError } from "../providers/yandex";
import { isAreaGeometry, type AreaGeometry } from "./geo";

export interface SearchArea {
  key: string;
  name: string;
  kind: "city" | "region";
  bbox: [south: number, west: number, north: number, east: number];
  geometry: AreaGeometry | null;
}

export function areaKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^(г\.|город)\s*/, "")
    .replace(/\s+/g, " ");
}

interface NominatimRow {
  name?: string;
  display_name?: string;
  addresstype?: string;
  category?: string;
  boundingbox?: string[];
  geojson?: unknown;
}

const REGION_TYPES = new Set(["state", "region", "province", "county"]);
const memo = new Map<string, SearchArea>();

function pick(rows: NominatimRow[]): NominatimRow | undefined {
  // Nominatim сортирует по значимости; берём первый населённый пункт или регион,
  // а не улицу/магазин с похожим названием.
  return rows.find((r) => (r.category === "place" || r.category === "boundary") && r.boundingbox?.length === 4) ?? rows.find((r) => r.boundingbox?.length === 4);
}

export async function resolveArea(input: string): Promise<SearchArea> {
  const key = areaKey(input);
  if (!key) throw new ProviderError("Не указан город или регион", "osm");
  const cached = memo.get(key);
  if (cached) return cached;

  const stored = await prisma.osmArea.findUnique({ where: { key } });
  if (stored) {
    const area: SearchArea = {
      key,
      name: stored.name,
      kind: stored.kind === "region" ? "region" : "city",
      bbox: [stored.south, stored.west, stored.north, stored.east],
      geometry: isAreaGeometry(stored.geometry) ? stored.geometry : null,
    };
    memo.set(key, area);
    return area;
  }

  const url = new URL(`${leadsConfig.nominatimUrl}/search`);
  url.searchParams.set("q", input.trim());
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "ru");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("polygon_threshold", "0.002"); // упрощённый контур: ~200 м точности хватает
  url.searchParams.set("accept-language", "ru");

  let rows: NominatimRow[];
  try {
    rows = await fetchJson(url.toString(), { timeoutMs: 20_000, headers: { "User-Agent": leadsConfig.userAgent } });
  } catch (err) {
    const why = err instanceof HttpError ? `HTTP ${err.status}` : (err as Error).name === "TimeoutError" ? "не ответил вовремя" : "нет соединения";
    throw new ProviderError(`не удалось определить границы «${input.trim()}» (Nominatim: ${why})`, "osm");
  }
  const row = pick(Array.isArray(rows) ? rows : []);
  const bb = row?.boundingbox?.map(Number);
  if (!row || !bb || bb.some((n) => Number.isNaN(n))) {
    throw new ProviderError(`«${input.trim()}» не найден на карте России — проверь название города или региона`, "osm");
  }
  const area: SearchArea = {
    key,
    name: row.name || row.display_name?.split(",")[0] || input.trim(),
    kind: REGION_TYPES.has(row.addresstype ?? "") ? "region" : "city",
    bbox: [bb[0]!, bb[2]!, bb[1]!, bb[3]!], // Nominatim: [south, north, west, east]
    geometry: isAreaGeometry(row.geojson) ? row.geojson : null,
  };
  await prisma.osmArea.upsert({
    where: { key },
    create: {
      key,
      name: area.name,
      kind: area.kind,
      south: area.bbox[0],
      west: area.bbox[1],
      north: area.bbox[2],
      east: area.bbox[3],
      geometry: area.geometry ? (area.geometry as object) : undefined,
    },
    update: {},
  });
  memo.set(key, area);
  return area;
}

/** Для тестов: забыть закешированные в памяти области. */
export function resetAreaMemo() {
  memo.clear();
}
