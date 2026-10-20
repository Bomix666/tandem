// Проверка сайта бизнеса. Фиксирует только то, что видно в HTML главной
// страницы: адаптив (meta viewport), HTTPS, форма заявки / онлайн-запись,
// призыв к действию, год в копирайте, платформа, устаревшая вёрстка.
// С сайта берём контакты: все найденные email (какие из них адреса компании,
// решают правила в contacts/policy.ts), соцсети, телефоны из tel:-ссылок и
// ссылки на страницу контактов — там email ищется для отобранных лидов.

import { leadsConfig } from "./config";
import { extractEmails, findContactPages } from "./contacts/extract";
import { decodeHtml, fetchPublicPage, UnsafeUrlError } from "./http";
import { classifyUrl, normalizePhone, uniq, mergeSocials } from "./normalize";
import type { SiteAudit, SocialLink } from "./types";

const BOOKING_WIDGETS: [RegExp, string][] = [
  [/yclients\.com/i, "YCLIENTS"],
  [/dikidi\.(net|ru)/i, "DIKIDI"],
  [/altegio\.com/i, "Altegio"],
  [/sonline\.su/i, "Sonline"],
  [/booksy\.com/i, "Booksy"],
];

const PLATFORMS: [RegExp, string][] = [
  [/tildacdn\.com|tilda\.ws|data-tilda/i, "Tilda"],
  [/static\.wixstatic\.com|wix\.com/i, "Wix"],
  [/\/bitrix\/|bitrix24/i, "1С-Битрикс"],
  [/wp-content|wp-includes/i, "WordPress"],
  [/ucoz\.(ru|net|com)|\/\/s\d+\.ucoz/i, "uCoz"],
  [/narod\.ru|narod2/i, "Narod"],
  [/nethouse\.ru/i, "Nethouse"],
  [/flexbe/i, "Flexbe"],
  [/lpmotor/i, "LPmotor"],
  [/joomla/i, "Joomla"],
  [/insales/i, "InSales"],
  [/craftum/i, "Craftum"],
];
const LEGACY_PLATFORMS = new Set(["uCoz", "Narod"]);

const CTA_RE =
  /(записат|запись онлайн|онлайн-запис|оставить заявк|оставьте заявк|отправить заявк|заказать|забронир|позвонить|перезвон|получить консультац|рассчитать стоимост|купить)/i;

export type HtmlFacts = Omit<SiteAudit, "url" | "checkedAt" | "status" | "httpStatus" | "error">;

/** Разбор HTML главной страницы. Чистая функция — покрыта тестами. */
export function analyzeHtml(html: string, finalUrl: string, now = new Date()): HtmlFacts {
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");

  const hasViewport = /<meta[^>]+name\s*=\s*["']?viewport/i.test(html);
  const bookingWidget = BOOKING_WIDGETS.find(([re]) => re.test(html))?.[1] ?? null;
  const hasForm =
    /<form[\s>]/i.test(html) &&
    /type\s*=\s*["']?(tel|email)|<textarea|name\s*=\s*["']?[^"'>]*(phone|tel|name|email)/i.test(html);
  const hasTelLink = /href\s*=\s*["']?tel:/i.test(html);
  const hasCta = hasTelLink || CTA_RE.test(text);

  const platformFromMeta = html.match(/<meta[^>]+name\s*=\s*["']?generator["']?[^>]+content\s*=\s*["']([^"']+)/i)?.[1];
  const platform = PLATFORMS.find(([re]) => re.test(html))?.[1] ?? (platformFromMeta ? platformFromMeta.split(/[\s,]/)[0]! : null);

  const outdated: string[] = [];
  if (/<frameset|<frame\s/i.test(html)) outdated.push("фреймы (frameset)");
  if (/\.swf["'?]|x-shockwave-flash/i.test(html)) outdated.push("Flash");
  if (/<marquee/i.test(html)) outdated.push("бегущая строка <marquee>");
  if ((html.match(/<font[\s>]/gi) ?? []).length >= 3) outdated.push("теги <font>");
  if (platform && LEGACY_PLATFORMS.has(platform)) outdated.push(`платформа ${platform}`);

  return {
    finalUrl,
    https: finalUrl.startsWith("https:"),
    hasViewport,
    hasForm,
    bookingWidget,
    hasCta,
    copyrightYear: findCopyrightYear(text, now),
    platform,
    outdated,
    emails: extractEmails(html),
    contactPages: findContactPages(html, finalUrl),
    socials: extractSocials(html),
    phones: extractPhones(html),
    content: extractSiteContent(html),
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", mdash: "—", ndash: "–" };

function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
      if (ent[0] !== "#") return ENTITIES[ent.toLowerCase()] ?? m;
      const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : Number(ent.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Что бизнес сам пишет о себе на главной: заголовок, описание, подзаголовки и
 * начало текста. По этому пишется письмо под конкретный бизнес, а не шаблон.
 */
export function extractSiteContent(html: string): NonNullable<SiteAudit["content"]> {
  let description: string | undefined;
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/(?:name|property)\s*=\s*["']?(?:og:)?description["'\s>]/i.test(tag)) continue;
    const content = /content\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)?.[2];
    if (content && plainText(content)) {
      description = plainText(content).slice(0, 300);
      break;
    }
  }
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, " ");
  const headings = uniq([...body.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => plainText(m[1]!).slice(0, 120)).filter(Boolean)).slice(0, 8);
  return {
    title: plainText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").slice(0, 160) || undefined,
    description,
    headings,
    text: plainText(body.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ")).slice(0, 1500),
  };
}

export function findCopyrightYear(text: string, now = new Date()): number | null {
  const re = /(?:©|&copy;|&#169;|\(c\))[^<\n]{0,40}?((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi;
  let best: number | null = null;
  for (const m of text.matchAll(re)) {
    const years = [m[1], m[2]].filter(Boolean).map(Number);
    for (const y of years) if (y <= now.getFullYear() && (best === null || y > best)) best = y;
  }
  return best;
}

function extractSocials(html: string): SocialLink[] {
  const socials: SocialLink[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const c = classifyUrl(m[1]!);
    if (c.kind === "social") socials.push(c.social);
  }
  return mergeSocials(socials);
}

function extractPhones(html: string): string[] {
  const phones: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']?tel:([^"'>\s]+)/gi)) {
    const p = normalizePhone(decodeURIComponent(m[1]!));
    if (p) phones.push(p);
  }
  return uniq(phones).slice(0, 3);
}

/**
 * Ответ защиты от ботов (Cloudflare, DDoS-Guard, Qrator и т. п.): в браузере
 * сайт, скорее всего, открывается — значит, мы его просто не смогли проверить.
 */
export function isBotProtection(status: number, server: string): boolean {
  if (status === 401 || status === 403 || status === 429) return true;
  return status === 503 && /cloudflare|ddos-guard|qrator|variti|stormwall/i.test(server);
}

/** Понятная причина, почему сайт не открылся. */
export function unreachableReason(code: string): string {
  if (code === "timeout") return "не ответил за 10 с";
  if (/ENOTFOUND|EAI_AGAIN/.test(code)) return "домен не найден";
  if (/ECONNREFUSED|ECONNRESET/.test(code)) return "сервер не принимает подключения";
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return "ошибка SSL-сертификата";
  return "не открылся";
}

/** Загружает главную страницу и проверяет её. Ошибки не бросает — возвращает статус. */
export async function auditWebsite(url: string, now = new Date()): Promise<SiteAudit> {
  const base = { url, checkedAt: now.toISOString(), emails: [], socials: [], phones: [] };
  try {
    const page = await fetchPublicPage(url, {
      timeoutMs: 10_000,
      maxBytes: 1_500_000,
      userAgent: `Mozilla/5.0 (compatible; ${leadsConfig.userAgent})`,
      allowPrivate: leadsConfig.allowPrivateUrls,
    });
    if (isBotProtection(page.status, page.server)) {
      return { ...base, status: "blocked", httpStatus: page.status, finalUrl: page.finalUrl, error: `защита от ботов, HTTP ${page.status}` };
    }
    if (page.status < 200 || page.status >= 300) {
      return { ...base, status: "error_status", httpStatus: page.status, finalUrl: page.finalUrl };
    }
    const html = decodeHtml(page.body, page.contentType);
    return { ...base, status: "ok", httpStatus: page.status, ...analyzeHtml(html, page.finalUrl, now) };
  } catch (err) {
    if (err instanceof UnsafeUrlError) return { ...base, status: "blocked", error: "внутренний адрес — не проверяли" };
    // код ошибки бывает у самой ошибки (наша DNS-проверка) или в cause (fetch)
    const e = err as Error & { code?: string; cause?: { code?: string } };
    const code = e.name === "TimeoutError" || e.name === "AbortError" ? "timeout" : e.code ?? e.cause?.code ?? e.message;
    // «Не открывается» утверждаем только когда сайта точно нет (домен не найден,
    // сервер отказывает). Таймаут и ошибка сертификата бывают из-за нашей сети
    // (VPN, блокировка зарубежных адресов, сертификаты Минцифры) — в браузере
    // клиента сайт может работать, поэтому это «не удалось проверить».
    const certain = /ENOTFOUND|ECONNREFUSED/.test(code);
    return { ...base, status: certain ? "unreachable" : "blocked", error: unreachableReason(code) };
  }
}
