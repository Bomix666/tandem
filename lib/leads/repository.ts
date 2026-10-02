// Работа с БД для модуля лидов: сохранение результатов поиска с защитой от
// дублей, списки, фильтры, история, статистика, настройки.

import { Prisma, type Lead, type LeadContact, type LeadStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { usableEmails, type EmailContact } from "./contacts";
import { LeadIndex, type DedupeRecord } from "./dedupe";
import { changeLeadStatus, recordLeadEvent } from "./events";
import { mergeDraftInto } from "./merge";
import { resolveNiche } from "./niches";
import { buildOfferPlan, offerSummary } from "./offer";
import { NO_REQUIREMENTS } from "./requirements";
import { scoreLead } from "./scoring";
import type { AcceptedLead, SearchOutcome, SearchProgress } from "./search";
import type { LeadDraft, ScoreReason, SiteAudit, SocialLink, SourceRef, WebsiteKind } from "./types";

// ---------- преобразования ----------

export function leadToDraft(lead: Lead): LeadDraft {
  const sources = (lead.sources as unknown as SourceRef[]) ?? [];
  return {
    name: lead.name,
    normName: lead.normName,
    city: lead.city,
    niche: lead.niche,
    category: lead.category ?? undefined,
    address: lead.address ?? undefined,
    normAddress: lead.normAddress ?? undefined,
    lat: lead.lat ?? undefined,
    lon: lead.lon ?? undefined,
    websiteKind: lead.websiteKind as WebsiteKind,
    website: lead.website ?? undefined,
    domain: lead.domain ?? undefined,
    bookingPage: (lead.bookingPage as { name: string; url: string } | null) ?? undefined,
    socials: (lead.socials as unknown as SocialLink[] | null) ?? [],
    phones: lead.phones,
    normPhones: lead.normPhones,
    emails: lead.emails,
    hours: lead.hours ?? undefined,
    yandexId: lead.yandexId ?? undefined,
    osmId: lead.osmId ?? undefined,
    sources,
    confirmedByOsm: sources.some((s) => s.provider === "yandex") && sources.some((s) => s.provider === "osm"),
    chainSize: lead.chainSize,
    nicheMatch: lead.nicheMatch,
    audit: (lead.siteAudit as unknown as SiteAudit | null) ?? undefined,
  };
}

function draftColumns(d: LeadDraft) {
  return {
    name: d.name,
    normName: d.normName,
    city: d.city,
    niche: d.niche,
    category: d.category ?? null,
    address: d.address ?? null,
    normAddress: d.normAddress ?? null,
    lat: d.lat ?? null,
    lon: d.lon ?? null,
    websiteKind: d.websiteKind,
    website: d.website ?? null,
    domain: d.domain ?? null,
    bookingPage: d.bookingPage ? (d.bookingPage as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
    phones: d.phones,
    normPhones: d.normPhones,
    emails: d.emails,
    socials: d.socials as unknown as Prisma.InputJsonArray,
    hours: d.hours ?? null,
    yandexId: d.yandexId ?? null,
    osmId: d.osmId ?? null,
    sources: d.sources as unknown as Prisma.InputJsonArray,
    chainSize: d.chainSize,
    nicheMatch: d.nicheMatch,
    siteAudit: d.audit ? (d.audit as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
  };
}

function assessmentColumns(score: number, potential: Lead["potential"], reasons: ScoreReason[], offer: string) {
  return { score, potential, scoreReasons: reasons as unknown as Prisma.InputJsonArray, offer };
}

// ---------- поиск: дубли и сохранение ----------

export async function loadLeadIndex(workspaceId: string): Promise<LeadIndex> {
  const rows = await prisma.lead.findMany({
    where: { workspaceId },
    select: { id: true, yandexId: true, osmId: true, domain: true, normPhones: true, normName: true, normAddress: true, lat: true, lon: true },
  });
  return new LeadIndex(rows as DedupeRecord[]);
}

/** Кандидаты, отклонённые в прошлых поисках той же ниши и города. */
export async function loadRejectedKeys(workspaceId: string, niche: string, city: string): Promise<Set<string>> {
  const rows = await prisma.leadSearch.findMany({
    where: { workspaceId, niche: { equals: niche, mode: "insensitive" }, city: { equals: city, mode: "insensitive" } },
    select: { rejectedKeys: true },
  });
  return new Set(rows.flatMap((r) => (r.rejectedKeys as string[] | null) ?? []));
}

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Существующий лид + свежие данные → обновлённый лид (только дополнение). */
async function mergeIntoExisting(leadId: string, acc: AcceptedLead): Promise<void> {
  const existing = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!existing) return;
  const merged = mergeDraftInto(leadToDraft(existing), acc.draft);
  const rescored = scoreLead(merged, NO_REQUIREMENTS);
  const offer = offerSummary(buildOfferPlan(merged, resolveNiche(merged.niche)));
  const data = { ...draftColumns(merged), ...assessmentColumns(rescored.score, rescored.potential, rescored.reasons, offer) };
  // статус, «сохранён», предложение и автор не трогаем — это действия пользователя
  try {
    await prisma.lead.update({ where: { id: leadId }, data });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // id источника уже принадлежит другой записи — обновляем без него
    await prisma.lead.update({ where: { id: leadId }, data: { ...data, yandexId: existing.yandexId, osmId: existing.osmId } });
  }
}

export async function saveSearchOutcome(params: {
  searchId: string;
  workspaceId: string;
  userId: string;
  outcome: SearchOutcome;
}): Promise<{ saved: number; existing: number }> {
  const { searchId, workspaceId, userId, outcome } = params;
  const linked = new Set<string>();
  let position = 0;
  let existingCount = 0;

  for (const acc of outcome.accepted) {
    let leadId = acc.existingId;
    let wasExisting = leadId !== null;

    if (!leadId) {
      try {
        const created = await prisma.lead.create({
          data: {
            workspaceId,
            createdById: userId,
            status: "FOUND", // 🔎 результат поиска; «🆕 Новый» — когда пользователь сохранит лид
            ...draftColumns(acc.draft),
            ...assessmentColumns(acc.result.score, acc.result.potential, acc.result.reasons, offerSummary(acc.offer)),
          },
        });
        leadId = created.id;
        await recordLeadEvent({ workspaceId, leadId, type: "FOUND", toStatus: "FOUND", meta: { searchId, score: acc.result.score } });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // гонка с параллельным поиском: запись появилась между проверкой и вставкой
        const found = await prisma.lead.findFirst({
          where: {
            workspaceId,
            OR: [
              ...(acc.draft.yandexId ? [{ yandexId: acc.draft.yandexId }] : []),
              ...(acc.draft.osmId ? [{ osmId: acc.draft.osmId }] : []),
            ],
          },
        });
        if (!found) throw e;
        leadId = found.id;
        wasExisting = true;
      }
    }
    if (wasExisting) await mergeIntoExisting(leadId, acc);
    await saveEmailContacts(workspaceId, leadId, acc.draft.contacts ?? []);
    if (linked.has(leadId)) continue;
    linked.add(leadId);
    if (wasExisting) existingCount++;
    await prisma.leadSearchResult.create({ data: { searchId, leadId, position: position++, wasExisting } });
  }
  return { saved: linked.size, existing: existingCount };
}

const CONTACT_SOURCE = { osm: "OSM", yandex: "YANDEX", site: "SITE", manual: "MANUAL" } as const;

/**
 * Email лида → LeadContact (без дублей: один адрес — одна запись, проверка
 * обновляется свежей). Lead.emails пересчитывается из всех контактов лида.
 */
export async function saveEmailContacts(workspaceId: string, leadId: string, contacts: EmailContact[]): Promise<void> {
  if (!contacts.length) return;
  for (const c of contacts) {
    const existing = await prisma.leadContact.findUnique({
      where: { leadId_kind_normalized: { leadId, kind: "EMAIL", normalized: c.value } },
      select: { id: true },
    });
    const check = {
      verification: c.check ?? null,
      checkNote: c.checkNote ?? null,
      checkedAt: c.checkedAt ? new Date(c.checkedAt) : null,
    };
    if (existing) {
      if (c.check) await prisma.leadContact.update({ where: { id: existing.id }, data: check });
      continue;
    }
    await prisma.leadContact.create({
      data: {
        workspaceId,
        leadId,
        kind: "EMAIL",
        value: c.value,
        normalized: c.value,
        role: c.role,
        sourceType: CONTACT_SOURCE[c.source],
        sourceUrl: c.sourceUrl ?? null,
        ...check,
      },
    });
    await recordLeadEvent({ workspaceId, leadId, type: "CONTACT_FOUND", meta: { kind: "EMAIL", value: c.value, check: c.check ?? null, source: c.source } });
  }
  await refreshLeadEmails(leadId);
}

/** Lead.emails = пригодные адреса из LeadContact, лучшие первыми. */
export async function refreshLeadEmails(leadId: string): Promise<void> {
  const rows = await prisma.leadContact.findMany({ where: { leadId, kind: "EMAIL" } });
  if (!rows.length) return;
  const emails = usableEmails(rows.map(contactRowToEmail));
  await prisma.lead.update({ where: { id: leadId }, data: { emails } });
  const primary = emails[0];
  await prisma.leadContact.updateMany({ where: { leadId, kind: "EMAIL" }, data: { isPrimary: false } });
  if (primary) await prisma.leadContact.updateMany({ where: { leadId, kind: "EMAIL", normalized: primary }, data: { isPrimary: true } });
}

const SOURCE_FROM_DB = { OSM: "osm", YANDEX: "yandex", SITE: "site", MANUAL: "manual" } as const;

export function contactRowToEmail(r: LeadContact): EmailContact {
  return {
    value: r.value,
    source: SOURCE_FROM_DB[r.sourceType],
    sourceUrl: r.sourceUrl ?? undefined,
    role: r.role ?? "",
    check: r.verification ?? undefined,
    checkNote: r.checkNote ?? undefined,
    checkedAt: r.checkedAt?.toISOString(),
  };
}

// ---------- запуски поиска ----------

export async function createLeadSearch(data: {
  workspaceId: string;
  userId: string;
  chatId: number | null; // null — запуск из Mini App
  niche: string;
  city: string;
  requested: number;
  extra: string | null;
  source: "osm" | "yandex";
  parentId?: string;
  offset?: number;
}) {
  return prisma.leadSearch.create({
    data: {
      workspaceId: data.workspaceId,
      userId: data.userId,
      chatId: data.chatId === null ? null : BigInt(data.chatId),
      niche: data.niche,
      city: data.city,
      requested: data.requested,
      extra: data.extra,
      osmOnly: data.source === "osm",
      source: data.source,
      parentId: data.parentId,
      nextOffset: data.offset ?? 0,
    },
  });
}

/** Промежуточный прогресс — приложение показывает его, опрашивая поиск. */
export async function updateSearchProgress(searchId: string, p: SearchProgress) {
  await prisma.leadSearch.updateMany({
    where: { id: searchId, status: "RUNNING" },
    data: {
      found: p.found,
      candidates: p.candidates,
      checked: p.checked,
      filtered: p.filtered,
      withEmail: p.withEmail,
      needsReview: p.needsReview,
      stage: p.stage || null,
      warnings: p.warnings,
    },
  });
}

export async function finishLeadSearch(searchId: string, outcome: SearchOutcome, found: number) {
  return prisma.leadSearch.update({
    where: { id: searchId },
    data: {
      status: "DONE",
      stage: null,
      found,
      candidates: outcome.candidates,
      checked: outcome.checked,
      filtered: outcome.filtered,
      withEmail: outcome.withEmail,
      needsReview: outcome.needsReview,
      nextOffset: outcome.nextOffset,
      warnings: outcome.warnings,
      rejectedKeys: outcome.rejectedKeys,
      finishedAt: new Date(),
    },
  });
}

export async function failLeadSearch(searchId: string, error: string, warnings: string[] = []) {
  return prisma.leadSearch.update({
    where: { id: searchId },
    data: { status: "FAILED", stage: null, error, warnings, finishedAt: new Date() },
  });
}

export async function getSearch(searchId: string, workspaceId: string) {
  return prisma.leadSearch.findFirst({ where: { id: searchId, workspaceId } });
}

export async function listSearches(workspaceId: string, page: number, pageSize = 8) {
  const [items, total] = await Promise.all([
    prisma.leadSearch.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      skip: page * pageSize,
      take: pageSize,
    }),
    prisma.leadSearch.count({ where: { workspaceId } }),
  ]);
  return { items, total };
}

/** Лид на позиции в результатах поиска + сколько всего в подборке. */
export async function getSearchLeadAt(searchId: string, workspaceId: string, position: number) {
  const search = await getSearch(searchId, workspaceId);
  if (!search) return null;
  const [row, total] = await Promise.all([
    prisma.leadSearchResult.findUnique({ where: { searchId_position: { searchId, position } }, include: { lead: true } }),
    prisma.leadSearchResult.count({ where: { searchId } }),
  ]);
  return { search, lead: row?.lead ?? null, total };
}

export async function potentialBreakdown(searchId: string) {
  const rows = await prisma.leadSearchResult.findMany({ where: { searchId }, include: { lead: { select: { potential: true } } } });
  const count = (p: Lead["potential"]) => rows.filter((r) => r.lead.potential === p).length;
  return { total: rows.length, high: count("HIGH"), medium: count("MEDIUM"), low: count("LOW"), existing: rows.filter((r) => r.wasExisting).length };
}

// ---------- «Мои лиды» ----------

/** a — все, f — сохранённые, d — найденные, n — новые, t — связаться, g — переговоры, c — клиенты, r — отказы, q — поиск по названию. */
export type LeadFilter = "a" | "f" | "d" | "n" | "t" | "g" | "c" | "r" | "q";
export const LEAD_FILTERS: LeadFilter[] = ["a", "f", "d", "n", "t", "g", "c", "r", "q"];

const FILTER_WHERE: Record<LeadFilter, Prisma.LeadWhereInput> = {
  a: {},
  f: { saved: true },
  d: { status: "FOUND" },
  n: { status: "NEW" },
  t: { status: "TO_CONTACT" },
  g: { status: "NEGOTIATION" },
  c: { status: "CLIENT" },
  r: { status: { in: ["REJECTED", "NOT_FIT"] } },
  q: {},
};

/** Фильтр по статусу + (необязательно) поиск по названию. */
export function filterWhere(workspaceId: string, filter: LeadFilter, query?: string): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = { workspaceId, ...FILTER_WHERE[filter] };
  if (query) where.name = { contains: query, mode: "insensitive" };
  return where;
}

const LIST_ORDER: Prisma.LeadOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];

export async function listLeads(workspaceId: string, filter: LeadFilter, page: number, query?: string, pageSize = 8) {
  const where = filterWhere(workspaceId, filter, query);
  const [items, total] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: LIST_ORDER, skip: page * pageSize, take: pageSize, include: TASK_LINKS }),
    prisma.lead.count({ where }),
  ]);
  return { items, total };
}

/** Следующий лид в списке после текущего (устойчиво к смене статуса текущего). */
export async function nextLeadAfter(workspaceId: string, filter: LeadFilter, currentId: string, query?: string) {
  const current = await prisma.lead.findFirst({ where: { id: currentId, workspaceId }, select: { createdAt: true, id: true } });
  if (!current) return null;
  return prisma.lead.findFirst({
    where: {
      AND: [
        filterWhere(workspaceId, filter, query),
        { OR: [{ createdAt: { lt: current.createdAt } }, { createdAt: current.createdAt, id: { lt: current.id } }] },
      ],
    },
    orderBy: LIST_ORDER,
  });
}

// ---------- действия с лидом ----------

const TASK_LINKS = {
  tasks: { orderBy: { createdAt: "desc" }, include: { task: { select: { id: true, title: true, createdAt: true } } } },
  contacts: { where: { kind: "EMAIL" }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
} satisfies Prisma.LeadInclude;

export async function getLead(leadId: string, workspaceId: string) {
  return prisma.lead.findFirst({ where: { id: leadId, workspaceId }, include: TASK_LINKS });
}

/** Лиды поиска в порядке подборки. */
export async function getSearchLeads(searchId: string, workspaceId: string) {
  const rows = await prisma.leadSearchResult.findMany({
    where: { searchId, search: { workspaceId } },
    orderBy: { position: "asc" },
    include: { lead: { include: TASK_LINKS } },
  });
  return rows.map((r) => r.lead);
}

/** Поиск, который идёт сейчас (из приложения, у партнёра или из бота). */
export async function getActiveSearch(workspaceId: string) {
  return prisma.leadSearch.findFirst({
    where: { workspaceId, status: "RUNNING", createdAt: { gt: new Date(Date.now() - 15 * 60_000) } },
    orderBy: { createdAt: "desc" },
  });
}

export type LeadWithTasks = NonNullable<Awaited<ReturnType<typeof getLead>>>;

export async function setLeadStatus(leadId: string, workspaceId: string, status: LeadStatus, actorId?: string | null) {
  return changeLeadStatus({ leadId, workspaceId, status, actorId });
}

/**
 * «❤️ Сохранить» / убрать из сохранённых. Сохранение найденного лида берёт
 * его в работу: 🔎 Найден → 🆕 Новый.
 */
export async function setLeadSaved(leadId: string, workspaceId: string, saved: boolean, actorId?: string | null): Promise<boolean> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId }, select: { saved: true, status: true } });
  if (!lead) return false;
  if (lead.saved === saved) return true;
  const toNew = saved && lead.status === "FOUND";
  await prisma.lead.update({
    where: { id: leadId },
    data: { saved, ...(toNew ? { status: "NEW" as const, statusChangedAt: new Date() } : {}) },
  });
  if (saved) {
    await recordLeadEvent({
      workspaceId,
      leadId,
      type: "SAVED",
      actorId,
      ...(toNew ? { fromStatus: "FOUND" as const, toStatus: "NEW" as const } : {}),
    });
  }
  return true;
}

export async function toggleLeadSaved(leadId: string, workspaceId: string, actorId?: string | null): Promise<boolean | null> {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, workspaceId }, select: { saved: true } });
  if (!lead) return null;
  await setLeadSaved(leadId, workspaceId, !lead.saved, actorId);
  return !lead.saved;
}

export async function saveProposal(leadId: string, text: string) {
  await prisma.lead.update({ where: { id: leadId }, data: { proposal: text } });
}

// ---------- статистика и настройки ----------

export async function getLeadSettings(workspaceId: string) {
  return prisma.leadSettings.upsert({ where: { workspaceId }, update: {}, create: { workspaceId } });
}

export async function setAvgCheck(workspaceId: string, avgCheck: number) {
  return prisma.leadSettings.upsert({ where: { workspaceId }, update: { avgCheck }, create: { workspaceId, avgCheck } });
}

const SENDER_COLUMNS = { name: "senderName", company: "companyName", portfolio: "portfolioUrl", contact: "senderContact" } as const;

/** Поле подписи в предложениях (пустое значение — очистить). */
export async function setSenderField(workspaceId: string, field: keyof typeof SENDER_COLUMNS, value: string | null) {
  const data = { [SENDER_COLUMNS[field]]: value };
  return prisma.leadSettings.upsert({ where: { workspaceId }, update: data, create: { workspaceId, ...data } });
}

export async function getLeadStats(workspaceId: string) {
  const [groups, saved, searches, settings] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } }),
    prisma.lead.count({ where: { workspaceId, saved: true } }),
    prisma.leadSearch.count({ where: { workspaceId } }),
    getLeadSettings(workspaceId),
  ]);
  const byStatus = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Partial<Record<LeadStatus, number>>;
  const total = groups.reduce((s, g) => s + g._count._all, 0);
  return { total, byStatus, saved, searches, avgCheck: settings.avgCheck };
}

/** При старте бота: поиски, оборванные перезапуском, помечаем как прерванные. */
export async function failInterruptedSearches(): Promise<number> {
  const res = await prisma.leadSearch.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED", error: "Поиск прерван перезапуском бота", finishedAt: new Date() },
  });
  return res.count;
}

export async function hasRunningSearch(workspaceId: string): Promise<boolean> {
  const recent = new Date(Date.now() - 15 * 60_000); // зависший после перезапуска бота поиск не блокирует вечно
  return (await prisma.leadSearch.count({ where: { workspaceId, status: "RUNNING", createdAt: { gt: recent } } })) > 0;
}
