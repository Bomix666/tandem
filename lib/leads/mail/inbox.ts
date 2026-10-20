// Ответы клиентов из Gmail. Письмо находит свою переписку по Message-ID
// (In-Reply-To / References), а если почтовая программа клиента их потеряла —
// по адресу отправителя. Первый ответ: обращение → «👀 Ответ получен», лид →
// «💬 Переговоры», follow-up закрыт. Claude готовит черновик ответа, бот
// присылает его на одобрение (bot/leads/mail.ts).

import type { Outreach, OutreachMessage } from "@prisma/client";
import { prisma } from "../../prisma";
import { redactError } from "../redact";
import { getLeadSettings } from "../repository";
import { AWAITING, getOutreachGenerator, setOutreachOutcome } from "../outreach";
import { getMailAccount } from "./account";
import { fetchNewMail, type IncomingMail } from "./gmail";
import { draftReply, type ReplyIntent } from "./reply";

type LeadRef = { id: string; name: string };

export type IncomingEvent =
  | { kind: "reply"; workspaceId: string; outreach: Outreach; lead: LeadRef; message: OutreachMessage; draft: OutreachMessage | null; intent: ReplyIntent | null; handoff: string | null; draftError: boolean }
  | { kind: "auto"; workspaceId: string; outreach: Outreach; lead: LeadRef; message: OutreachMessage }
  | { kind: "bounce"; workspaceId: string; outreach: Outreach; lead: LeadRef; address: string };

// Строка, с которой начинается цитата прошлого письма: «> …», «…, Имя <a@b.ru>:»
// (Gmail, Яндекс, Mail.ru), «… писал(а):», «-----Original Message-----», «От: …» (Outlook).
const QUOTE_START = [
  /^>/,
  /<[^<>\s]+@[^<>\s]+>\s*[^<>]{0,20}:\s*$/,
  /(wrote|писал\(а\)|написал\(а\)|пишет|писал|написал):\s*$/i,
  /^-{2,}.*(original message|исходное сообщение|пересылаемое сообщение)/i,
  /^(from|от):\s.*@/i,
];

/** Текст ответа без цитаты нашего письма. ponytail: эвристика по строкам, редкие клиенты цитируют иначе. */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (QUOTE_START.some((re) => re.test(line.trim()))) break;
    out.push(line);
  }
  return out.join("\n").trim() || text.trim();
}

export const replySubject = (subject: string | null | undefined) => {
  const s = (subject ?? "").trim();
  return /^(re|ответ)\s*:/i.test(s) ? s : `Re: ${s}`;
};

/** Обращение, к которому относится письмо: по цепочке Message-ID, иначе по адресу. */
async function matchOutreach(workspaceId: string, mail: IncomingMail): Promise<Outreach | null> {
  const ids = [mail.inReplyTo, ...mail.references].filter((v): v is string => !!v);
  if (ids.length) {
    const known = await prisma.outreachMessage.findFirst({
      where: { messageId: { in: ids }, outreach: { workspaceId } },
      orderBy: { createdAt: "desc" },
      include: { outreach: true },
    });
    if (known) return known.outreach;
  }
  const addresses = mail.bounce ? mail.failedRecipients : mail.from ? [mail.from] : [];
  for (const address of addresses) {
    const o = await prisma.outreach.findFirst({
      where: { workspaceId, channel: "EMAIL", recipient: { equals: address, mode: "insensitive" }, messages: { some: { direction: "OUT", sentAt: { not: null } } } },
      orderBy: { sentAt: "desc" },
    });
    if (o) return o;
  }
  return null;
}

/** Кто «действует» при автоматических отметках: автор обращения или участник пространства. */
async function actorFor(o: Outreach): Promise<string | null> {
  if (o.createdById) return o.createdById;
  const m = await prisma.workspaceMember.findFirst({ where: { workspaceId: o.workspaceId }, orderBy: { joinedAt: "asc" } });
  return m?.userId ?? null;
}

/** Переписка по обращению в хронологическом порядке (без неотправленных черновиков). */
export async function threadOf(outreachId: string) {
  return prisma.outreachMessage.findMany({ where: { outreachId, OR: [{ direction: "IN" }, { sentAt: { not: null } }] }, orderBy: { createdAt: "asc" } });
}

/**
 * Черновик ответа Claude на последнее письмо клиента. Старый неотправленный
 * черновик заменяется — по переписке он один. null — Claude не подключён или
 * отвечать не нужно (отказ, автоответ).
 */
export async function prepareReplyDraft(outreachId: string): Promise<{ draft: OutreachMessage | null; intent: ReplyIntent | null; handoff: string | null; error: boolean }> {
  if (getOutreachGenerator().generator.id !== "claude") return { draft: null, intent: null, handoff: null, error: false };
  const o = await prisma.outreach.findUniqueOrThrow({ where: { id: outreachId }, include: { lead: true } });
  const settings = await getLeadSettings(o.workspaceId);
  const thread = await threadOf(o.id);
  if (!thread.some((m) => m.direction === "OUT")) thread.unshift({ direction: "OUT", body: o.body, createdAt: o.sentAt ?? o.createdAt } as OutreachMessage);
  try {
    const r = await draftReply({
      lead: o.lead,
      sender: { name: settings.senderName, company: settings.companyName, portfolioUrl: settings.portfolioUrl, contact: settings.senderContact },
      pricing: settings.priceInfo,
      thread: thread.map((m) => ({ direction: m.direction, body: m.body, at: m.sentAt ?? m.createdAt })),
    });
    await prisma.outreachMessage.deleteMany({ where: { outreachId, direction: "OUT", sentAt: null } });
    const draft = r.body
      ? await prisma.outreachMessage.create({ data: { outreachId, direction: "OUT", subject: replySubject(o.subject), body: r.body } })
      : null;
    return { draft, intent: r.intent, handoff: r.handoff, error: false };
  } catch (err) {
    console.error("Reply draft failed:", redactError(err));
    return { draft: null, intent: null, handoff: null, error: true };
  }
}

/** Разбор одного письма из «Входящих». null — письмо не из нашей переписки или уже разобрано. */
export async function handleIncoming(workspaceId: string, mail: IncomingMail): Promise<IncomingEvent | null> {
  if (mail.messageId && (await prisma.outreachMessage.findUnique({ where: { messageId: mail.messageId } }))) return null;
  const outreach = await matchOutreach(workspaceId, mail);
  if (!outreach) return null;
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: outreach.leadId }, select: { id: true, name: true } });

  if (mail.bounce) {
    // адрес не существует или ящик не принимает почту — больше на него не пишем
    if (outreach.contactId) await prisma.leadContact.update({ where: { id: outreach.contactId }, data: { verification: "INVALID", checkNote: "Gmail: письмо не доставлено", checkedAt: new Date() } });
    return { kind: "bounce", workspaceId, outreach, lead, address: mail.failedRecipients[0] ?? outreach.recipient ?? "" };
  }

  const message = await prisma.outreachMessage.create({
    data: {
      outreachId: outreach.id,
      direction: "IN",
      messageId: mail.messageId ?? `<inbox-${workspaceId}-${mail.uid}@tandem>`,
      fromAddr: mail.from,
      subject: mail.subject,
      body: stripQuoted(mail.text).slice(0, 8000),
      sentAt: mail.date,
    },
  });
  if (mail.auto) return { kind: "auto", workspaceId, outreach, lead, message };

  if (AWAITING.includes(outreach.status)) {
    const actor = await actorFor(outreach);
    if (actor) await setOutreachOutcome(outreach.id, workspaceId, "replied", actor);
  }
  const r = await prepareReplyDraft(outreach.id);
  return { kind: "reply", workspaceId, outreach, lead, message, draft: r.draft, intent: r.intent, handoff: r.handoff, draftError: r.error };
}

let polling = false;

/** Проверка «Входящих» всех подключённых Gmail; по каждому событию — onEvent (уведомление в бот). */
export async function pollInboxes(onEvent: (e: IncomingEvent) => Promise<void>) {
  if (polling) return;
  polling = true;
  try {
    const rows = await prisma.leadSettings.findMany({ where: { gmailUser: { not: null }, gmailPassword: { not: null } }, select: { workspaceId: true, gmailLastUid: true } });
    for (const row of rows) {
      const account = await getMailAccount(row.workspaceId);
      if (!account) continue;
      try {
        const { mails, lastUid } = await fetchNewMail(account, row.gmailLastUid ?? 0);
        for (const mail of mails) {
          try {
            const event = await handleIncoming(row.workspaceId, mail);
            if (event) await onEvent(event);
          } catch (err) {
            console.error("Incoming mail failed:", redactError(err));
          }
        }
        if (lastUid !== row.gmailLastUid) await prisma.leadSettings.update({ where: { workspaceId: row.workspaceId }, data: { gmailLastUid: lastUid } });
      } catch (err) {
        console.error("Gmail inbox check failed:", redactError(err));
      }
    }
  } finally {
    polling = false;
  }
}
