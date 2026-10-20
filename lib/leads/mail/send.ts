// Отправка через Gmail по кнопке в боте: первое письмо лиду и одобренные
// ответы в переписке. Нажатие кнопки — и есть подтверждение пользователя.

import type { Transporter } from "nodemailer";
import { prisma } from "../../prisma";
import { recordLeadEvent } from "../events";
import { EDITABLE, markOutreachSent } from "../outreach";
import { redactError } from "../redact";
import { getMailAccount } from "./account";
import { sendMail } from "./gmail";
import { replySubject } from "./inbox";

export type SendResult = { ok: true } | { ok: false; error: string };

/** Понятная причина сбоя SMTP — без паролей и служебного мусора. */
export function smtpErrorText(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string };
  if (e.code === "EAUTH" || e.responseCode === 535) return "Gmail не принял пароль приложения — подключи Gmail заново в «⚙️ Настройки».";
  if (/daily user sending limit|5\.4\.5/i.test(e.response ?? "")) return "Gmail исчерпал дневной лимит отправки — продолжим завтра.";
  if (["ESOCKET", "ETIMEDOUT", "ECONNECTION", "EDNS"].includes(e.code ?? "")) return "Не достучался до Gmail — проверь интернет или VPN и попробуй ещё раз.";
  return `Gmail не отправил письмо: ${(e.response ?? e.message ?? "ошибка").slice(0, 200)}`;
}

// ponytail: защита от двойного нажатия — в памяти процесса бота (он один); при нескольких — блокировка в БД.
const inFlight = new Set<string>();

async function once(id: string, fn: () => Promise<SendResult>): Promise<SendResult> {
  if (inFlight.has(id)) return { ok: false, error: "Уже отправляю, подожди" };
  inFlight.add(id);
  try {
    return await fn();
  } catch (err) {
    console.error("Gmail send failed:", redactError(err));
    return { ok: false, error: smtpErrorText(err) };
  } finally {
    inFlight.delete(id);
  }
}

/** «📤 Отправить через Gmail»: письмо уходит, обращение — «📨 Отправлено», лид — «Связались». */
export function sendOutreachEmail(outreachId: string, workspaceId: string, actorId: string, transport?: Transporter): Promise<SendResult> {
  return once(outreachId, async () => {
    const account = await getMailAccount(workspaceId);
    if (!account) return { ok: false, error: "Gmail не подключён — «⚙️ Настройки → 📧 Gmail»." };
    const o = await prisma.outreach.findFirst({ where: { id: outreachId, workspaceId, channel: "EMAIL", status: { in: EDITABLE } } });
    if (!o) return { ok: false, error: "Письмо уже отправлено или черновик удалён." };
    if (!o.recipient) return { ok: false, error: "У лида нет email — отправить некуда." };
    const subject = o.subject?.trim() || "Предложение по сайту";
    const messageId = await sendMail(account, { to: o.recipient, subject, text: o.body }, transport);
    await prisma.outreachMessage.create({ data: { outreachId: o.id, direction: "OUT", messageId, fromAddr: account.user, subject, body: o.body, sentAt: new Date() } });
    await markOutreachSent(o.id, workspaceId, actorId);
    return { ok: true };
  });
}

/** Черновик ответа из переписки (неотправленный) — с обращением и лидом. */
export function getReplyDraft(draftId: string, workspaceId: string) {
  return prisma.outreachMessage.findFirst({
    where: { id: draftId, direction: "OUT", sentAt: null, outreach: { workspaceId } },
    include: { outreach: { include: { lead: { select: { id: true, name: true } } } } },
  });
}

/** «📤 Отправить ответ»: ответ уходит в ту же переписку (In-Reply-To / References). */
export function sendReplyDraft(draftId: string, workspaceId: string, actorId: string, transport?: Transporter): Promise<SendResult> {
  return once(draftId, async () => {
    const account = await getMailAccount(workspaceId);
    if (!account) return { ok: false, error: "Gmail не подключён — «⚙️ Настройки → 📧 Gmail»." };
    const draft = await getReplyDraft(draftId, workspaceId);
    if (!draft) return { ok: false, error: "Ответ уже отправлен или удалён." };
    const o = draft.outreach;
    if (!o.recipient) return { ok: false, error: "У лида нет email — отправить некуда." };
    const chain = await prisma.outreachMessage.findMany({ where: { outreachId: o.id, messageId: { not: null } }, orderBy: { createdAt: "asc" }, select: { messageId: true, direction: true } });
    const ids = chain.map((m) => m.messageId!);
    const lastIn = [...chain].reverse().find((m) => m.direction === "IN")?.messageId ?? ids.at(-1);
    const subject = draft.subject ?? replySubject(o.subject);
    const messageId = await sendMail(account, { to: o.recipient, subject, text: draft.body, inReplyTo: lastIn, references: ids.slice(-20) }, transport);
    await prisma.outreachMessage.update({ where: { id: draft.id }, data: { messageId, fromAddr: account.user, subject, sentAt: new Date() } });
    await recordLeadEvent({ workspaceId, leadId: o.leadId, type: "OUTREACH_SENT", actorId, meta: { outreachId: o.id, channel: "EMAIL", reply: true } });
    return { ok: true };
  });
}

export async function updateReplyDraft(draftId: string, workspaceId: string, body: string) {
  const draft = await getReplyDraft(draftId, workspaceId);
  if (!draft) return null;
  return prisma.outreachMessage.update({ where: { id: draft.id }, data: { body: body.trim().slice(0, 8000) } });
}

/** «🙋 Отвечу сам»: черновик Claude удаляется, переписка остаётся. */
export async function dropReplyDraft(draftId: string, workspaceId: string) {
  const draft = await getReplyDraft(draftId, workspaceId);
  if (!draft) return null;
  await prisma.outreachMessage.delete({ where: { id: draft.id } });
  return draft;
}
