// «Отправители» обращений — сейчас только ручные: готовят ссылку, по которой
// пользователь сам открывает почту или мессенджер, и текст для копирования.
// Ничего не отправляют. Почтовый сервис (SMTP/API) подключится сюда же как
// OutreachSender с mode: "auto" и отдельным подтверждением пользователя.

import type { OutreachChannel } from "@prisma/client";
import type { ManualHandoff, OutreachSender } from "./types";

// ponytail: 8000 — с запасом под лимит длины ссылки у почтовых программ и серверов Outlook.
// Кириллица в ссылке занимает ~6 символов на букву, поэтому прежние 1800 не вмещали даже короткое
// письмо. Длиннее — ссылка без текста; страница письма копирует его в буфер при нажатии.
const LINK_LIMIT = 8000;

function mailto(recipient: string | null, subject: string | null | undefined, body: string): string | null {
  if (!recipient) return null;
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  params.set("body", body);
  const url = `mailto:${encodeURIComponent(recipient).replace(/%40/g, "@")}?${params.toString().replace(/\+/g, "%20")}`;
  if (url.length <= LINK_LIMIT) return url;
  return subject ? `mailto:${recipient}?subject=${encodeURIComponent(subject)}` : `mailto:${recipient}`;
}

// Outlook в браузере mailto: не перехватывает — у него своя ссылка на новое письмо:
// личная почта (@outlook.com, @hotmail.com) и рабочая Microsoft 365 — на разных адресах.
const OUTLOOK_COMPOSE = {
  personal: "https://outlook.live.com/mail/0/deeplink/compose",
  work: "https://outlook.office.com/mail/deeplink/compose",
};

export function outlookComposeUrl(kind: keyof typeof OUTLOOK_COMPOSE, recipient: string | null, subject: string | null | undefined, body: string): string | null {
  if (!recipient) return null;
  const params = new URLSearchParams({ to: recipient });
  if (subject) params.set("subject", subject);
  const link = () => `${OUTLOOK_COMPOSE[kind]}?${params.toString().replace(/\+/g, "%20")}`;
  const short = link();
  params.set("body", body);
  const full = link();
  return full.length <= LINK_LIMIT ? full : short;
}

export const manualSenders: Record<OutreachChannel, OutreachSender> = {
  EMAIL: {
    channel: "EMAIL",
    mode: "manual",
    prepare: ({ recipient, subject, body }): ManualHandoff => ({
      url: mailto(recipient, subject, body),
      copyText: body,
      hint: recipient ? "Откроется твоя почта с готовым письмом — проверь и отправь сам." : "Email не найден — скопируй текст и отправь удобным способом.",
    }),
  },
  TELEGRAM: {
    channel: "TELEGRAM",
    mode: "manual",
    prepare: ({ recipient, body }) => ({
      url: recipient,
      copyText: body,
      hint: "Скопируй текст, открой чат и отправь сам.",
    }),
  },
  WHATSAPP: {
    channel: "WHATSAPP",
    mode: "manual",
    prepare: ({ recipient, body }) => {
      const digits = recipient?.replace(/\D/g, "") ?? "";
      return {
        url: digits ? `https://wa.me/${digits}?text=${encodeURIComponent(body)}` : recipient,
        copyText: body,
        hint: "Откроется WhatsApp с готовым текстом — отправь сам.",
      };
    },
  },
  SOCIAL: {
    channel: "SOCIAL",
    mode: "manual",
    prepare: ({ recipient, body }) => ({
      url: recipient,
      copyText: body,
      hint: "Скопируй текст и напиши в сообщения сообщества.",
    }),
  },
};
