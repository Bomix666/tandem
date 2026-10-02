import { describe, expect, it } from "vitest";
import { pickRecipient } from "../outreach";
import { manualSenders } from "../outreach/senders";
import { templateOutreachGenerator } from "../outreach/template";
import { buildLeadFacts } from "../proposal";
import { makeLeadRow } from "./helpers";

const facts = buildLeadFacts(makeLeadRow());

describe("тексты обращений по каналам", () => {
  it("email: тема, текст по фактам, подпись — только заполненное пользователем", async () => {
    const t = await templateOutreachGenerator.generate({ channel: "EMAIL", facts, variant: 0, sender: { name: "Никита", portfolioUrl: "https://site.ru/works" } });
    expect(t.subject).toContain("Black Barber");
    expect(t.body.startsWith("Здравствуйте!")).toBe(true);
    expect(t.body.endsWith("—\nНикита\nПортфолио: https://site.ru/works")).toBe(true);
    expect(t.warnings).toEqual([]);
  });

  it("без имени — предупреждение, а не заглушка в тексте", async () => {
    const t = await templateOutreachGenerator.generate({ channel: "EMAIL", facts, variant: 0, sender: {} });
    expect(t.body).not.toMatch(/\[|ваше имя/i);
    expect(t.warnings[0]).toContain("нет имени");
  });

  it("мессенджеры — короче письма, другой вариант — другая формулировка", async () => {
    const email = await templateOutreachGenerator.generate({ channel: "EMAIL", facts, variant: 0, sender: { name: "Никита" } });
    const tg0 = await templateOutreachGenerator.generate({ channel: "TELEGRAM", facts, variant: 0, sender: { name: "Никита" } });
    const tg1 = await templateOutreachGenerator.generate({ channel: "TELEGRAM", facts, variant: 1, sender: { name: "Никита" } });
    expect(tg0.subject).toBeUndefined();
    expect(tg0.body.length).toBeLessThan(email.body.length);
    expect(tg0.body).toContain("Меня зовут Никита");
    expect(tg1.body).not.toBe(tg0.body);
  });
});

describe("кому писать и ручная отправка", () => {
  it("email: лучший не-🔴 контакт; телефон — для WhatsApp", () => {
    const lead = {
      ...makeLeadRow({ phones: ["+7 495 111-11-01"] }),
      contacts: [
        { id: "c1", kind: "EMAIL", value: "bad@dead.ru", verification: "INVALID", isPrimary: false },
        { id: "c2", kind: "EMAIL", value: "hello@bb.ru", verification: "UNVERIFIED", isPrimary: true },
      ],
    } as unknown as Parameters<typeof pickRecipient>[0];
    expect(pickRecipient(lead, "EMAIL")).toEqual({ recipient: "hello@bb.ru", contactId: "c2" });
    expect(pickRecipient(lead, "WHATSAPP").recipient).toBe("+7 495 111-11-01");
  });

  it("отправители только готовят ссылку и текст — ничего не отправляют", () => {
    const mail = manualSenders.EMAIL.prepare({ recipient: "hello@bb.ru", subject: "Сайт", body: "Привет & пока" });
    expect(mail.url).toBe("mailto:hello@bb.ru?subject=%D0%A1%D0%B0%D0%B9%D1%82&body=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82%20%26%20%D0%BF%D0%BE%D0%BA%D0%B0");
    expect(manualSenders.EMAIL.mode).toBe("manual");
    expect(manualSenders.EMAIL.prepare({ recipient: null, body: "x" }).url).toBeNull();
    expect(manualSenders.WHATSAPP.prepare({ recipient: "+7 (495) 111-11-01", body: "Привет" }).url).toBe("https://wa.me/74951111101?text=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82");
    // слишком длинное письмо не влезает в mailto — открываем почту только с темой, текст копируется
    const long = manualSenders.EMAIL.prepare({ recipient: "a@b.ru", subject: "Тема", body: "я".repeat(2000) });
    expect(long.url).toBe("mailto:a@b.ru?subject=%D0%A2%D0%B5%D0%BC%D0%B0");
  });
});
