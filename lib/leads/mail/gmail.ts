// Gmail по паролю приложения: отправка через SMTP, ответы — из «Входящих» по
// IMAP. Отправленное SMTP-письмо Gmail сам кладёт в «Отправленные», так что
// вся переписка видна и в самом ящике.

import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import nodemailer, { type Transporter } from "nodemailer";
import type { MailAccount } from "./account";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  /** Ответ в переписке: Message-ID письма, на которое отвечаем, и вся цепочка. */
  inReplyTo?: string;
  references?: string[];
}

/** Письмо из «Входящих» в том виде, который нужен для переписки. */
export interface IncomingMail {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: string | null;
  subject: string | null;
  text: string;
  date: Date;
  /** Автоответ («я в отпуске») или рассылка — не ответ человека. */
  auto: boolean;
  /** Отчёт о недоставке (mailer-daemon) и на какие адреса письмо не дошло. */
  bounce: boolean;
  failedRecipients: string[];
}

// GMAIL_SMTP_HOST / GMAIL_IMAP_HOST — только для тестов (scripts/leads-e2e.ts), чтобы не ходить в настоящий Gmail
export function smtpTransport(account: MailAccount): Transporter {
  const host = process.env.GMAIL_SMTP_HOST || "smtp.gmail.com";
  return nodemailer.createTransport({ host, port: 465, secure: true, auth: { user: account.user, pass: account.pass } });
}

const imapClient = (account: MailAccount) =>
  new ImapFlow({ host: process.env.GMAIL_IMAP_HOST || "imap.gmail.com", port: 993, secure: true, auth: { user: account.user, pass: account.pass }, logger: false });

/** Отправка; возвращает Message-ID — по нему потом найдётся ответ клиента. */
export async function sendMail(account: MailAccount, mail: OutgoingMail, transport: Transporter = smtpTransport(account)): Promise<string> {
  const info = await transport.sendMail({
    from: account.name ? { name: account.name, address: account.user } : account.user,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
  });
  return info.messageId;
}

/**
 * Проверка пароля: вход в SMTP и IMAP. Возвращает номер последнего письма во
 * «Входящих» — старые письма при подключении не разбираем.
 */
export async function verifyAccount(account: MailAccount): Promise<number> {
  await smtpTransport(account).verify();
  const client = imapClient(account);
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      return client.mailbox ? client.mailbox.uidNext - 1 : 0;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => void 0);
  }
}

const MAX_PER_POLL = 50;

/** Новые письма во «Входящих» после lastUid (флаги «прочитано» не трогаем). */
export async function fetchNewMail(account: MailAccount, lastUid: number): Promise<{ mails: IncomingMail[]; lastUid: number }> {
  const client = imapClient(account);
  await client.connect();
  const mails: IncomingMail[] = [];
  let maxUid = lastUid;
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      // «N:*» всегда отдаёт хотя бы последнее письмо, даже старое, — отсекаем по uid
      for await (const msg of client.fetch(`${lastUid + 1}:*`, { uid: true, source: true }, { uid: true })) {
        if (msg.uid <= lastUid || !msg.source) continue;
        maxUid = Math.max(maxUid, msg.uid);
        mails.push(toIncoming(msg.uid, await simpleParser(msg.source)));
        if (mails.length >= MAX_PER_POLL) break;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => void 0);
  }
  return { mails, lastUid: maxUid };
}

const header = (m: ParsedMail, name: string) => {
  const v = m.headers.get(name);
  return typeof v === "string" ? v.toLowerCase() : "";
};

export function toIncoming(uid: number, m: ParsedMail): IncomingMail {
  const from = m.from?.value[0]?.address?.toLowerCase() ?? null;
  const refs = m.references ? (Array.isArray(m.references) ? m.references : [m.references]) : [];
  const auto =
    (header(m, "auto-submitted") !== "" && header(m, "auto-submitted") !== "no") ||
    /auto_reply|bulk|junk|list/.test(header(m, "precedence")) ||
    m.headers.has("x-autoreply") ||
    m.headers.has("list-unsubscribe");
  const failed = header(m, "x-failed-recipients")
    .split(/[,\s]+/)
    .filter((a) => a.includes("@"));
  return {
    uid,
    messageId: m.messageId ?? null,
    inReplyTo: m.inReplyTo ?? null,
    references: refs,
    from,
    subject: m.subject ?? null,
    text: (m.text ?? "").trim(),
    date: m.date ?? new Date(),
    auto,
    bounce: failed.length > 0 || /^(mailer-daemon|postmaster)@/.test(from ?? ""),
    failedRecipients: failed,
  };
}
