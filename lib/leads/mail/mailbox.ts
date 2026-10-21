// Почта для писем клиентам по паролю приложения: отправка через SMTP, ответы —
// из «Входящих» по IMAP. Почта определяется по домену адреса. Outlook и
// Hotmail не подходят: Microsoft пускает сторонние программы только через OAuth.

import crypto from "node:crypto";
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import nodemailer, { type Transporter } from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import MailComposer from "nodemailer/lib/mail-composer";
import type { MailAccount } from "./account";

export type MailProviderId = "yandex" | "mailru" | "gmail";

export interface MailProvider {
  id: MailProviderId;
  label: string;
  domains: string[];
  smtp: string;
  imap: string;
  /** Как получить пароль приложения — для подсказки в боте. */
  howTo: string[];
}

export const MAIL_PROVIDERS: MailProvider[] = [
  {
    id: "yandex",
    label: "Яндекс Почта",
    domains: ["yandex.ru", "ya.ru", "yandex.com", "yandex.by", "yandex.kz", "narod.ru"],
    smtp: "smtp.yandex.ru",
    imap: "imap.yandex.ru",
    howTo: [
      "1. В Почте: «Настройки» → «Почтовые программы» → включи «С сервера imap.yandex.ru по протоколу IMAP» и способ авторизации «Пароли приложений и OAuth-токены».",
      "2. Открой id.yandex.ru/security/app-passwords → «Почта» → придумай название «Tandem» → «Создать».",
      "3. Пришли сюда пароль, который покажет Яндекс.",
    ],
  },
  {
    id: "mailru",
    label: "Mail.ru",
    domains: ["mail.ru", "bk.ru", "list.ru", "inbox.ru", "internet.ru"],
    smtp: "smtp.mail.ru",
    imap: "imap.mail.ru",
    howTo: [
      "1. Открой id.mail.ru → «Безопасность» → «Пароли для внешних приложений» → «Добавить».",
      "2. Название — «Tandem», доступ — полный (IMAP и SMTP) → «Продолжить».",
      "3. Пришли сюда пароль, который покажет Mail.ru.",
    ],
  },
  {
    id: "gmail",
    label: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    smtp: "smtp.gmail.com",
    imap: "imap.gmail.com",
    howTo: [
      "1. Включи двухэтапную проверку: myaccount.google.com/signinoptions/twosv",
      "2. Открой myaccount.google.com/apppasswords, введи название «Tandem» и нажми «Создать».",
      "3. Пришли сюда 16 букв, которые покажет Google.",
    ],
  },
];

export function providerOf(email: string): MailProvider | null {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return MAIL_PROVIDERS.find((p) => p.domains.includes(domain)) ?? null;
}

const providerFor = (account: MailAccount): MailProvider => {
  const p = providerOf(account.user);
  if (!p) throw new Error(`почта ${account.user.split("@")[1]} не поддерживается`);
  return p;
};

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

// MAIL_SMTP_HOST / MAIL_IMAP_HOST — только для тестов (scripts/leads-e2e.ts), чтобы не ходить в настоящую почту
export function smtpTransport(account: MailAccount): Transporter {
  const host = process.env.MAIL_SMTP_HOST || providerFor(account).smtp;
  return nodemailer.createTransport({ host, port: 465, secure: true, auth: { user: account.user, pass: account.pass } });
}

const imapClient = (account: MailAccount) =>
  new ImapFlow({ host: process.env.MAIL_IMAP_HOST || providerFor(account).imap, port: 993, secure: true, auth: { user: account.user, pass: account.pass }, logger: false });

/**
 * Отправка; возвращает Message-ID — по нему потом найдётся ответ клиента.
 * Gmail сам кладёт копию в «Отправленные», Mail.ru и Яндекс — нет: кладём её
 * сами по IMAP (если почта всё же положила копию — второй не будет).
 * transport — только для тестов: тогда копию не кладём.
 */
export async function sendMail(account: MailAccount, mail: OutgoingMail, transport?: Transporter): Promise<string> {
  const options: Mail.Options = {
    from: account.name ? { name: account.name, address: account.user } : account.user,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    inReplyTo: mail.inReplyTo,
    references: mail.references,
    messageId: `<${crypto.randomUUID()}@${account.user.split("@")[1]}>`,
    date: new Date(),
  };
  const info = await (transport ?? smtpTransport(account)).sendMail(options);
  if (!transport && providerFor(account).id !== "gmail") {
    await saveToSent(account, options).catch((err) => console.error("Copy to Sent failed:", (err as Error).message));
  }
  return info.messageId || String(options.messageId);
}

/** Копия отправленного письма в папку «Отправленные» (то же письмо, тот же Message-ID). */
export async function saveToSent(account: MailAccount, options: Mail.Options) {
  const raw = await new MailComposer(options).compile().build();
  const client = imapClient(account);
  await client.connect();
  try {
    const boxes = await client.list();
    const sent = boxes.find((b) => b.specialUse === "\\Sent") ?? boxes.find((b) => /^(sent|отправленные)$/i.test(b.name));
    if (!sent) throw new Error("нет папки «Отправленные»");
    const lock = await client.getMailboxLock(sent.path);
    try {
      const found = await client.search({ header: { "message-id": String(options.messageId) } }, { uid: true });
      if (!found || !found.length) await client.append(sent.path, raw, ["\\Seen"], options.date as Date);
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => void 0);
  }
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
  const bounce = m.headers.has("x-failed-recipients") || /^(mailer-daemon|postmaster)@/.test(from ?? "");
  let failed = header(m, "x-failed-recipients")
    .split(/[,\s]+/)
    .filter((a) => a.includes("@"));
  if (bounce && !failed.length) {
    // Яндекс и Mail.ru пишут адрес только в самом отчёте: «Final-Recipient: rfc822; a@b.ru»
    const report = [m.text ?? "", ...m.attachments.filter((a) => /delivery-status/i.test(a.contentType)).map((a) => a.content.toString("utf8"))].join("\n");
    failed = [...new Set([...report.matchAll(/(?:final|original)-recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+)/gi)].map((x) => x[1]!.toLowerCase()))];
  }
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
    bounce,
    failedRecipients: failed,
  };
}
