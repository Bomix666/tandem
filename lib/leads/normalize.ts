// Нормализация данных о бизнесах: названия, телефоны, адреса, ссылки.
// Нужна для поиска дублей и для того, чтобы отличать собственный сайт
// от соцсети или страницы онлайн-записи.

import type { SocialLink, SocialType } from "./types";

const LEGAL_FORMS = new Set(["ооо", "ип", "оао", "зао", "пао", "ао", "нко", "llc", "ltd", "inc"]);

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t && !LEGAL_FORMS.has(t))
    .join(" ");
}

/** Телефон → только цифры в формате 7XXXXXXXXXX (для РФ) или null, если это не телефон. */
export function normalizePhone(raw: string): string | null {
  const main = raw.split(/доб|ext|[,;]/i)[0] ?? "";
  const d = main.replace(/\D/g, "");
  if (d.length === 11 && (d.startsWith("7") || d.startsWith("8"))) return `7${d.slice(1)}`;
  if (d.length === 10) return `7${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

export function formatPhone(norm: string): string {
  if (norm.length === 11 && norm.startsWith("7")) {
    return `+7 ${norm.slice(1, 4)} ${norm.slice(4, 7)}-${norm.slice(7, 9)}-${norm.slice(9, 11)}`;
  }
  return `+${norm}`;
}

const ADDRESS_ABBR: [RegExp, string][] = [
  [/улица/g, "ул"],
  [/проспект/g, "пр"],
  [/переулок/g, "пер"],
  [/шоссе/g, "ш"],
  [/бульвар/g, "б"],
  [/площадь/g, "пл"],
  [/набережная/g, "наб"],
  [/проезд/g, "прд"],
  [/строение/g, "стр"],
  [/корпус/g, "к"],
];
const ADDRESS_NOISE = new Set(["россия", "г", "город", "д", "дом"]);

/**
 * Адрес → набор токенов в алфавитном порядке: «Тверская улица, 7» и
 * «ул. Тверская, д. 7» дают одно и то же. Город выбрасывается, чтобы адрес
 * из Яндекса («Россия, Москва, …») совпадал с адресом из OSM («…, 7»).
 */
export function normalizeAddress(address: string, city?: string): string {
  let s = address.toLowerCase().replace(/ё/g, "е");
  if (city) s = s.split(normalizeCity(city)).join(" ");
  for (const [re, abbr] of ADDRESS_ABBR) s = s.replace(re, abbr);
  return s
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t && !ADDRESS_NOISE.has(t))
    .sort()
    .join(" ");
}

export function normalizeCity(city: string): string {
  return city.trim().toLowerCase().replace(/ё/g, "е");
}

/** Относится ли адрес к городу (по вхождению названия города). */
export function addressInCity(address: string, city: string): boolean {
  return address.toLowerCase().replace(/ё/g, "е").includes(normalizeCity(city));
}

export function toAbsoluteUrl(raw: string): URL | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith("//")) s = `https:${s}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `http://${s}`;
  try {
    const url = new URL(s);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url;
  } catch {
    return null;
  }
}

export function extractDomain(url: string): string | null {
  const u = toAbsoluteUrl(url);
  return u ? u.hostname.toLowerCase().replace(/^www\./, "") : null;
}

const SOCIAL_HOSTS: [RegExp, SocialType][] = [
  [/(^|\.)instagram\.com$|(^|\.)instagr\.am$/, "instagram"],
  [/(^|\.)vk\.com$|(^|\.)vk\.ru$|(^|\.)vkontakte\.ru$/, "vk"],
  [/(^|\.)t\.me$|(^|\.)telegram\.me$|(^|\.)telegram\.dog$/, "telegram"],
  [/(^|\.)wa\.me$|(^|\.)whatsapp\.com$/, "whatsapp"],
  [/(^|\.)ok\.ru$/, "ok"],
  [/(^|\.)facebook\.com$|(^|\.)fb\.com$/, "facebook"],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, "youtube"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)dzen\.ru$|^zen\.yandex\.ru$/, "dzen"],
  [/(^|\.)taplink\.(cc|ru|at|me)$|(^|\.)linktr\.ee$/, "taplink"],
];

const BOOKING_HOSTS: [RegExp, string][] = [
  [/(^|\.)yclients\.com$/, "YCLIENTS"],
  [/(^|\.)dikidi\.(net|ru)$/, "DIKIDI"],
  [/(^|\.)altegio\.com$/, "Altegio"],
  [/(^|\.)booksy\.com$/, "Booksy"],
  [/(^|\.)sonline\.su$/, "Sonline"],
];

// Хостинги, где разные бизнесы живут на одном домене и различаются путём
// (sites.google.com/view/<сайт>) — для поиска дублей ключом служит домен + первый сегмент пути.
const SHARED_SITE_HOSTS = new Set(["sites.google.com"]);

// Карточки в справочниках — не собственный сайт и не соцсеть.
const DIRECTORY_HOSTS = /(^|\.)(yandex\.(ru|com)|2gis\.(ru|com|biz)|google\.[a-z.]+|zoon\.ru|yell\.ru|flamp\.ru|avito\.ru)$/;
const SHARE_PATHS = /\/(share|sharer|share\.php|intent)(\/|$|\?)/i;

export type UrlClass =
  | { kind: "own"; url: string; domain: string }
  | { kind: "social"; social: SocialLink }
  | { kind: "booking"; name: string; url: string }
  | { kind: "ignore" };

/** Определяет, что на самом деле указано как «сайт»: собственный сайт, соцсеть, страница записи или справочник. */
export function classifyUrl(raw: string): UrlClass {
  const url = toAbsoluteUrl(raw);
  if (!url) return { kind: "ignore" };
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (SHARE_PATHS.test(url.pathname)) return { kind: "ignore" };

  for (const [re, type] of SOCIAL_HOSTS) {
    if (re.test(host)) {
      // Ссылка на главную соцсети без аккаунта ничего не говорит о бизнесе.
      if (url.pathname.replace(/\/+$/, "") === "") return { kind: "ignore" };
      // единый вид ссылки: www.instagram.com и m.vk.com → instagram.com, vk.com
      url.protocol = "https:";
      url.hostname = host;
      return { kind: "social", social: { type, url: url.toString() } };
    }
  }
  for (const [re, name] of BOOKING_HOSTS) {
    if (re.test(host)) return { kind: "booking", name, url: url.toString() };
  }
  if (DIRECTORY_HOSTS.test(host) && !SHARED_SITE_HOSTS.has(host)) return { kind: "ignore" };
  const segments = url.pathname.split("/").filter(Boolean);
  const domain = SHARED_SITE_HOSTS.has(host) && segments.length ? `${host}/${segments.slice(0, 2).join("/").toLowerCase()}` : host;
  return { kind: "own", url: url.toString(), domain };
}

/** Соцсеть из тега OSM: там бывает как полная ссылка, так и просто имя аккаунта. */
export function socialFromHandle(type: SocialType, value: string): SocialLink | null {
  const v = value.trim();
  if (!v) return null;
  if (/[./]/.test(v) && !v.startsWith("@")) {
    const c = classifyUrl(v);
    return c.kind === "social" ? c.social : null;
  }
  const handle = v.replace(/^@/, "");
  if (!/^[\w.]+$/.test(handle)) return null;
  const base: Partial<Record<SocialType, string>> = {
    instagram: "https://instagram.com/",
    vk: "https://vk.com/",
    telegram: "https://t.me/",
    ok: "https://ok.ru/",
    facebook: "https://facebook.com/",
    tiktok: "https://tiktok.com/@",
  };
  const prefix = base[type];
  return prefix ? { type, url: prefix + handle } : null;
}

export function mergeSocials(...lists: SocialLink[][]): SocialLink[] {
  const byType = new Map<SocialType, SocialLink>();
  for (const list of lists) for (const s of list) if (!byType.has(s.type)) byType.set(s.type, s);
  return [...byType.values()];
}

export function uniq<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/** Сходство названий 0..1 (коэффициент Дайса по биграммам). */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a).replace(/ /g, "");
  const y = normalizeName(b).replace(/ /g, "");
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const gx = grams(x);
  const gy = grams(y);
  let overlap = 0;
  for (const [g, n] of gx) overlap += Math.min(n, gy.get(g) ?? 0);
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

/** Расстояние между точками в метрах. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
