// Лид/поиск из БД → данные для Mini App (types/leads.ts). JSON-поля
// разворачиваются в понятные структуры, внутренние поля (нормализация,
// ключи дублей) наружу не отдаются.

import type { Lead, LeadContact, LeadSearch, LeadTaskKind, Outreach, TaskStatus } from "@prisma/client";
import type {
  DashboardDTO,
  FollowUpDTO,
  LeadContactDTO,
  LeadDTO,
  LeadSearchDTO,
  LeadSiteDTO,
  OutreachDTO,
  OutreachSummaryDTO,
} from "../../types/leads";
import type { Dashboard } from "./dashboard";
import { followUpScope, type FollowUp } from "./followups";
import { EDITABLE, type OutreachWithLead } from "./outreach";
import { outreachMailUrl } from "./outreach/links";
import { manualSenders } from "./outreach/senders";
import { CONTACT_SOURCE_LABELS, EMAIL_CHECK_LABELS, SOURCE_LABELS, siteIssues } from "./labels";
import { isModernSite, socialLabel } from "./scoring";
import { leadToDraft } from "./repository";
import type { ScoreReason, SiteAudit, SocialLink, SourceRef, WebsiteKind } from "./types";

type LeadWithTaskLinks = Lead & {
  tasks?: { kind?: LeadTaskKind; task: { id: string; title: string; createdAt: Date; status?: TaskStatus; deadlineAt?: Date } }[];
  contacts?: LeadContact[];
  outreach?: Outreach[];
};

export function outreachSummary(o: Outreach): OutreachSummaryDTO {
  return {
    id: o.id,
    channel: o.channel,
    status: o.status,
    sentAt: o.sentAt?.toISOString() ?? null,
    followUpAt: o.followUpAt?.toISOString() ?? null,
    updatedAt: o.updatedAt.toISOString(),
  };
}

function contactDTO(c: LeadContact): LeadContactDTO {
  return {
    value: c.value,
    check: c.verification,
    checkLabel: c.verification ? EMAIL_CHECK_LABELS[c.verification] : null,
    note: c.checkNote,
    source: c.sourceType,
    sourceLabel: CONTACT_SOURCE_LABELS[c.sourceType],
    sourceUrl: c.sourceUrl,
    primary: c.isPrimary,
  };
}

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
    contacts: (lead.contacts ?? []).filter((c) => c.kind === "EMAIL").map(contactDTO),
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
    tasks: (lead.tasks ?? []).map((t) => ({
      id: t.task.id,
      title: t.task.title,
      createdAt: t.task.createdAt.toISOString(),
      kind: t.kind ?? "CONTACT",
      done: t.task.status === "DONE",
    })),
    followUp: followUpOf(lead),
    outreach: lead.outreach?.[0] ? outreachSummary(lead.outreach[0]) : null,
    createdAt: lead.createdAt.toISOString(),
  };
}

function followUpOf(lead: LeadWithTaskLinks): LeadDTO["followUp"] {
  const fu = (lead.tasks ?? []).find((t) => t.kind === "FOLLOW_UP" && t.task.status !== "DONE" && t.task.deadlineAt);
  return fu ? { taskId: fu.task.id, at: fu.task.deadlineAt!.toISOString() } : null;
}

const OPEN_LABEL = { TELEGRAM: "💬 Открыть чат", WHATSAPP: "📱 Открыть WhatsApp", SOCIAL: "🌐 Открыть страницу" } as const;

export function toOutreachDTO(o: OutreachWithLead, extra: { warnings: string[]; engine: string }): OutreachDTO {
  let openUrl: string | null = null;
  let openLabel: string | null = null;
  if (o.channel === "EMAIL") {
    openUrl = o.recipient ? outreachMailUrl(o.id) : null;
    openLabel = openUrl ? "📨 Открыть почту" : null;
  } else {
    const url = manualSenders[o.channel].prepare({ recipient: o.recipient, subject: o.subject, body: o.body }).url;
    if (url && /^https?:\/\//.test(url)) {
      openUrl = url;
      openLabel = OPEN_LABEL[o.channel];
    }
  }
  const editable = EDITABLE.includes(o.status);
  return {
    ...outreachSummary(o),
    leadId: o.leadId,
    leadName: o.lead.name,
    recipient: o.recipient,
    recipientCheck: o.contact?.verification ?? null,
    subject: o.subject,
    body: o.body,
    edited: o.generator === "manual",
    variant: o.variant,
    repliedAt: o.repliedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    editable,
    warnings: editable ? extra.warnings : [],
    engine: extra.engine,
    openUrl,
    openLabel,
  };
}

type FollowUpRow = Pick<FollowUp, "taskId" | "leadId"> & {
  task: { deadlineAt: Date; status: TaskStatus };
  lead: { name: string; status: Lead["status"] };
  outreach?: Outreach | null;
};

export function toFollowUpDTO(f: FollowUpRow, now = new Date()): FollowUpDTO {
  return {
    taskId: f.taskId,
    leadId: f.leadId,
    leadName: f.lead.name,
    leadStatus: f.lead.status,
    at: f.task.deadlineAt.toISOString(),
    scope: followUpScope(f.task.deadlineAt, now),
    done: f.task.status === "DONE",
    outreach: f.outreach ? { id: f.outreach.id, channel: f.outreach.channel, sentAt: f.outreach.sentAt?.toISOString() ?? null, recipient: f.outreach.recipient } : null,
  };
}

export function toDashboardDTO(d: Dashboard, now = new Date()): DashboardDTO {
  const n = d.next;
  return {
    date: now.toISOString(),
    today: d.today,
    pipeline: d.pipeline,
    outreachToday: d.outreachToday,
    followUps: d.followUps,
    next: !n
      ? null
      : {
          kind: n.kind,
          leadId: n.leadId,
          name: n.name,
          outreachId: "outreachId" in n ? n.outreachId : undefined,
          taskId: "taskId" in n ? n.taskId : undefined,
          at: "at" in n ? n.at.toISOString() : undefined,
          overdue: "overdue" in n ? n.overdue : undefined,
          score: "score" in n ? n.score : undefined,
        },
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
    source: s.source === "yandex" ? "yandex" : "osm",
    parentId: s.parentId,
    status: s.status,
    candidates: s.candidates,
    found: s.found,
    checked: s.checked,
    filtered: s.filtered,
    withEmail: s.withEmail,
    needsReview: s.needsReview,
    stage: s.stage,
    warnings: (s.warnings as string[] | null) ?? [],
    error: s.error,
    createdAt: s.createdAt.toISOString(),
    finishedAt: s.finishedAt?.toISOString() ?? null,
    breakdown,
  };
}
