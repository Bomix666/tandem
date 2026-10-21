import { simpleParser } from "mailparser";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, normalizeAppPassword, normalizeMailbox } from "../mail/account";
import { providerOf, toIncoming } from "../mail/mailbox";
import { replySubject, stripQuoted } from "../mail/inbox";
import { buildReplyPrompt, parseReply } from "../mail/reply";
import { makeLeadRow } from "./helpers";

describe("почта: подключение", () => {
  it("пароль приложения шифруется и расшифровывается только тем же секретом", () => {
    process.env.SESSION_SECRET = "test-secret";
    const stored = encryptSecret("abcdefghijklmnop");
    expect(stored).not.toContain("abcdefghijklmnop");
    expect(decryptSecret(stored)).toBe("abcdefghijklmnop");
    process.env.SESSION_SECRET = "другой секрет";
    expect(decryptSecret(stored)).toBeNull(); // секрет сменился — Gmail подключают заново
  });

  it("почта по домену: Яндекс, Mail.ru, Gmail — да; Outlook — нет", () => {
    expect(normalizeMailbox(" Studio.Mail@Yandex.ru ")).toBe("studio.mail@yandex.ru");
    expect(providerOf("studio@ya.ru")).toMatchObject({ id: "yandex", smtp: "smtp.yandex.ru", imap: "imap.yandex.ru" });
    expect(providerOf("studio@bk.ru")).toMatchObject({ id: "mailru", smtp: "smtp.mail.ru", imap: "imap.mail.ru" });
    expect(providerOf("studio@gmail.com")?.id).toBe("gmail");
    expect(normalizeMailbox("studio@outlook.com")).toBeNull(); // Microsoft пускает только через OAuth
    expect(normalizeMailbox("не адрес")).toBeNull();
  });

  it("пароль приложения: у Google — 16 букв (пробелы убираем), у Яндекса и Mail.ru — строка без пробелов", () => {
    expect(normalizeAppPassword("gmail", "abcd efgh ijkl mnop")).toBe("abcdefghijklmnop");
    expect(normalizeAppPassword("gmail", "abcd1234")).toBeNull();
    expect(normalizeAppPassword("yandex", "qwertyuiopasdfgh")).toBe("qwertyuiopasdfgh");
    expect(normalizeAppPassword("mailru", "Ab3dEf6hIj9kLm2nOp4q")).toBe("Ab3dEf6hIj9kLm2nOp4q");
    expect(normalizeAppPassword("mailru", "мой пароль")).toBeNull();
  });
});

describe("почта: входящие", () => {
  it("ответ без цитаты нашего письма: Gmail, Mail.ru, Outlook, «>»", () => {
    expect(stripQuoted("Интересно, сколько стоит?\n\nпн, 20 окт. 2026 г. в 12:00, Studio <studio@gmail.com>:\n> Добрый день!")).toBe("Интересно, сколько стоит?");
    expect(stripQuoted("Да, давайте.\nПонедельник, 20 октября 2026, 12:00 +03:00 от Studio <studio@gmail.com>:\nДобрый день!")).toBe("Да, давайте.");
    expect(stripQuoted("Нет, спасибо\r\n\r\nFrom: Studio <studio@gmail.com>\r\nSent: Monday")).toBe("Нет, спасибо");
    expect(stripQuoted("> только цитата")).toBe("> только цитата"); // нечего отрезать — оставляем как есть
    expect(replySubject("Сайт для «Лавки»")).toBe("Re: Сайт для «Лавки»");
    expect(replySubject("RE: Сайт")).toBe("RE: Сайт");
  });

  it("заголовки письма: переписка, автоответ, недоставка", async () => {
    const raw = (headers: string) => `${headers}\r\nSubject: Re: Сайт\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nТекст\r\n`;
    const reply = toIncoming(7, await simpleParser(raw("From: Иван <Info@Lavka.ru>\r\nMessage-ID: <r1@lavka.ru>\r\nIn-Reply-To: <m1@gmail.com>\r\nReferences: <m0@gmail.com> <m1@gmail.com>")));
    expect(reply).toMatchObject({ uid: 7, from: "info@lavka.ru", messageId: "<r1@lavka.ru>", inReplyTo: "<m1@gmail.com>", references: ["<m0@gmail.com>", "<m1@gmail.com>"], auto: false, bounce: false, text: "Текст" });
    const auto = toIncoming(8, await simpleParser(raw("From: info@lavka.ru\r\nAuto-Submitted: auto-replied")));
    expect(auto.auto).toBe(true);
    const bounce = toIncoming(9, await simpleParser(raw("From: Mail Delivery Subsystem <mailer-daemon@googlemail.com>\r\nX-Failed-Recipients: info@lavka.ru")));
    expect(bounce).toMatchObject({ bounce: true, failedRecipients: ["info@lavka.ru"] });
    // Яндекс: без X-Failed-Recipients, адрес — только в отчёте о доставке
    const dsn = [
      "From: mailer-daemon@yandex.ru",
      "Subject: Недоставленное сообщение",
      'Content-Type: multipart/report; report-type=delivery-status; boundary="b"',
      "",
      "--b",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Сообщение не доставлено.",
      "--b",
      "Content-Type: message/delivery-status",
      "",
      "Reporting-MTA: dns; mail.yandex.ru",
      "",
      "Final-Recipient: rfc822; Info@Lavka.ru",
      "Action: failed",
      "--b--",
      "",
    ].join("\r\n");
    expect(toIncoming(10, await simpleParser(dsn))).toMatchObject({ bounce: true, failedRecipients: ["info@lavka.ru"] });
  });
});

describe("почта: ответ от Claude", () => {
  const sender = { name: "Александр", company: "MRAK8", contact: "@finskiiy" };

  it("промпт: факты о бизнесе, цены из настроек, переписка", () => {
    const thread = [
      { direction: "OUT" as const, body: "Добрый день! Посмотрел ваш сайт…", at: new Date("2026-10-20") },
      { direction: "IN" as const, body: "Сколько стоит?", at: new Date("2026-10-21") },
    ];
    const p = buildReplyPrompt({ lead: makeLeadRow(), sender, pricing: "Лендинг — от 30 000 ₽", thread });
    expect(p).toContain("<business>");
    expect(p).toContain("Лендинг — от 30 000 ₽");
    expect(p).toContain('<message from="клиент" date="2026-10-21">\nСколько стоит?');
    expect(buildReplyPrompt({ lead: makeLeadRow(), sender, pricing: null, thread })).toContain("не указано — цены и сроки не называй");
  });

  it("ответ: подпись добавляется сама, на отказ и автоответ не отвечаем", () => {
    const ok = parseReply(JSON.stringify({ intent: "price", reply: "Спасибо за ответ! Лендинг — от 30 000 ₽, давайте созвонимся.", handoff: "просит точную цену" }), sender);
    expect(ok.body).toBe("Спасибо за ответ! Лендинг — от 30 000 ₽, давайте созвонимся.\n\n—\nАлександр, MRAK8\nTelegram для связи: https://t.me/finskiiy");
    expect(ok.handoff).toBe("просит точную цену");
    expect(parseReply(JSON.stringify({ intent: "refusal", reply: "", handoff: "" }), sender)).toEqual({ intent: "refusal", body: null, handoff: null });
    expect(() => parseReply(JSON.stringify({ intent: "question", reply: "Здравствуйте, [Имя]! Расскажу подробнее.", handoff: "" }), sender)).toThrow();
  });
});
