// Ссылка «📨 Открыть почту» из Telegram. Кнопки бота открывают только
// http(s), поэтому mailto: отдаёт страница приложения /go/mail/<id>.
// Ссылка подписана (HMAC): без подписи по id чужой черновик не открыть.

import crypto from "node:crypto";

function secret(): string {
  return process.env.OUTREACH_LINK_SECRET || process.env.CRON_SECRET || process.env.TELEGRAM_BOT_TOKEN || "";
}

export function signOutreachLink(id: string): string {
  return crypto.createHmac("sha256", `outreach-link:${secret()}`).update(id).digest("hex").slice(0, 24);
}

export function verifyOutreachLink(id: string, token: string | null): boolean {
  if (!token || !secret()) return false;
  const expected = Buffer.from(signOutreachLink(id));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

/** Адрес страницы письма; null — адрес приложения не настроен. */
export function outreachMailUrl(id: string): string | null {
  const base = (process.env.APP_URL || process.env.TELEGRAM_WEBAPP_URL || "").trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(base) || !secret()) return null;
  return `${base}/go/mail/${id}?t=${signOutreachLink(id)}`;
}
