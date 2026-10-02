// Общие правила для данных OpenStreetMap: что считается бизнесом, какие теги
// храним и как объект OSM превращается в кандидата в лиды. Используется и
// импортом локальной копии (scripts/osm-import.ts), и живым Overpass.

import { socialFromHandle, uniq } from "../normalize";
import type { BusinessCandidate, SocialLink, SocialType } from "../types";

/**
 * Бизнесы в OSM: любые магазины, мастерские, офисы и медицина, а из
 * amenity / leisure / tourism — только коммерческие заведения (не скамейки,
 * парковки и школы). Это же — фильтр для `osmium tags-filter`.
 */
const ANY_VALUE_KEYS = ["shop", "craft", "office", "healthcare"];
const EXCLUDED_VALUES: Record<string, string[]> = {
  shop: ["vacant", "no", "yes_vacant"],
  office: ["government", "diplomatic", "political_party", "religion", "association"],
};
const LISTED_VALUES: Record<string, string[]> = {
  amenity: [
    "dentist", "clinic", "doctors", "veterinary", "pharmacy",
    "cafe", "restaurant", "fast_food", "bar", "pub", "ice_cream", "food_court", "nightclub",
    "car_wash", "car_rental", "vehicle_inspection", "driving_school", "language_school", "music_school",
    "dancing_school", "training", "childcare", "kindergarten", "studio", "events_venue",
    "coworking_space", "bicycle_rental", "boat_rental", "internet_cafe",
  ],
  leisure: ["fitness_centre", "sports_centre", "dance", "sauna", "escape_game", "bowling_alley", "amusement_arcade", "trampoline_park", "horse_riding"],
  tourism: ["hotel", "guest_house", "hostel", "apartment", "motel"],
};

/** Выражения для `osmium tags-filter` (с запасом — точная проверка в kindsOf). */
export function osmiumFilterExpressions(): string[] {
  return [
    ...ANY_VALUE_KEYS.map((k) => `nwr/${k}`),
    ...Object.entries(LISTED_VALUES).map(([k, values]) => `nwr/${k}=${values.join(",")}`),
  ];
}

/** «Виды» объекта: ["shop=hairdresser", "amenity=dentist"]. Пусто — не бизнес. */
export function kindsOf(tags: Record<string, string>): string[] {
  const kinds: string[] = [];
  for (const key of ANY_VALUE_KEYS) {
    const v = tags[key];
    if (v && !EXCLUDED_VALUES[key]?.includes(v)) kinds.push(`${key}=${v}`);
  }
  for (const [key, values] of Object.entries(LISTED_VALUES)) {
    const v = tags[key];
    if (v && values.includes(v)) kinds.push(`${key}=${v}`);
  }
  return kinds;
}

// Храним только нужное: адрес, контакты, часы и уточнения ниши (не всю простыню тегов).
const KEEP_EXACT = new Set([
  "name", "brand", "operator", "shop", "craft", "office", "healthcare", "amenity", "leisure", "tourism",
  "hairdresser", "male", "female", "cuisine", "beauty", "repair", "opening_hours",
  "phone", "mobile", "website", "url", "email", "instagram", "vk", "telegram", "whatsapp", "facebook",
]);
export function keepTags(tags: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tags)) {
    if (KEEP_EXACT.has(k) || k.startsWith("addr:") || k.startsWith("contact:") || k.startsWith("healthcare:")) out[k] = v;
  }
  return out;
}

const CATEGORY_RU: Record<string, string> = {
  hairdresser: "Парикмахерская",
  beauty: "Салон красоты",
  cosmetics: "Косметика",
  massage: "Массаж",
  tattoo: "Тату-салон",
  dentist: "Стоматология",
  clinic: "Клиника",
  doctors: "Медицинский центр",
  veterinary: "Ветклиника",
  car_repair: "Автосервис",
  tyres: "Шиномонтаж",
  car_wash: "Автомойка",
  cafe: "Кафе",
  restaurant: "Ресторан",
  fast_food: "Фастфуд",
  bar: "Бар",
  fitness_centre: "Фитнес-центр",
  sports_centre: "Спортивный центр",
  florist: "Цветочный магазин",
  mobile_phone: "Салон связи",
  electronics_repair: "Ремонт электроники",
  driving_school: "Автошкола",
  language_school: "Языковая школа",
  hotel: "Гостиница",
  guest_house: "Гостевой дом",
  hostel: "Хостел",
  bakery: "Пекарня",
  pet: "Зоомагазин",
};

/** Ключи OSM, которые хранятся в OsmPlace.kinds как "ключ=значение". */
export const KIND_KEYS = [...ANY_VALUE_KEYS, ...Object.keys(LISTED_VALUES)];

/**
 * Виды OSM, чьё русское название содержит одно из слов: «автомой» → car_wash.
 * Для «своей ниши» — чтобы находить и заведения без слова в названии.
 */
export function kindsForWords(stems: string[]): string[] {
  const values = Object.entries(CATEGORY_RU)
    .filter(([, label]) => stems.some((s) => label.toLowerCase().replace(/ё/g, "е").includes(s)))
    .map(([value]) => value);
  return values.flatMap((v) => KIND_KEYS.map((k) => `${k}=${v}`));
}

const SOCIAL_TAGS: [string[], SocialType][] = [
  [["contact:instagram", "instagram"], "instagram"],
  [["contact:vk", "vk"], "vk"],
  [["contact:telegram", "telegram"], "telegram"],
  [["contact:whatsapp", "whatsapp"], "whatsapp"],
  [["contact:ok", "ok"], "ok"],
  [["contact:facebook", "facebook"], "facebook"],
];

const splitMulti = (v?: string) => (v ?? "").split(";").map((s) => s.trim()).filter(Boolean);

export function osmPhones(t: Record<string, string>): string[] {
  return uniq([...splitMulti(t["contact:phone"]), ...splitMulti(t.phone), ...splitMulti(t["contact:mobile"]), ...splitMulti(t.mobile)]);
}
export function osmEmails(t: Record<string, string>): string[] {
  return uniq([...splitMulti(t["contact:email"]), ...splitMulti(t.email)]).map((e) => e.toLowerCase());
}
export function osmWebsite(t: Record<string, string>): string | undefined {
  return t["contact:website"] ?? t.website ?? t.url;
}

export function osmCategory(t: Record<string, string>): string | undefined {
  // мужская парикмахерская в OSM: shop=hairdresser + hairdresser=barber или male=yes
  if (t.shop === "hairdresser" && (t.hairdresser === "barber" || t.male === "yes")) return "Барбершоп";
  const kindTag = t.shop ?? t.amenity ?? t.craft ?? t.leisure ?? t.healthcare ?? t.tourism ?? t.office;
  return kindTag ? CATEGORY_RU[kindTag] ?? kindTag : undefined;
}

/** Объект OSM (тип/id/координаты/теги) → кандидат в лиды. */
export function osmToCandidate(id: string, lat: number | undefined, lon: number | undefined, t: Record<string, string>): BusinessCandidate {
  const socials: SocialLink[] = [];
  for (const [keys, type] of SOCIAL_TAGS) {
    const value = keys.map((k) => t[k]).find(Boolean);
    const s = value ? socialFromHandle(type, value) : null;
    if (s) socials.push(s);
  }
  const street = t["addr:street"];
  const house = t["addr:housenumber"];
  const category = osmCategory(t);
  return {
    provider: "osm",
    externalId: id,
    name: t.name ?? "",
    categories: category ? [category] : [],
    address: street ? [street, house].filter(Boolean).join(", ") : undefined,
    lat,
    lon,
    websiteRaw: osmWebsite(t),
    phones: osmPhones(t),
    emails: osmEmails(t),
    socials,
    hours: t.opening_hours,
    sourceUrl: `https://www.openstreetmap.org/${id}`,
  };
}

// ---------- разбор выгрузки `osmium export -f geojsonseq` ----------

export interface OsmPlaceRow {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kinds: string[];
  tags: Record<string, string>;
  phone: string | null;
  website: string | null;
  email: string | null;
  hasContact: boolean;
}

/**
 * id из `--add-unique-id=type_id`: n123 / w123 / r123, а у площадных объектов
 * a<N>: чётное N — линия way N/2, нечётное — отношение (N-1)/2.
 */
export function osmIdFromUnique(uid: string): string | null {
  const m = /^([nwra])(\d+)$/.exec(uid);
  if (!m) return null;
  const n = Number(m[2]);
  switch (m[1]) {
    case "n":
      return `node/${n}`;
    case "w":
      return `way/${n}`;
    case "r":
      return `relation/${n}`;
    default:
      return n % 2 === 0 ? `way/${n / 2}` : `relation/${(n - 1) / 2}`;
  }
}

type Position = [number, number];
interface Geometry {
  type: string;
  coordinates: unknown;
}

/** Центр объекта: точка как есть, у полигона — среднее внешнего контура. */
export function centroid(g: Geometry): [lat: number, lon: number] | null {
  let ring: Position[] | null = null;
  if (g.type === "Point") {
    const [lon, lat] = g.coordinates as Position;
    return [lat, lon];
  }
  if (g.type === "LineString") ring = g.coordinates as Position[];
  if (g.type === "Polygon") ring = (g.coordinates as Position[][])[0] ?? null;
  if (g.type === "MultiPolygon") ring = (g.coordinates as Position[][][])[0]?.[0] ?? null;
  if (!ring?.length) return null;
  let lat = 0;
  let lon = 0;
  for (const [x, y] of ring) {
    lon += x;
    lat += y;
  }
  return [lat / ring.length, lon / ring.length];
}

/** Строка geojsonseq → строка таблицы OsmPlace (или null, если это не бизнес). */
export function featureToPlace(line: string): OsmPlaceRow | null {
  const clean = line.replace(/^\x1e/, "").trim();
  if (!clean) return null;
  let f: { id?: string; geometry?: Geometry; properties?: Record<string, unknown> };
  try {
    f = JSON.parse(clean);
  } catch {
    return null;
  }
  const raw = f.properties ?? {};
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") tags[k] = v;
  const name = tags.name?.trim();
  if (!name) return null;
  const kinds = kindsOf(tags);
  if (!kinds.length) return null;
  const id = f.id ? osmIdFromUnique(String(f.id)) : null;
  const center = f.geometry ? centroid(f.geometry) : null;
  if (!id || !center) return null;

  const kept = keepTags(tags);
  const phone = osmPhones(kept)[0] ?? null;
  const website = osmWebsite(kept) ?? null;
  const email = osmEmails(kept)[0] ?? null;
  const hasSocial = SOCIAL_TAGS.some(([keys]) => keys.some((k) => kept[k]));
  return {
    id,
    name,
    lat: center[0],
    lon: center[1],
    kinds,
    tags: kept,
    phone,
    website,
    email,
    hasContact: !!(phone || website || email || hasSocial),
  };
}
