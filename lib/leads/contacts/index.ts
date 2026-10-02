// Email бизнеса: откуда взят, почему признан адресом компании, как проверен.
// Конвейер: адреса из источника (OSM) и с главной страницы → правила (policy)
// → для отобранных лидов — страницы «Контакты / О компании / Реквизиты»
// → проверка DNS (verify) → LeadContact в БД.

import { leadsConfig } from "../config";
import { decodeHtml, fetchPublicPage } from "../http";
import type { LeadDraft } from "../types";
import { extractEmails, fallbackContactPages } from "./extract";
import { classifyEmail } from "./policy";
import { defaultMxResolver, verifyEmail, type EmailCheck, type MxResolver } from "./verify";

export type ContactOrigin = "osm" | "yandex" | "site" | "manual";

export interface EmailContact {
  value: string;
  source: ContactOrigin;
  sourceUrl?: string;
  role: string; // info / sales / brand… — почему считаем адресом компании
  check?: EmailCheck;
  checkNote?: string;
  checkedAt?: string;
}

const CHECK_RANK: Record<EmailCheck | "none", number> = { VALID: 0, none: 1, UNVERIFIED: 2, INVALID: 3 };
const rank = (c: EmailContact) => CHECK_RANK[c.check ?? "none"] * 10 + (c.role === "brand" ? 1 : 0);

export function sortContacts(contacts: EmailContact[]): EmailContact[] {
  return [...contacts].sort((a, b) => rank(a) - rank(b));
}

/** Адреса, которыми можно пользоваться (без 🔴), лучшие первыми — кеш Lead.emails. */
export function usableEmails(contacts: EmailContact[]): string[] {
  return sortContacts(contacts)
    .filter((c) => c.check !== "INVALID")
    .map((c) => c.value)
    .slice(0, 3);
}

/** Лучшая оценка среди адресов лида: для счётчиков «с email» / «требуют проверки». */
export function bestCheck(contacts: EmailContact[] | undefined): EmailCheck | null {
  const best = sortContacts(contacts ?? [])[0];
  return best ? best.check ?? "UNVERIFIED" : null;
}

const siteDomainOf = (d: LeadDraft) => (d.websiteKind === "own" ? d.domain : undefined);

// Больше адресов у одного бизнеса в карточке не нужно (у сетей бывает по ящику на филиал).
const MAX_EMAILS = 6;

/** Пропускает адреса через правила и добавляет подходящие к лиду. Возвращает число отброшенных. */
export function addEmailContacts(draft: LeadDraft, emails: string[], source: ContactOrigin, sourceUrl?: string): number {
  draft.contacts ??= [];
  let skipped = 0;
  for (const raw of emails) {
    const decision = classifyEmail(raw, { name: draft.name, siteDomain: siteDomainOf(draft) });
    if (!decision.accept) {
      skipped++;
      continue;
    }
    if (draft.contacts.some((c) => c.value === decision.email) || draft.contacts.length >= MAX_EMAILS) continue;
    draft.contacts.push({ value: decision.email, source, sourceUrl, role: decision.role });
  }
  draft.emails = usableEmails(draft.contacts);
  return skipped;
}

/**
 * Сайт сменился (например, OSM дал сайт после Яндекса) — пересматриваем уже
 * принятые адреса: домен сайта влияет на правила.
 */
export function recheckContacts(draft: LeadDraft): void {
  if (!draft.contacts?.length) return;
  draft.contacts = draft.contacts.filter((c) => classifyEmail(c.value, { name: draft.name, siteDomain: siteDomainOf(draft) }).accept);
  draft.emails = usableEmails(draft.contacts);
}

export interface PageFetcher {
  (url: string): Promise<{ html: string; finalUrl: string } | null>;
}

export const defaultPageFetcher: PageFetcher = async (url) => {
  try {
    const page = await fetchPublicPage(url, {
      timeoutMs: 8_000,
      maxBytes: 1_000_000,
      userAgent: `Mozilla/5.0 (compatible; ${leadsConfig.userAgent})`,
      allowPrivate: leadsConfig.allowPrivateUrls,
    });
    if (page.status < 200 || page.status >= 300 || !/html|text\/plain|^$/i.test(page.contentType)) return null;
    return { html: decodeHtml(page.body, page.contentType), finalUrl: page.finalUrl };
  } catch {
    return null;
  }
};

export interface ContactDeps {
  fetchPage?: PageFetcher;
  resolveMx?: MxResolver;
  now?: Date;
}

const MAX_EXTRA_PAGES = 3;

/**
 * Для отобранного лида: ищет email на страницах контактов сайта (если на
 * главной не нашлось адреса на домене компании) и проверяет все адреса.
 */
export async function enrichContacts(draft: LeadDraft, deps: ContactDeps = {}): Promise<void> {
  const fetchPage = deps.fetchPage ?? defaultPageFetcher;
  const audit = draft.audit;
  const hasCompanyEmail = () => (draft.contacts ?? []).some((c) => c.source === "site" && !!draft.domain && c.value.endsWith(`@${draft.domain}`));

  if (draft.websiteKind === "own" && audit?.status === "ok" && audit.finalUrl && !hasCompanyEmail()) {
    const pages = audit.contactPages?.length ? audit.contactPages : fallbackContactPages(audit.finalUrl);
    const visited = new Set([audit.finalUrl]);
    for (const url of pages) {
      if (visited.size > MAX_EXTRA_PAGES || hasCompanyEmail()) break;
      if (visited.has(url)) continue;
      visited.add(url);
      const page = await fetchPage(url);
      if (page) addEmailContacts(draft, extractEmails(page.html), "site", page.finalUrl);
    }
  }

  const resolveMx = deps.resolveMx ?? defaultMxResolver;
  const checkedAt = (deps.now ?? new Date()).toISOString();
  for (const c of draft.contacts ?? []) {
    if (c.check) continue;
    const v = await verifyEmail(c.value, siteDomainOf(draft), resolveMx);
    c.check = v.check;
    c.checkNote = v.note;
    c.checkedAt = checkedAt;
  }
  if (draft.contacts) draft.emails = usableEmails(draft.contacts);
}
