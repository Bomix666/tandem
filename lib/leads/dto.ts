// Лид/поиск из БД → данные для Mini App (types/leads.ts). JSON-поля
// разворачиваются в понятные структуры, внутренние поля (нормализация,
// ключи дублей) наружу не отдаются.

import type { Lead, LeadSearch } from "@prisma/client";
import type { LeadDTO, LeadSearchDTO, LeadSiteDTO } from "../../types/leads";
import { SOURCE_LABELS, siteIssues } from "./labels";
import { isModernSite, socialLabel } from "./scoring";
import { leadToDraft } from "./repository";
import type { ScoreReason, SiteAudit, SocialLink, SourceRef, WebsiteKind } from "./types";

type LeadWithTaskLinks = Lead & { tasks?: { task: { id: string; title: string; createdAt: Date } }[] };

function siteOf(lead: Lead): LeadSiteDTO {
  const audit = (lead.siteAudit as unknown as SiteAudit | null) ?? null;
  const own = lead.websiteKind === "own";
  return {
    kind: lead.websiteKind as WebsiteKind,
    url: lead.website,
    domain: lead.domain,
    booking: (lead.bookingPage as { name: string; url: string } | null) ?? null,
    check: own && audit ? audit.status : null,
    issues: own ? siteIssues(audit) : [],
    modern: own && isModernSite(leadToDraft(lead)),
    note: own && audit && audit.status !== "ok" ? audit.error ?? (audit.httpStatus ? `HTTP ${audit.httpStatus}` : null) : null,
    platform: own && audit?.status === "ok" ? audit.platform ?? null : null,
  };
}

export function toLeadDTO(lead: LeadWithTaskLinks): LeadDTO {
  const socials = (lead.socials as unknown as SocialLink[] | null) ?? [];
  const sources = (lead.sources as unknown as SourceRef[] | null) ?? [];
  const reasons = (lead.scoreReasons as unknown as ScoreReason[] | null) ?? [];
  return {
    id: lead.id,
    name: lead.name,
    city: lead.city,
    niche: lead.niche,
    category: lead.category,
    address: lead.address,
    site: siteOf(lead),
    phones: lead.phones,
    emails: lead.emails,
    socials: socials.map((s) => ({ type: s.type, label: socialLabel(s.type), url: s.url })),
    hours: lead.hours,
    sources: sources.map((s) => ({ provider: s.provider, label: SOURCE_LABELS[s.provider] ?? s.provider, url: s.url })),
    score: lead.score,
    potential: lead.potential,
    reasons: [...reasons].sort((a, b) => b.points - a.points),
    offer: lead.offer,
    status: lead.status,
    saved: lead.saved,
    proposal: lead.proposal,
    tasks: (lead.tasks ?? []).map((t) => ({ id: t.task.id, title: t.task.title, createdAt: t.task.createdAt.toISOString() })),
    createdAt: lead.createdAt.toISOString(),
  };
}

export function toSearchDTO(s: LeadSearch, breakdown: LeadSearchDTO["breakdown"] = null): LeadSearchDTO {
  return {
    id: s.id,
    niche: s.niche,
    city: s.city,
    requested: s.requested,
    extra: s.extra,
    osmOnly: s.osmOnly,
    parentId: s.parentId,
    status: s.status,
    found: s.found,
    checked: s.checked,
    filtered: s.filtered,
    stage: s.stage,
    warnings: (s.warnings as string[] | null) ?? [],
    error: s.error,
    createdAt: s.createdAt.toISOString(),
    finishedAt: s.finishedAt?.toISOString() ?? null,
    breakdown,
  };
}
