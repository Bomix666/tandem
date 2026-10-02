// Обращения к лидам (Outreach): черновик → проверка пользователем → отправка
// руками → ожидание ответа → follow-up → ответ / отказ / клиент.
// Ничего не отправляется автоматически: бот и Mini App только готовят текст и
// ссылку, а «📨 Отправлено» отмечает сам пользователь.
//
// Как подключить Claude позже: добавить OutreachGenerator с id "claude" в
// GENERATORS и выставить LEADS_PROPOSAL_ENGINE=claude — бот, Mini App и
// хранение черновиков не меняются. Почтовый сервис — OutreachSender с
// mode "auto" (см. senders.ts) и отдельным подтверждением отправки.

import type { Lead, LeadContact, LeadStatus, Outreach, OutreachChannel, OutreachStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import { leadsConfig } from "../config";
import { changeLeadStatus, recordLeadEvent } from "../events";
import { completeLeadTasks } from "../lead-tasks";
import { buildLeadFacts } from "../proposal";
import { getLeadSettings } from "../repository";
import type { SocialLink } from "../types";
import { manualSenders } from "./senders";
import { templateOutreachGenerator } from "./template";
import type { OutreachGenerator, OutreachText } from "./types";

const GENERATORS: Record<string, OutreachGenerator> = {
  template: templateOutreachGenerator,
};

export function getOutreachGenerator(): { generator: OutreachGenerator; note: string | null } {
  const id = leadsConfig.proposalEngine;
  const generator = GENERATORS[id];
  if (generator) return { generator, note: null };
  return { generator: templateOutreachGenerator, note: `Движок «${id}» не подключён — использую шаблон.` };
}

type LeadForOutreach = Lead & { contacts?: LeadContact[] };

/** Черновик, который ещё можно править (до отметки «отправлено»). */
export const EDITABLE: OutreachStatus[] = ["DRAFT", "READY"];
/** Отправлено, ответа ещё нет — сюда ставится follow-up. */
export const AWAITING: OutreachStatus[] = ["SENT", "WAITING", "FOLLOW_UP"];

/** Кому писать в выбранном канале: лучший проверенный email, Telegram, WhatsApp или соцсеть. */
export function pickRecipient(lead: LeadForOutreach, channel: OutreachChannel): { recipient: string | null; contactId: string | null } {
  const socials = (lead.socials as unknown as SocialLink[] | null) ?? [];
  switch (channel) {
    case "EMAIL": {
      const usable = (lead.contacts ?? []).filter((c) => c.kind === "EMAIL" && c.verification !== "INVALID");
      const best = usable.find((c) => c.isPrimary) ?? usable[0];
      if (best) return { recipient: best.value, contactId: best.id };
      return { recipient: lead.emails[0] ?? null, contactId: null };
    }
    case "TELEGRAM":
      return { recipient: socials.find((s) => s.type === "telegram")?.url ?? null, contactId: null };
    case "WHATSAPP":
      return { recipient: socials.find((s) => s.type === "whatsapp")?.url ?? lead.phones[0] ?? null, contactId: null };
    case "SOCIAL":
      return { recipient: socials.find((s) => s.type === "vk" || s.type === "instagram")?.url ?? socials[0]?.url ?? null, contactId: null };
  }
}

/** Предупреждения к тексту: пересчитываются при каждом показе (настройки могли измениться). */
export async function outreachWarnings(o: Pick<Outreach, "workspaceId" | "channel" | "recipient">): Promise<string[]> {
  const settings = await getLeadSettings(o.workspaceId);
  const warnings: string[] = [];
  if (!settings.senderName) warnings.push("В подписи нет имени — заполни «⚙️ Настройки → Подпись».");
  if (!o.recipient) warnings.push(o.channel === "EMAIL" ? "Email не найден — отправь текст через телефон или соцсети." : "Контакт для этого канала не найден — скопируй текст и отправь удобным способом.");
  return warnings;
}

export interface PreparedOutreach {
  outreach: Outreach;
  text: OutreachText;
  engine: string;
  note: string | null;
  /** Открыт уже существующий черновик (без дублей). */
  reused: boolean;
}

/**
 * «✨ Подготовить письмо» / «💬 Сообщение». Один открытый черновик на лид и
 * канал: повторное нажатие открывает его, `regenerate` — «🔄 Другой вариант»
 * (следующая формулировка в той же записи).
 */
export async function prepareOutreach(params: {
  lead: LeadForOutreach;
  channel: OutreachChannel;
  actorId?: string | null;
  regenerate?: boolean;
}): Promise<PreparedOutreach> {
  const { lead, channel } = params;
  const { generator, note } = getOutreachGenerator();
  const existing = await prisma.outreach.findFirst({
    where: { leadId: lead.id, channel, status: { in: EDITABLE } },
    orderBy: { createdAt: "desc" },
  });
  if (existing && !params.regenerate) {
    return {
      outreach: existing,
      text: { subject: existing.subject ?? undefined, body: existing.body, warnings: await outreachWarnings(existing) },
      engine: generator.label,
      note,
      reused: true,
    };
  }

  const settings = await getLeadSettings(lead.workspaceId);
  const variant = existing ? existing.variant + 1 : 0;
  const text = await generator.generate({
    channel,
    variant,
    facts: buildLeadFacts(lead),
    sender: { name: settings.senderName, company: settings.companyName, portfolioUrl: settings.portfolioUrl, contact: settings.senderContact },
  });
  const { recipient, contactId } = pickRecipient(lead, channel);
  const data = { recipient, contactId, subject: text.subject ?? null, body: text.body, generator: generator.id, variant, status: "DRAFT" as const };

  const outreach = existing
    ? await prisma.outreach.update({ where: { id: existing.id }, data })
    : await prisma.outreach.create({
        data: { workspaceId: lead.workspaceId, leadId: lead.id, createdById: params.actorId ?? null, channel, ...data },
      });
  await recordLeadEvent({
    workspaceId: lead.workspaceId,
    leadId: lead.id,
    type: "OUTREACH_DRAFTED",
    actorId: params.actorId,
    meta: { outreachId: outreach.id, channel, generator: generator.id, variant },
  });
  // совместимость: «✨ предложение» в Mini App читается из Lead.proposal
  if (channel === "EMAIL") await prisma.lead.update({ where: { id: lead.id }, data: { proposal: text.body } });
  return { outreach, text: { ...text, warnings: await outreachWarnings(outreach) }, engine: generator.label, note, reused: false };
}

/** Старое имя (Mini App «✨ Создать предложение»): открыть или создать черновик письма. */
export async function createOutreachDraft(params: { lead: LeadForOutreach; channel: OutreachChannel; actorId?: string | null }) {
  const p = await prepareOutreach(params);
  return {
    outreachId: p.outreach.id,
    channel: p.outreach.channel,
    recipient: p.outreach.recipient,
    text: p.text,
    engine: p.engine,
    note: p.note,
    handoff: manualSenders[p.outreach.channel].prepare({ recipient: p.outreach.recipient, subject: p.outreach.subject, body: p.outreach.body }),
  };
}

export async function getOutreach(id: string, workspaceId: string) {
  return prisma.outreach.findFirst({
    where: { id, workspaceId },
    include: { lead: { select: { id: true, name: true, status: true, city: true } }, contact: true },
  });
}
export type OutreachWithLead = NonNullable<Awaited<ReturnType<typeof getOutreach>>>;

/**
 * «✏️ Редактировать»: свой текст пользователя. Первая строка «Тема: …» у
 * письма меняет тему. Править можно только до отметки «отправлено».
 */
export async function editOutreachText(id: string, workspaceId: string, input: string): Promise<Outreach | null> {
  const o = await prisma.outreach.findFirst({ where: { id, workspaceId, status: { in: EDITABLE } } });
  if (!o) return null;
  let subject = o.subject;
  let body = input.trim();
  const m = /^тема\s*:\s*(.+)\n+([\s\S]+)$/i.exec(body);
  if (o.channel === "EMAIL" && m) {
    subject = m[1]!.trim().slice(0, 200);
    body = m[2]!.trim();
  }
  const updated = await prisma.outreach.update({ where: { id }, data: { subject, body: body.slice(0, 4000), generator: "manual" } });
  if (o.channel === "EMAIL") await prisma.lead.update({ where: { id: o.leadId }, data: { proposal: updated.body } });
  return updated;
}

/** Правка из Mini App: тема и текст отдельными полями. */
export async function updateOutreachContent(id: string, workspaceId: string, input: { subject?: string | null; body: string }): Promise<Outreach | null> {
  const o = await prisma.outreach.findFirst({ where: { id, workspaceId, status: { in: EDITABLE } } });
  if (!o) return null;
  const subject = o.channel === "EMAIL" ? (input.subject?.trim() || o.subject)?.slice(0, 200) ?? null : null;
  const updated = await prisma.outreach.update({ where: { id }, data: { subject, body: input.body.trim().slice(0, 4000), generator: "manual" } });
  if (o.channel === "EMAIL") await prisma.lead.update({ where: { id: o.leadId }, data: { proposal: updated.body } });
  return updated;
}

/** «❌ Отмена» черновика. Отправленные обращения не удаляются — это история. */
export async function discardDraft(id: string, workspaceId: string): Promise<{ leadId: string } | null> {
  const o = await prisma.outreach.findFirst({ where: { id, workspaceId, status: { in: EDITABLE } } });
  if (!o) return null;
  await prisma.outreach.delete({ where: { id } });
  if (o.channel === "EMAIL") await prisma.lead.updateMany({ where: { id: o.leadId, proposal: o.body }, data: { proposal: null } });
  return { leadId: o.leadId };
}

/** Пользователь открыл почту/мессенджер с готовым текстом — «📤 Готово к отправке». */
export async function markOutreachReady(id: string, workspaceId: string) {
  await prisma.outreach.updateMany({ where: { id, workspaceId, status: "DRAFT" }, data: { status: "READY" } });
}

const BEFORE_CONTACT: LeadStatus[] = ["FOUND", "NEW", "TO_CONTACT"];
const BEFORE_REPLY: LeadStatus[] = [...BEFORE_CONTACT, "CONTACTED", "WAITING"];

/**
 * «✅ Я отправил» — пользователь сам отправил письмо/сообщение. Лид — «📨
 * Связались», задача «Связаться с …» выполнена.
 */
export async function markOutreachSent(id: string, workspaceId: string, actorId: string): Promise<Outreach | null> {
  const o = await prisma.outreach.findFirst({ where: { id, workspaceId, status: { in: EDITABLE } } });
  if (!o) return null;
  const sent = await prisma.outreach.update({ where: { id }, data: { status: "SENT", sentAt: new Date() } });
  await recordLeadEvent({ workspaceId, leadId: o.leadId, type: "OUTREACH_SENT", actorId, meta: { outreachId: id, channel: o.channel } });
  await changeLeadStatus({ leadId: o.leadId, workspaceId, status: "CONTACTED", actorId, onlyFrom: BEFORE_CONTACT, meta: { auto: "outreach_sent", outreachId: id } });
  await completeLeadTasks(o.leadId, workspaceId, "CONTACT", actorId);
  return sent;
}

export type OutreachOutcome = "replied" | "rejected" | "client";

/**
 * Итог обращения: 👀 ответили (лид → 💬 Переговоры), ❌ отказ, 🤝 клиент.
 * Открытые follow-up по лиду закрываются — дальше решает пользователь.
 */
export async function setOutreachOutcome(id: string, workspaceId: string, outcome: OutreachOutcome, actorId: string): Promise<Outreach | null> {
  const o = await prisma.outreach.findFirst({ where: { id, workspaceId } });
  if (!o) return null;
  const now = new Date();
  const data =
    outcome === "replied"
      ? { status: "REPLIED" as const, repliedAt: o.repliedAt ?? now }
      : outcome === "rejected"
        ? { status: "REJECTED" as const }
        : { status: "CLIENT" as const };
  const updated = await prisma.outreach.update({ where: { id }, data: { ...data, followUpAt: null } });
  await applyOutcomeToLead(o.leadId, workspaceId, outcome, actorId, id);
  return updated;
}

/** То же для лида без обращения (например, ответили на звонок). */
export async function applyOutcomeToLead(leadId: string, workspaceId: string, outcome: OutreachOutcome, actorId: string, outreachId?: string) {
  if (outcome === "replied") {
    await recordLeadEvent({ workspaceId, leadId, type: "REPLY_RECEIVED", actorId, meta: outreachId ? { outreachId } : undefined });
    await changeLeadStatus({ leadId, workspaceId, status: "NEGOTIATION", actorId, onlyFrom: BEFORE_REPLY, meta: { auto: "reply_received" } });
  } else if (outcome === "rejected") {
    await changeLeadStatus({ leadId, workspaceId, status: "REJECTED", actorId, onlyFrom: [...BEFORE_REPLY, "NEGOTIATION"] });
  } else {
    await changeLeadStatus({ leadId, workspaceId, status: "CLIENT", actorId });
  }
  await completeLeadTasks(leadId, workspaceId, "FOLLOW_UP", actorId, { outcome });
}

// ---------- списки для раздела «📨 Outreach» ----------

export const OUTREACH_STATUS_ORDER: OutreachStatus[] = ["DRAFT", "READY", "SENT", "WAITING", "REPLIED", "FOLLOW_UP", "REJECTED", "CLIENT"];

export async function outreachCounts(workspaceId: string): Promise<Record<OutreachStatus, number>> {
  const rows = await prisma.outreach.groupBy({ by: ["status"], where: { workspaceId }, _count: { _all: true } });
  const counts = Object.fromEntries(OUTREACH_STATUS_ORDER.map((s) => [s, 0])) as Record<OutreachStatus, number>;
  for (const r of rows) counts[r.status] = r._count._all;
  return counts;
}

export async function listOutreach(workspaceId: string, status: OutreachStatus, page: number, pageSize = 8) {
  const where = { workspaceId, status };
  const [items, total] = await Promise.all([
    prisma.outreach.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: page * pageSize,
      take: pageSize,
      include: { lead: { select: { id: true, name: true } } },
    }),
    prisma.outreach.count({ where }),
  ]);
  return { items, total };
}

/** Последнее обращение по лиду — для строки «📨 Письмо: …» в карточке. */
export async function latestOutreach(leadId: string) {
  return prisma.outreach.findFirst({ where: { leadId }, orderBy: { updatedAt: "desc" } });
}

export { manualSenders } from "./senders";
export type { ManualHandoff, OutreachGenerator, OutreachSender, OutreachText, SenderProfile } from "./types";
