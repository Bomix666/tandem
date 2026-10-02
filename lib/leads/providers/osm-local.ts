// OpenStreetMap — основной источник бизнесов: поиск по локальной копии
// (таблица OsmPlace, наполняется scripts/osm-import.ts). Публичный Overpass —
// только запасной путь, пока локальная копия ещё ни разу не загружена.

import { prisma } from "../../prisma";
import type { NicheSpec } from "../niches";
import { resolveArea } from "../osm/areas";
import { pointInArea } from "../osm/geo";
import { KIND_KEYS, kindsForWords, osmToCandidate } from "../osm/tags";
import type { BusinessCandidate } from "../types";
import { searchOsm, type OsmOptions } from "./osm";

/** Сколько точек максимум отдаём в конвейер (дальше всё равно не проверить за один поиск). */
const MAX_PLACES = 3000;

export interface OsmSearchResult {
  items: BusinessCandidate[];
  note?: string;
}

interface Sql {
  where: string;
  params: unknown[];
}

const KIND_KEY_SET = new Set(KIND_KEYS);

/**
 * Фильтр ниши в формате Overpass (`["shop"="hairdresser"]["male"="yes"]`) → SQL.
 * Условия внутри фильтра — И, фильтры между собой — ИЛИ.
 */
export function nicheToSql(niche: NicheSpec, firstParam: number): Sql | null {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${firstParam + params.length - 1}`;
  };

  if (niche.key === "custom") {
    if (!niche.keywords.length) return null;
    const ors = [`"name" ILIKE ANY(${p(niche.keywords.map((k) => `%${k}%`))}::text[])`];
    const kinds = kindsForWords(niche.keywords);
    if (kinds.length) ors.push(`"kinds" && ${p(kinds)}::text[]`);
    return { where: `(${ors.join(" OR ")})`, params };
  }

  const ors: string[] = [];
  for (const filter of niche.osmFilters) {
    const ands: string[] = [];
    for (const m of filter.matchAll(/\["([^"]+)"(?:(=|~)"([^"]*)"(,i)?)?\]/g)) {
      const [, key, op, value] = m as unknown as [string, string, string | undefined, string | undefined];
      if (!op) ands.push(`"tags" ? ${p(key)}`);
      else if (op === "=" && KIND_KEY_SET.has(key)) ands.push(`"kinds" @> ARRAY[${p(`${key}=${value}`)}]::text[]`);
      else if (op === "=") ands.push(`"tags"->>${p(key)} = ${p(value)}`);
      else if (key === "name") ands.push(`"name" ~* ${p(value)}`);
      else ands.push(`"tags"->>${p(key)} ~* ${p(value)}`);
    }
    if (ands.length) ors.push(`(${ands.join(" AND ")})`);
  }
  return ors.length ? { where: `(${ors.join(" OR ")})`, params } : null;
}

let readyAt = 0;
/** Есть ли хотя бы один завершённый импорт (результат «да» кешируем — он уже не изменится). */
export async function osmLocalReady(): Promise<boolean> {
  if (readyAt) return true;
  const done = await prisma.osmImport.findFirst({ where: { status: "DONE" }, select: { id: true } });
  if (done) readyAt = Date.now();
  return !!done;
}

export function resetOsmLocalState() {
  readyAt = 0;
}

interface PlaceRow {
  id: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
}

export async function searchOsmLocal(niche: NicheSpec, city: string): Promise<BusinessCandidate[]> {
  const area = await resolveArea(city);
  const [south, west, north, east] = area.bbox;
  const nicheSql = nicheToSql(niche, 5);
  if (!nicheSql) return [];
  const rows = await prisma.$queryRawUnsafe<PlaceRow[]>(
    `SELECT "id", "lat", "lon", "tags" FROM "OsmPlace"
     WHERE "lat" BETWEEN $1 AND $2 AND "lon" BETWEEN $3 AND $4 AND ${nicheSql.where}
     ORDER BY "hasContact" DESC, "id"
     LIMIT ${MAX_PLACES * 2}`,
    south,
    north,
    west,
    east,
    ...nicheSql.params
  );
  // прямоугольник города захватывает соседей (у Москвы — пол-области): режем по контуру
  const inside = area.geometry ? rows.filter((r) => pointInArea(r.lat, r.lon, area.geometry!)) : rows;
  // стабильный порядок — чтобы «Найти ещё» шло дальше по тому же списку
  return inside.slice(0, MAX_PLACES).map((r) => osmToCandidate(r.id, r.lat, r.lon, r.tags));
}

/** Состояние локальной копии — для «⚙️ Настройки». */
export async function osmLocalStatus(): Promise<string> {
  const done = await prisma.osmImport.findFirst({ where: { status: "DONE" }, orderBy: { finishedAt: "desc" } });
  if (done) {
    const date = (done.sourceDate ?? done.finishedAt ?? done.startedAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" });
    return `локальная копия от ${date}, ${done.places.toLocaleString("ru-RU")} бизнесов`;
  }
  const running = await prisma.osmImport.findFirst({ where: { status: "RUNNING" } });
  return running ? "локальная копия загружается — пока поиск через публичные серверы OSM" : "локальная копия не загружена — поиск через публичные серверы OSM";
}

/** Поиск по OSM: локальная копия, а пока её нет — публичный Overpass с пометкой. */
export async function searchOsmBest(niche: NicheSpec, city: string, opts: OsmOptions = {}): Promise<OsmSearchResult> {
  if (await osmLocalReady()) return { items: await searchOsmLocal(niche, city) };
  const items = await searchOsm(niche, city, opts);
  return {
    items,
    note: "ℹ️ Локальная копия OpenStreetMap ещё загружается — искал через публичные серверы OSM (медленнее, выдача может быть неполной).",
  };
}
