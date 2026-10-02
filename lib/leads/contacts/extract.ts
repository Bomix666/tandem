// Поиск email и ссылок на страницу контактов в HTML сайта. Здесь — только
// «что написано на странице»; можно ли сохранять адрес, решает policy.ts.

const EMAIL_IN_TEXT = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
const ASSET_TAIL = /\.(png|jpe?g|gif|webp|svg|css|js|ico|woff2?)$/i;

/** Cloudflare «email protection»: hex-строка, первый байт — ключ XOR. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

export function cleanEmail(raw: string): string {
  let e = raw.trim();
  try {
    e = decodeURIComponent(e);
  } catch {
    /* оставляем как есть */
  }
  return e
    .toLowerCase()
    .replace(/^mailto:/, "")
    .split("?")[0]!
    .replace(/^(?:%[0-9a-f]{2})+/, "") // mailto:%20info@… — закодированный пробел перед адресом
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[.,;:]+$/, "");
}

/** Все email со страницы: mailto, текст, [at]/(dot)-маскировка, защита Cloudflare. */
export function extractEmails(html: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi)) {
    const e = decodeCfEmail(m[1]!);
    if (e) found.push(e);
  }
  for (const m of html.matchAll(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)) {
    const e = decodeCfEmail(m[1]!);
    if (e) found.push(e);
  }
  for (const m of html.matchAll(/mailto:\s*([^"'>\s]+)/gi)) found.push(m[1]!);

  // видимый текст (без тегов и атрибутов) — там адреса пишут и с маскировкой
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/&#46;|&period;/gi, ".")
    // info [at] site [dot] ru, info(собака)site.ru
    .replace(/\s*[[({]\s*(?:at|собака)\s*[\])}]\s*/gi, "@")
    .replace(/\s*[[({]\s*(?:dot|точка)\s*[\])}]\s*/gi, ".");
  for (const m of text.matchAll(EMAIL_IN_TEXT)) found.push(m[0]);
  // адреса в атрибутах/скриптах (например, в JSON-LD) — тоже; mailto и %-коды уже разобраны выше
  const attrs = html.replace(/mailto:\s*[^"'>\s]*/gi, " ").replace(/%[0-9a-f]{2}/gi, " ");
  for (const m of attrs.matchAll(EMAIL_IN_TEXT)) found.push(m[0]);

  const out = new Set<string>();
  for (const raw of found) {
    const e = cleanEmail(raw);
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/.test(e) || ASSET_TAIL.test(e)) continue;
    out.add(e);
  }
  return [...out];
}

const CONTACT_WORDS = /контакт|contact|о компании|о нас|about|реквизит|rekvizit|kontakt|связаться|как нас найти/i;
const CONTACT_PATHS = /\/(contacts?|kontakty?|kontakti)(\/|\.html?|\.php|$)/i;
const ABOUT_PATHS = /\/(about(-us)?|o-?(nas|kompanii)|rekvizity|requisites|company)(\/|\.html?|\.php|$)/i;

/** Ссылки на страницы контактов/«о компании»/реквизитов того же сайта. */
export function findContactPages(html: string, pageUrl: string, limit = 4): string[] {
  const base = new URL(pageUrl);
  const host = base.hostname.replace(/^www\./, "");
  const scored: { url: string; score: number }[] = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi)) {
    const href = /href\s*=\s*["']([^"'#]+)["']/i.exec(m[1]!)?.[1];
    if (!href || /^(mailto|tel|javascript):/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.hostname.replace(/^www\./, "") !== host) continue;
    url.hash = "";
    const label = m[2]!.replace(/<[^>]+>/g, " ");
    // «Контакты» важнее «О компании» и «Реквизитов»
    const score = (CONTACT_PATHS.test(url.pathname) ? 3 : ABOUT_PATHS.test(url.pathname) ? 2 : 0) + (CONTACT_WORDS.test(label) ? 1 : 0);
    if (score && url.href !== base.href) scored.push({ url: url.href, score });
  }
  const seen = new Set<string>();
  return scored
    .sort((a, b) => b.score - a.score)
    .map((s) => s.url)
    .filter((u) => !seen.has(u) && seen.add(u))
    .slice(0, limit);
}

/** Если ссылок на контакты не нашлось — пробуем типичные адреса. */
export function fallbackContactPages(pageUrl: string): string[] {
  const origin = new URL(pageUrl).origin;
  return ["/contacts", "/kontakty", "/contact", "/about"].map((p) => `${origin}${p}`);
}
