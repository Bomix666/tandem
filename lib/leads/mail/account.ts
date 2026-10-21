// Почта пространства для писем клиентам (Яндекс, Mail.ru или Gmail): адрес и
// пароль приложения — не пароль от аккаунта, по нему почты сторонние программы
// не пускают. Пароль лежит в БД зашифрованным (AES-256-GCM), ключ — из секрета
// в .env: без .env базу не расшифровать. Сменился секрет — почту подключают заново.
// Поля в БД называются gmail* исторически — в них любая поддерживаемая почта.

import crypto from "node:crypto";
import { prisma } from "../../prisma";
import { providerOf, type MailProviderId } from "./mailbox";

export interface MailAccount {
  user: string;
  pass: string;
  /** Имя отправителя в поле «От» — из подписи. */
  name?: string | null;
}

function key(): Buffer {
  const secret = process.env.MAIL_SECRET || process.env.SESSION_SECRET || process.env.TELEGRAM_BOT_TOKEN || "";
  if (!secret) throw new Error("нет секрета для шифрования пароля Gmail (SESSION_SECRET в .env)");
  return crypto.createHash("sha256").update(`gmail:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

/** null — не расшифровать (секрет в .env сменился или запись испорчена). */
export function decryptSecret(stored: string): string | null {
  try {
    const [iv, tag, data] = stored.split(".").map((p) => Buffer.from(p, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", key(), iv!);
    d.setAuthTag(tag!);
    return Buffer.concat([d.update(data!), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Пароль приложения: у Google — 16 латинских букв группами через пробел, у
 * Яндекса и Mail.ru — строка без пробелов. Точно проверяет только вход в почту.
 */
export function normalizeAppPassword(provider: MailProviderId, input: string): string | null {
  const v = input.replace(/\s+/g, "");
  if (provider === "gmail") return /^[a-z]{16}$/i.test(v) ? v.toLowerCase() : null;
  return /^[\x21-\x7e]{8,64}$/.test(v) ? v : null;
}

/** Адрес поддерживаемой почты (Яндекс, Mail.ru, Gmail) в нижнем регистре. */
export function normalizeMailbox(input: string): string | null {
  const v = input.trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v) && providerOf(v) ? v : null;
}

/** Адрес подключённой почты (без расшифровки пароля) — для кнопки «Отправить письмо». */
export async function mailboxUser(workspaceId: string): Promise<string | null> {
  const s = await prisma.leadSettings.findUnique({ where: { workspaceId }, select: { gmailUser: true, gmailPassword: true } });
  return s?.gmailUser && s.gmailPassword ? s.gmailUser : null;
}

export async function getMailAccount(workspaceId: string): Promise<MailAccount | null> {
  const s = await prisma.leadSettings.findUnique({ where: { workspaceId }, select: { gmailUser: true, gmailPassword: true, senderName: true } });
  if (!s?.gmailUser || !s.gmailPassword) return null;
  const pass = decryptSecret(s.gmailPassword);
  return pass ? { user: s.gmailUser, pass, name: s.senderName } : null;
}

export async function saveMailAccount(workspaceId: string, user: string, pass: string, lastUid: number) {
  const data = { gmailUser: user, gmailPassword: encryptSecret(pass), gmailLastUid: lastUid };
  await prisma.leadSettings.upsert({ where: { workspaceId }, update: data, create: { workspaceId, ...data } });
}

export async function disconnectMailAccount(workspaceId: string) {
  await prisma.leadSettings.updateMany({ where: { workspaceId }, data: { gmailUser: null, gmailPassword: null, gmailLastUid: null } });
}
