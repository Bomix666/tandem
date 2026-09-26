// Превращение ответов источников в LeadDraft и дополнение данных:
// Яндекс — основа, OSM — подтверждение и недостающие поля (соцсети, email,
// сайт), проверка сайта — email/соцсети/телефоны с сайта самой компании.

import { matchesNiche, type NicheSpec } from "./niches";
import {
  classifyUrl,
  distanceMeters,
  formatPhone,
  mergeSocials,
  nameSimilarity,
  normalizeAddress,
  normalizeName,
  normalizePhone,
  uniq,
} from "./normalize";
import type { BusinessCandidate, LeadDraft, SiteAudit, SocialLink } from "./types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function candidateToDraft(c: BusinessCandidate, ctx: { city: string; niche: NicheSpec }): LeadDraft {
  const draft: LeadDraft = {
    name: c.name.trim(),
    normName: normalizeName(c.name),
    city: ctx.city,
    niche: ctx.niche.label,
    category: c.categories[0],
    address: c.address,
    normAddress: c.address ? normalizeAddress(c.address, ctx.city) : undefined,
    lat: c.lat,
    lon: c.lon,
    websiteKind: "none",
    socials: [],
    phones: [],
    normPhones: [],
    emails: [],
    hours: c.hours,
    yandexId: c.provider === "yandex" ? c.externalId : undefined,
    osmId: c.provider === "osm" ? c.externalId : undefined,
    sources: [{ provider: c.provider, url: c.sourceUrl }],
    confirmedByOsm: false,
    chainSize: 1,
    nicheMatch: matchesNiche(ctx.niche, c.categories, c.name),
  };
  addWebsite(draft, c.websiteRaw);
  draft.socials = mergeSocials(draft.socials, c.socials);
  addPhones(draft, c.phones);
  addEmails(draft, c.emails);
  return draft;
}

/** «Сайт» из источника: собственный сайт, соцсеть вместо сайта или страница записи. */
function addWebsite(draft: LeadDraft, raw?: string) {
  if (!raw) return;
  for (const part of raw.split(/[;\s]+/).filter(Boolean)) {
    const c = classifyUrl(part);
    if (c.kind === "own" && !draft.website) {
      draft.website = c.url;
      draft.domain = c.domain;
      draft.websiteKind = "own";
    } else if (c.kind === "social") {
      // соцсеть, указанная как сайт, — первой в списке: на неё ссылается скоринг
      draft.socials = mergeSocials([c.social], draft.socials);
      if (draft.websiteKind === "none") draft.websiteKind = "social";
    } else if (c.kind === "booking") {
      draft.bookingPage ??= { name: c.name, url: c.url };
      if (draft.websiteKind !== "own") draft.websiteKind = "booking";
    }
  }
}

function addPhones(draft: LeadDraft, phones: string[]) {
  for (const p of phones) {
    const norm = normalizePhone(p);
    if (norm && !draft.normPhones.includes(norm)) {
      draft.normPhones.push(norm);
      draft.phones.push(formatPhone(norm));
    }
  }
}

function addEmails(draft: LeadDraft, emails: string[]) {
  draft.emails = uniq([...draft.emails, ...emails.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e))]).slice(0, 3);
}

function addSocials(draft: LeadDraft, socials: SocialLink[]) {
  draft.socials = mergeSocials(draft.socials, socials);
}

/** Ищет тот же бизнес в данных OSM: по домену, телефону или названию рядом. */
export function findOsmMatch(draft: LeadDraft, osm: BusinessCandidate[], used: Set<string>): BusinessCandidate | null {
  let best: { c: BusinessCandidate; score: number } | null = null;
  for (const c of osm) {
    if (used.has(c.externalId)) continue;
    const dist =
      draft.lat != null && draft.lon != null && c.lat != null && c.lon != null
        ? distanceMeters(draft.lat, draft.lon, c.lat, c.lon)
        : null;
    const sim = nameSimilarity(draft.name, c.name);
    const cDomain = c.websiteRaw ? classifyUrl(c.websiteRaw) : null;
    const phoneHit = c.phones.some((p) => {
      const n = normalizePhone(p);
      return n !== null && draft.normPhones.includes(n);
    });

    let score = 0;
    if (draft.domain && cDomain?.kind === "own" && cDomain.domain === draft.domain) score = 3;
    else if (phoneHit && (dist === null || dist <= 3000)) score = 2.5;
    else if (dist !== null && dist <= 250 && sim >= 0.5) score = 1 + sim;
    else if (dist !== null && dist <= 1500 && sim >= 0.85) score = sim;
    if (score > 0 && (!best || score > best.score)) best = { c, score };
  }
  return best?.c ?? null;
}

/** Дополняет лид данными из OSM: только недостающее, ничего не перезаписывает. */
export function enrichWithOsm(draft: LeadDraft, c: BusinessCandidate, city: string): void {
  draft.confirmedByOsm = true;
  draft.osmId ??= c.externalId;
  draft.sources.push({ provider: "osm", url: c.sourceUrl });
  if (draft.websiteKind !== "own") addWebsite(draft, c.websiteRaw);
  addSocials(draft, c.socials);
  addPhones(draft, c.phones);
  addEmails(draft, c.emails);
  draft.hours ??= c.hours;
  if (!draft.address && c.address) {
    draft.address = c.address;
    draft.normAddress = normalizeAddress(c.address, city);
  }
  if (draft.lat == null && c.lat != null) {
    draft.lat = c.lat;
    draft.lon = c.lon;
  }
  draft.category ??= c.categories[0];
}

/** Результат проверки сайта + контакты компании с её сайта. */
export function applyAudit(draft: LeadDraft, audit: SiteAudit): void {
  draft.audit = audit;
  if (audit.status !== "ok") return;
  addEmails(draft, audit.emails);
  addSocials(draft, audit.socials);
  addPhones(draft, audit.phones);
}

/**
 * Дубль: бизнес уже есть в базе. Берём существующий лид и дополняем его
 * недостающими данными из свежего поиска. Контакты объединяются, заполненные
 * поля не перезаписываются; проверка сайта берётся свежая, если она была.
 */
export function mergeDraftInto(base: LeadDraft, fresh: LeadDraft): LeadDraft {
  const m: LeadDraft = {
    ...base,
    sources: [...base.sources],
    socials: [...base.socials],
    phones: [...base.phones],
    normPhones: [...base.normPhones],
    emails: [...base.emails],
  };
  if (m.websiteKind !== "own" && fresh.websiteKind === "own") {
    m.websiteKind = "own";
    m.website = fresh.website;
    m.domain = fresh.domain;
  } else if (m.websiteKind === "none" && fresh.websiteKind !== "none") {
    m.websiteKind = fresh.websiteKind;
  }
  m.bookingPage ??= fresh.bookingPage;
  addSocials(m, fresh.socials);
  addPhones(m, fresh.phones);
  addEmails(m, fresh.emails);
  m.hours ??= fresh.hours;
  m.category ??= fresh.category;
  if (!m.address && fresh.address) {
    m.address = fresh.address;
    m.normAddress = fresh.normAddress;
  }
  if (m.lat == null && fresh.lat != null) {
    m.lat = fresh.lat;
    m.lon = fresh.lon;
  }
  m.yandexId ??= fresh.yandexId;
  m.osmId ??= fresh.osmId;
  for (const s of fresh.sources) if (!m.sources.some((x) => x.provider === s.provider)) m.sources.push(s);
  m.confirmedByOsm = base.confirmedByOsm || fresh.confirmedByOsm;
  m.nicheMatch = base.nicheMatch || fresh.nicheMatch;
  m.chainSize = fresh.chainSize;
  m.audit = fresh.audit ?? base.audit;
  return m;
}

/** Сколько точек с тем же названием в выдаче — признак сети. */
export function applyChainSizes(drafts: LeadDraft[], allNames: string[]): void {
  const counts = new Map<string, number>();
  for (const n of allNames) counts.set(n, (counts.get(n) ?? 0) + 1);
  for (const d of drafts) d.chainSize = Math.max(1, counts.get(d.normName) ?? 1);
}
