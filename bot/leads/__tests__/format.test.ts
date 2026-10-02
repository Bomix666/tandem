import { describe, expect, it } from "vitest";
import type { LeadWithTasks } from "../../../lib/leads/repository";
import { makeAudit, makeLeadRow } from "../../../lib/leads/__tests__/helpers";
import { leadCardKeyboard, numberFromNav, parseMoney, plural, renderLeadCard, wizardConfirmView } from "../format";

const lead = (overrides = {}): LeadWithTasks => ({ ...makeLeadRow(overrides), tasks: [], contacts: [], outreach: [] }) as LeadWithTasks;

describe("карточка лида", () => {
  it("показывает отсутствующие данные честно: «Не найден»", () => {
    const text = renderLeadCard(lead({ emails: [] }), { number: 1 });
    expect(text).toContain("🔥 <b>LEAD #1</b> · <b>84</b>/100");
    expect(text).toContain("📧 <b>Email</b>\nНе найден");
    expect(text).toContain("🌐 <b>Сайт</b>\n❌ Не найден");
    expect(text).toContain("🎯 <b>Lead Score</b> 84/100");
    expect(text).toContain("<b>СТАТУС</b>  🆕 Новый");
    expect(text).toContain('<a href="https://instagram.com/blackbarber">Instagram</a>');
    expect(text).toContain("📍 Москва, Тверская улица, 7");
  });

  it("экранирует HTML в данных из внешних источников", () => {
    const text = renderLeadCard(lead({ name: "<b>Хак</b> & Co" }));
    expect(text).toContain("&lt;b&gt;Хак&lt;/b&gt; &amp; Co");
  });

  it("сайт с проблемами — перечисляет проверенные проблемы", () => {
    const text = renderLeadCard(
      lead({ websiteKind: "own", website: "http://old.ru/", domain: "old.ru", siteAudit: makeAudit({ hasViewport: false, https: false }) })
    );
    expect(text).toContain('<a href="http://old.ru/">old.ru</a> — ⚠️ нет адаптации под телефон, без HTTPS');
  });

  it("кнопки карточки укладываются в лимит Telegram (64 байта)", () => {
    const kb = leadCardKeyboard(lead({ id: "c".repeat(25) }), { label: "Следующий ›", data: `ld:nx:s:${"s".repeat(25)}:12` });
    for (const row of kb.inline_keyboard) {
      for (const b of row) if ("callback_data" in b) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
    }
  });

  it("состояние работы: задача, follow-up, обращение", () => {
    const row = {
      ...makeLeadRow(),
      saved: true,
      tasks: [
        { kind: "CONTACT", task: { id: "t1", title: "Связаться", createdAt: new Date(), status: "TODO", deadlineAt: new Date() } },
        { kind: "FOLLOW_UP", task: { id: "t2", title: "Follow-up", createdAt: new Date(), status: "TODO", deadlineAt: new Date("2026-10-05T07:00:00Z") } },
      ],
      contacts: [],
      outreach: [{ channel: "EMAIL", status: "WAITING", sentAt: new Date("2026-10-02T09:00:00Z") }],
    } as unknown as LeadWithTasks;
    const text = renderLeadCard(row);
    expect(text).toContain("❤️ сохранён · 📋 задача · ⏰ follow-up 05.10");
    expect(text).toContain("📧 Email: ⏳ Ждём ответа 02.10");
    const labels = leadCardKeyboard(row, { label: "Следующий ›", data: "ld:nx:m:a:x" }).inline_keyboard.flat().map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["✨ Подготовить письмо", "✅ Задача есть", "⏰ Follow-up ✓", "💔 Убрать"]));
  });
});

describe("мелочи форматирования", () => {
  it("parseMoney", () => {
    expect(parseMoney("50000")).toBe(50000);
    expect(parseMoney("50 000 ₽")).toBe(50000);
    expect(parseMoney("50к")).toBe(50000);
    expect(parseMoney("1,5 тыс")).toBe(1500);
    expect(parseMoney("много")).toBeNull();
    expect(parseMoney("0")).toBeNull();
  });
  it("plural", () => {
    expect(plural(1, ["лид", "лида", "лидов"])).toBe("лид");
    expect(plural(3, ["лид", "лида", "лидов"])).toBe("лида");
    expect(plural(11, ["лид", "лида", "лидов"])).toBe("лидов");
    expect(plural(21, ["лид", "лида", "лидов"])).toBe("лид");
  });
  it("номер лида берётся из кнопки навигации", () => {
    expect(numberFromNav({ label: "", data: "ld:nx:s:abc:3" })).toBe(3);
    expect(numberFromNav({ label: "", data: "ld:nx:m:a:abc" })).toBeUndefined();
  });
  it("мастер: основной поиск — OpenStreetMap, Яндекс — только тестовая кнопка при наличии ключа", () => {
    const draft = { niche: "Барбершопы", city: "Москва", requested: 10, extra: null };
    const data = (yandex: boolean) =>
      wizardConfirmView(draft, { yandex, osm: true }).kb.inline_keyboard.flat().map((b) => ("callback_data" in b ? b.callback_data : ""));
    expect(wizardConfirmView(draft, { yandex: false, osm: true }).text).toContain("OpenStreetMap");
    expect(data(false)).toEqual(["ld:w:go", "ld:w:x"]);
    expect(data(true)).toEqual(["ld:w:go", "ld:w:ya", "ld:w:x"]);
  });
});
