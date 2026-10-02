import { describe, expect, it } from "vitest";
import type { Analytics } from "../../../lib/leads/analytics";
import type { Dashboard } from "../../../lib/leads/dashboard";
import type { OutreachWithLead } from "../../../lib/leads/outreach";
import { analyticsView, copyView, dashboardView, outreachEditorView, outreachOverviewView } from "../sales-views";
import { table } from "../ui";

const NOW = new Date("2026-10-03T09:00:00Z");
const ID = "c".repeat(25);

const dashboard = (over: Partial<Dashboard> = {}): Dashboard => ({
  today: { newLeads: 12, toProcess: 5, followUps: 3, replies: 2, hot: 1 },
  pipeline: { fresh: 24, toContact: 11, waiting: 7, negotiation: 4, clients: 2 },
  outreachToday: { drafted: 12, sent: 5, replies: 3 },
  followUps: { overdue: 1, today: 2, later: 4 },
  next: { kind: "send", outreachId: ID, leadId: ID, name: "Black Barber" },
  ...over,
});

const outreach = (over: Partial<OutreachWithLead> = {}): OutreachWithLead =>
  ({
    id: ID,
    workspaceId: "ws",
    leadId: ID,
    createdById: null,
    channel: "EMAIL",
    status: "DRAFT",
    recipient: "info@company.ru",
    contactId: "k",
    subject: "Предложение по сайту",
    body: "Здравствуйте!\n\nОбратил внимание на ваш барбершоп <Black Barber>.",
    generator: "template",
    variant: 0,
    sentAt: null,
    repliedAt: null,
    followUpAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    lead: { id: ID, name: "Black Barber", status: "TO_CONTACT", city: "Москва" },
    contact: { verification: "VALID" },
    ...over,
  }) as unknown as OutreachWithLead;

const callbacks = (kb: { inline_keyboard: object[][] }) =>
  kb.inline_keyboard.flat().flatMap((b) => ("callback_data" in b && typeof b.callback_data === "string" ? [b.callback_data] : []));

describe("дашборд Sales OS", () => {
  it("реальные цифры таблицей и ближайшее действие", () => {
    const v = dashboardView(dashboard(), NOW, "https://app.test");
    expect(v.text).toContain("🚀 <b>SALES OS</b> · 03.10.2026");
    expect(v.text).toMatch(/Нужно связаться\s+11\n/);
    expect(v.text).toContain("12 подготовлено · 5 отправлено · 3 ответа");
    expect(v.text).toContain("<b>Black Barber</b>\n→ отправить предложение");
    expect(callbacks(v.kb)).toContain(`os:o:${ID}`);
    expect(JSON.stringify(v.kb.inline_keyboard)).toContain("https://app.test");
  });

  it("нечего делать — предлагает поиск, без кнопки «Открыть»", () => {
    const v = dashboardView(dashboard({ next: null }), NOW);
    expect(v.text).toContain("Срочных дел нет");
    expect(v.kb.inline_keyboard.flat().map((b) => b.text)).not.toContain("⚡ Открыть");
  });
});

describe("редактор обращения", () => {
  it("черновик: кому с проверкой, тема, текст экранирован, кнопки ТЗ, ссылка почты", () => {
    const v = outreachEditorView(outreach(), { warnings: [], engine: "шаблон", mailUrl: "https://app.test/go/mail/x?t=1" });
    expect(v.text).toContain("📧 <b>EMAIL</b> · 📝 Черновик");
    expect(v.text).toContain("Кому: 🟢 info@company.ru");
    expect(v.text).toContain("&lt;Black Barber&gt;");
    const labels = v.kb.inline_keyboard.flat().map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["✏️ Редактировать", "📋 Копировать", "📨 Открыть почту", "🔄 Другой вариант", "✅ Я отправил", "❌ Отмена"]));
  });

  it("после отправки — не правится; доступны ответ, follow-up, итог", () => {
    const v = outreachEditorView(outreach({ status: "WAITING", sentAt: NOW, followUpAt: NOW }), { warnings: ["нет имени"], engine: "шаблон", mailUrl: null });
    const labels = v.kb.inline_keyboard.flat().map((b) => b.text);
    expect(labels).not.toContain("✏️ Редактировать");
    expect(labels).toEqual(expect.arrayContaining(["👀 Ответили", "⏰ Follow-up", "🤝 Клиент", "❌ Отказ"]));
    expect(v.text).not.toContain("нет имени"); // предупреждения — только для черновика
  });

  it("WhatsApp — ссылка wa.me с текстом", () => {
    const v = outreachEditorView(outreach({ channel: "WHATSAPP", recipient: "+7 (495) 111-11-01", subject: null }), { warnings: [], engine: "шаблон", mailUrl: null });
    const btn = v.kb.inline_keyboard.flat().find((b) => b.text === "📱 Открыть WhatsApp") as { url?: string } | undefined;
    expect(btn?.url).toMatch(/^https:\/\/wa\.me\/74951111101\?text=/);
  });

  it("копирование: адрес и тема кнопками, текст в блоке", () => {
    const v = copyView(outreach());
    expect(v.text).toContain("<pre>Здравствуйте!");
    expect(JSON.stringify(v.kb.inline_keyboard)).toContain('"copy_text":{"text":"info@company.ru"}');
  });

  it("все кнопки укладываются в 64 байта", () => {
    const views = [
      outreachEditorView(outreach(), { warnings: [], engine: "", mailUrl: null }),
      outreachEditorView(outreach({ status: "SENT", sentAt: NOW }), { warnings: [], engine: "", mailUrl: null }),
      outreachOverviewView({ DRAFT: 1, READY: 0, SENT: 0, WAITING: 0, REPLIED: 0, FOLLOW_UP: 0, REJECTED: 0, CLIENT: 0 }, { drafted: 0, sent: 0, replies: 0 }),
      dashboardView(dashboard({ next: { kind: "followup", taskId: ID, leadId: ID, name: "x", at: NOW, overdue: true } }), NOW),
    ];
    for (const v of views) for (const d of callbacks(v.kb)) expect(Buffer.byteLength(d)).toBeLessThanOrEqual(64);
  });
});

describe("аналитика", () => {
  it("коэффициенты и «—», когда не из чего считать", () => {
    const a: Analytics = {
      period: 30,
      total: 120,
      found: 120,
      saved: 30,
      contacted: 18,
      replied: 6,
      negotiation: 4,
      clients: 2,
      rejected: 3,
      outreach: { drafted: 20, sent: 18, replies: 6 },
      rates: { contact: 0.15, reply: 1 / 3, conversion: 2 / 18 },
      avgCheck: 50000,
    };
    const v = analyticsView(a);
    expect(v.text).toContain("за 30 дней");
    expect(v.text).toContain("Contact rate     15%");
    expect(v.text).toContain("Reply rate       33%");
    expect(v.text.replace(/\s/g, " ")).toContain("100 000 ₽");
    expect(analyticsView({ ...a, rates: { contact: null, reply: null, conversion: null } }).text).toMatch(/Reply rate\s+—\n/);
  });

  it("таблица выравнивает числа по правому краю", () => {
    expect(table([["А", 1], ["Длинная подпись", 120]])).toBe("<pre>А                  1\nДлинная подпись  120</pre>");
  });
});
