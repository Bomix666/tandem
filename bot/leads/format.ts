// Тексты и клавиатуры модуля лидов в Telegram (HTML-разметка).
// Формат callback_data (лимит Telegram — 64 байта):
//   ld:w:*                 мастер поиска
//   ld:nx:s:<search>:<pos> следующий лид подборки (редактирует карточку)
//   ld:o:s:<search>:<pos>  открыть лид подборки новым сообщением
//   ld:nx:m:<f>:<lead>     следующий лид в «Мои лиды» после <lead>
//   ld:ol:<f>:<lead>       открыть лид из списка «Мои лиды»
//   ld:<действие>:<lead>   кнопки карточки

import type { LeadSearch, LeadStatus } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import {
  formatScoreReasons,
  LEAD_STATUS_EMOJI,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_ORDER,
  POTENTIAL_EMOJI,
  POTENTIAL_LABELS,
  statusText,
} from "../../lib/leads/labels";
import { CITY_PRESETS, NICHE_PRESETS } from "../../lib/leads/niches";
import type { LeadWithTasks, LeadFilter } from "../../lib/leads/repository";
import { describeRequirements, parseRequirements, type SearchRequirements } from "../../lib/leads/requirements";
import { socialLabel } from "../../lib/leads/scoring";
import type { SearchProgress } from "../../lib/leads/search";
import type { ScoreReason, SiteAudit, SocialLink, SourceRef } from "../../lib/leads/types";
import type { WizardDraft } from "../state";

const DISPLAY_TZ = process.env.LEADS_TIMEZONE?.trim() || "Europe/Moscow";

export const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}
const leadsWord = (n: number) => `${n} ${plural(n, ["лид", "лида", "лидов"])}`;

export const formatDate = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: DISPLAY_TZ });
export const formatMoney = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

/** «50000», «50 000», «50к», «50 тыс» → 50000. */
export function parseMoney(text: string): number | null {
  const m = text
    .trim()
    .toLowerCase()
    .match(/^(\d[\d\s]*)([.,]\d+)?\s*(к|k|тыс\.?)?\s*(₽|руб\.?|р\.?)?$/);
  if (!m) return null;
  let value = parseFloat(`${m[1]!.replace(/\s/g, "")}${(m[2] ?? "").replace(",", ".")}`);
  if (m[3]) value *= 1000;
  value = Math.round(value);
  return value >= 1 && value <= 100_000_000 ? value : null;
}

export const NO_PREVIEW = { is_disabled: true } as const;

// ---------------- карточка лида ----------------

export interface Nav {
  label: string;
  data: string;
}

/** Номер лида в подборке из кнопки навигации: ld:nx:s:<id>:<следующая позиция> → текущий номер. */
export function numberFromNav(nav: Nav): number | undefined {
  const m = nav.data.match(/^ld:nx:s:[^:]+:(\d+)$/);
  return m ? Number(m[1]) : undefined;
}

function displayAddress(address: string, city: string): string {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const cityLower = city.trim().toLowerCase();
  return parts.filter((p) => p.toLowerCase() !== "россия" && p.toLowerCase() !== cityLower).join(", ");
}

function siteLine(lead: LeadWithTasks): string {
  const audit = lead.siteAudit as unknown as SiteAudit | null;
  const booking = lead.bookingPage as { name: string; url: string } | null;
  if (lead.websiteKind === "own" && lead.website) {
    const link = `<a href="${e(lead.website)}">${e(lead.domain ?? lead.website)}</a>`;
    if (!audit) return `${link} — не проверялся`;
    if (audit.status === "blocked") return `${link} — не удалось проверить${audit.error ? ` (${e(audit.error)})` : ""}`;
    if (audit.status !== "ok") return `${link} — ⚠️ не открывается`;
    const issues: string[] = [];
    if (!audit.hasViewport) issues.push("нет адаптации под телефон");
    if (!audit.hasForm && !audit.bookingWidget) issues.push("нет формы заявки");
    if (!audit.https) issues.push("без HTTPS");
    if (audit.copyrightYear && audit.copyrightYear <= new Date().getFullYear() - 3) issues.push(`© ${audit.copyrightYear}`);
    if (audit.outdated?.length) issues.push("устаревшая вёрстка");
    return issues.length ? `${link} — ⚠️ ${issues.join(", ")}` : `${link} — ✅ выглядит современным`;
  }
  if (lead.websiteKind === "booking" && booking) {
    return `❌ Не найден · запись через <a href="${e(booking.url)}">${e(booking.name)}</a>`;
  }
  if (lead.websiteKind === "social") return "❌ Не найден (вместо сайта — соцсеть)";
  return "❌ Не найден";
}

const SOURCE_LABELS: Record<string, string> = { yandex: "Яндекс Карты", osm: "OpenStreetMap" };

export function renderLeadCard(lead: LeadWithTasks, opts: { number?: number } = {}): string {
  const socials = (lead.socials as unknown as SocialLink[] | null) ?? [];
  const sources = (lead.sources as unknown as SourceRef[] | null) ?? [];
  const reasons = (lead.scoreReasons as unknown as ScoreReason[] | null) ?? [];
  const address = lead.address ? displayAddress(lead.address, lead.city) : "";
  const nicheLine = lead.category && lead.category.toLowerCase() !== lead.niche.toLowerCase() ? `${lead.category}` : lead.niche;

  const lines = [
    `${POTENTIAL_EMOJI[lead.potential]} <b>ЛИД${opts.number ? ` #${opts.number}` : ""}</b> · Lead Score: <b>${lead.score}/100</b>`,
    "",
    "🏢 <b>Название:</b>",
    e(lead.name),
    "",
    `📍 ${e(lead.city)}${address ? `, ${e(address)}` : ""}`,
    "",
    "💼 <b>Ниша:</b>",
    e(nicheLine),
    "",
    "🌐 <b>Сайт:</b>",
    siteLine(lead),
    "",
    "📱 <b>Соцсети:</b>",
    socials.length ? socials.map((s) => `<a href="${e(s.url)}">${socialLabel(s.type)}</a>`).join(" · ") : "Не найдены",
    "",
    "📞 <b>Телефон:</b>",
    lead.phones.length ? lead.phones.map(e).join(", ") : "Не найден",
    "",
    "📧 <b>Email:</b>",
    lead.emails.length ? lead.emails.map(e).join(", ") : "Не найден",
    "",
    `${POTENTIAL_EMOJI[lead.potential]} <b>Потенциал:</b> ${POTENTIAL_LABELS[lead.potential]}`,
    "",
    `💡 <b>Почему ${lead.score}/100:</b>`,
    ...formatScoreReasons(reasons, { withMarks: true }).slice(0, 9).map(e),
    "",
    "💻 <b>Что можно предложить:</b>",
    e(lead.offer ?? "—"),
    "",
    `🔗 <b>Источник:</b> ${sources.map((s) => `<a href="${e(s.url)}">${SOURCE_LABELS[s.provider] ?? s.provider}</a>`).join(" · ")}`,
    `📌 Статус: ${statusText(lead.status)}${lead.saved ? " · ❤️ сохранён" : ""}${lead.tasks.length ? " · ✅ есть задача" : ""}`,
  ];
  return lines.join("\n");
}

export function leadCardKeyboard(lead: LeadWithTasks, nav: Nav): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (lead.website) kb.url("🌐 Сайт", lead.website);
  else kb.text("🌐 Сайт", `ld:site:${lead.id}`);
  kb.text("📱 Соцсети", `ld:soc:${lead.id}`).text("📞 Контакты", `ld:ct:${lead.id}`).row();
  kb.text("✨ Создать предложение", `ld:pr:${lead.id}`).row();
  kb.text(lead.tasks.length ? "✅ Задача есть" : "➕ Создать задачу", `ld:tk:${lead.id}`);
  kb.text(lead.saved ? "💔 Убрать из сохранённых" : "❤️ Сохранить лид", `ld:sv:${lead.id}`).row();
  kb.text(`📌 Статус: ${statusText(lead.status)}`, `ld:st:${lead.id}`).row();
  kb.text(nav.label, nav.data);
  return kb;
}

export function statusPickerKeyboard(lead: { id: string; status: LeadStatus }, nav: Nav): InlineKeyboard {
  const kb = new InlineKeyboard();
  LEAD_STATUS_ORDER.forEach((s, i) => {
    kb.text(`${s === lead.status ? "• " : ""}${LEAD_STATUS_EMOJI[s]} ${LEAD_STATUS_LABELS[s]}`, `ld:ss:${lead.id}:${i}`);
    if (i % 2 === 1) kb.row();
  });
  kb.text("↩️ Назад к карточке", `ld:bk:${lead.id}`).row();
  kb.text(nav.label, nav.data);
  return kb;
}

// ---------------- мастер поиска ----------------

const WIZARD_HEAD = "🔎 <b>ПОИСК КЛИЕНТОВ</b>";

function draftRecap(d: WizardDraft): string {
  const rows = [
    d.niche ? `Ниша: <b>${e(d.niche)}</b>` : null,
    d.city ? `Город: <b>${e(d.city)}</b>` : null,
    d.requested ? `Количество: <b>${d.requested}</b>` : null,
  ].filter(Boolean);
  return rows.length ? `${rows.join("\n")}\n\n` : "";
}

export function wizardView(step: "niche" | "city" | "count" | "extra", d: WizardDraft): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  let body: string;
  if (step === "niche") {
    body = "Шаг 1/4 · <b>Ниша</b>\nВыбери из списка или напиши свою одним сообщением.";
    NICHE_PRESETS.forEach((n, i) => {
      kb.text(n.label, `ld:w:n:${i}`);
      if (i % 2 === 1) kb.row();
    });
  } else if (step === "city") {
    body = "Шаг 2/4 · <b>Город</b>\nВыбери или напиши название города.";
    CITY_PRESETS.forEach((c, i) => {
      kb.text(c, `ld:w:c:${i}`);
      if (i % 2 === 1) kb.row();
    });
  } else if (step === "count") {
    body = "Шаг 3/4 · <b>Сколько лидов найти?</b>\nВыбери или напиши число от 1 до 30.";
    kb.text("5", "ld:w:q:5").text("10", "ld:w:q:10").text("20", "ld:w:q:20");
  } else {
    body =
      "Шаг 4/4 · <b>Дополнительно</b>\nНапиши требования одним сообщением или выбери вариант.\n\n" +
      "<i>Как фильтр понимаю: «без сайта», «без современного сайта», «нужен телефон», «нужен email», «нужны соцсети». Остальное сохраню в истории поиска.</i>";
    kb.text("Только без сайта", "ld:w:e:1").row();
    kb.text("Без современного сайта", "ld:w:e:2").row();
    kb.text("Пропустить", "ld:w:e:0");
  }
  kb.row().text("✖️ Отмена", "ld:w:x");
  return { text: `${WIZARD_HEAD}\n\n${draftRecap(d)}${body}`, kb };
}

export const EXTRA_PRESETS: Record<string, string> = {
  "1": "Нужны бизнесы без сайта",
  "2": "Нужны небольшие локальные бизнесы без современного сайта",
};

export function notConfiguredText(): string {
  return "⚠️ <b>Поиск клиентов пока не настроен.</b>\n\nНеобходимо подключить API поиска бизнесов: ключ Яндекс «API Поиска по организациям» в переменной <code>YANDEX_PLACES_API_KEY</code> (файл .env).";
}

export function wizardConfirmView(d: WizardDraft, opts: { yandex: boolean; osm: boolean }): { text: string; kb: InlineKeyboard } {
  const req: SearchRequirements = parseRequirements(d.extra);
  const understood = describeRequirements(req);
  const kb = new InlineKeyboard();
  const lines = [
    WIZARD_HEAD,
    "",
    `Ниша: <b>${e(d.niche ?? "")}</b>`,
    `Город: <b>${e(d.city ?? "")}</b>`,
    `Количество: <b>${d.requested}</b>`,
    `Дополнительно: ${d.extra ? e(d.extra) : "—"}`,
  ];
  if (understood.length) lines.push("", `Учту: ${understood.join("; ")}.`);
  else if (d.extra) lines.push("", "<i>Требование не распознано как фильтр — сохраню его в истории, но отбирать по нему не смогу.</i>");

  if (opts.yandex) {
    lines.push("", `Источник: Яндекс Карты${opts.osm ? " + проверка по OpenStreetMap" : ""}`);
    kb.text("✅ Начать поиск", "ld:w:go").row();
  } else {
    lines.push("", notConfiguredText());
    if (opts.osm) {
      lines.push("", "Можно поискать только по OpenStreetMap (без ключа) — данных будет заметно меньше.");
      kb.text("🗺 Искать только по OpenStreetMap", "ld:w:osm").row();
    }
  }
  kb.text("✖️ Отмена", "ld:w:x");
  return { text: lines.join("\n"), kb };
}

// ---------------- прогресс и итог поиска ----------------

export function progressText(s: Pick<LeadSearch, "niche" | "city">, p: SearchProgress): string {
  const lines = [
    "🔎 <b>Ищу подходящие бизнесы...</b>",
    `${e(s.niche)} · ${e(s.city)}`,
    "",
    `Найдено: ${p.found}/${p.target}`,
    `Проверено: ${p.checked}`,
    `Отфильтровано: ${p.filtered}`,
  ];
  if (p.stage) lines.push("", `<i>${e(p.stage)}</i>`);
  if (p.warnings.length) lines.push("", ...p.warnings.map(e));
  return lines.join("\n");
}

export function summaryText(
  s: Pick<LeadSearch, "niche" | "city" | "found" | "checked" | "filtered" | "createdAt" | "parentId" | "warnings" | "status" | "error">,
  b: { high: number; medium: number; low: number; existing: number },
  extra: { sourceLabel?: string; skippedKnown?: number; fromHistory?: boolean } = {}
): string {
  if (s.status === "FAILED") {
    return [`⚠️ <b>Поиск не выполнен</b>`, `${e(s.niche)} · ${e(s.city)} · ${formatDate(s.createdAt)}`, "", e(s.error ?? "Неизвестная ошибка")].join("\n");
  }
  if (s.status === "RUNNING") {
    return [`⏳ <b>Поиск ещё идёт</b>`, `${e(s.niche)} · ${e(s.city)}`].join("\n");
  }
  const lines = [
    extra.fromHistory ? `🕘 <b>Поиск от ${formatDate(s.createdAt)}</b>` : "✅ <b>Поиск завершён</b>",
    `${e(s.niche)} · ${e(s.city)}${s.parentId ? " · продолжение" : ""}`,
  ];
  if (extra.sourceLabel) lines.push(`Источник: ${extra.sourceLabel}`);
  lines.push("", "Найдено:", `<b>${leadsWord(s.found)}</b>`);
  if (s.found > 0) {
    lines.push("", `🔥 Высокий потенциал: ${b.high}`, `🟡 Средний: ${b.medium}`, `⚪ Низкий: ${b.low}`);
  } else {
    lines.push("", "Подходящих бизнесов не нашлось. Попробуй другой город, нишу или «Найти ещё».");
  }
  lines.push("", `Проверено: ${s.checked} · Отфильтровано: ${s.filtered}`);
  if (b.existing) lines.push(`Уже были в базе: ${b.existing} — дубли не создавал, дополнил недостающие данные`);
  if (extra.skippedKnown) lines.push(`Пропущено уже найденных раньше: ${extra.skippedKnown}`);
  const warnings = (s.warnings as string[] | null) ?? [];
  if (warnings.length) lines.push("", ...warnings.map(e));
  return lines.join("\n");
}

export function summaryKeyboard(s: Pick<LeadSearch, "id" | "found" | "requested" | "status">): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (s.status === "RUNNING") return kb;
  if (s.found > 0) kb.text("👀 Смотреть лиды", `ld:o:s:${s.id}:0`).row();
  kb.text(`🔄 Найти ещё ${s.requested}`, `ld:more:${s.id}`);
  return kb;
}

// ---------------- «Мои лиды» ----------------

export const FILTER_LABELS: Record<LeadFilter, string> = {
  a: "Все",
  f: "❤️ Сохранённые",
  n: "🆕 Новые",
  t: "📩 Связаться",
  g: "🤝 Переговоры",
  c: "💰 Клиенты",
  r: "❌ Отказы",
  q: "🔍 Поиск",
};

export function myLeadsView(
  filter: LeadFilter,
  page: number,
  pageSize: number,
  data: { items: { id: string; name: string; score: number; potential: "HIGH" | "MEDIUM" | "LOW"; status: LeadStatus; saved: boolean }[]; total: number },
  query?: string
): { text: string; kb: InlineKeyboard } {
  const head = `❤️ <b>МОИ ЛИДЫ</b> · ${FILTER_LABELS[filter]}${filter === "q" && query ? ` «${e(query)}»` : ""}\nВсего: ${data.total}`;
  const rows = data.items.map(
    (l, i) =>
      `${page * pageSize + i + 1}. ${POTENTIAL_EMOJI[l.potential]} ${l.score} · <b>${e(l.name)}</b> — ${statusText(l.status)}${l.saved ? " ❤️" : ""}`
  );
  const empty =
    data.total === 0
      ? filter === "a"
        ? "\n\nПока пусто. Найди клиентов кнопкой «🔎 Найти клиентов»."
        : "\n\nВ этом фильтре пока пусто."
      : "";
  const kb = new InlineKeyboard();
  data.items.forEach((l, i) => kb.text(`${page * pageSize + i + 1}. ${l.name}`.slice(0, 60), `ld:ol:${filter}:${l.id}`).row());
  const pages = Math.ceil(data.total / pageSize);
  if (pages > 1) {
    if (page > 0) kb.text("◀️", `ld:ml:${filter}:${page - 1}`);
    kb.text(`${page + 1}/${pages}`, `ld:ml:${filter}:${page}`);
    if (page < pages - 1) kb.text("▶️", `ld:ml:${filter}:${page + 1}`);
    kb.row();
  }
  const f = (code: LeadFilter, label: string) => kb.text(`${filter === code ? "• " : ""}${label}`, code === "q" ? "ld:mq" : `ld:ml:${code}:0`);
  f("a", "Все");
  f("f", "❤️");
  f("n", "🆕");
  f("t", "📩");
  kb.row();
  f("g", "🤝");
  f("c", "💰");
  f("r", "❌");
  f("q", "🔍 Поиск");
  return { text: `${head}${rows.length ? `\n\n${rows.join("\n")}` : ""}${empty}`, kb };
}

// ---------------- история, статистика, настройки ----------------

export function historyView(
  page: number,
  pageSize: number,
  data: { items: Pick<LeadSearch, "id" | "niche" | "city" | "found" | "status" | "createdAt" | "parentId">[]; total: number }
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  if (data.total === 0) {
    return { text: "🕘 <b>ИСТОРИЯ ПОИСКА</b>\n\nПоисков пока не было. Начни с «🔎 Найти клиентов».", kb };
  }
  const mark = (s: { status: string }) => (s.status === "FAILED" ? "⚠️ " : s.status === "RUNNING" ? "⏳ " : "");
  const rows = data.items.map(
    (s) =>
      `<b>${formatDate(s.createdAt)}</b>\n${mark(s)}${e(s.niche)} — ${e(s.city)} — ${s.status === "FAILED" ? "не выполнен" : leadsWord(s.found)}${s.parentId ? " (ещё)" : ""}`
  );
  data.items.forEach((s) =>
    kb.text(`${mark(s)}${formatDate(s.createdAt).slice(0, 5)} · ${s.niche} — ${s.city} — ${s.found}`.slice(0, 60), `ld:ho:${s.id}`).row()
  );
  const pages = Math.ceil(data.total / pageSize);
  if (pages > 1) {
    if (page > 0) kb.text("◀️", `ld:h:${page - 1}`);
    kb.text(`${page + 1}/${pages}`, `ld:h:${page}`);
    if (page < pages - 1) kb.text("▶️", `ld:h:${page + 1}`);
  }
  return { text: `🕘 <b>ИСТОРИЯ ПОИСКА</b>\n\n${rows.join("\n\n")}`, kb };
}

export function statsText(s: { total: number; byStatus: Partial<Record<LeadStatus, number>>; saved: number; searches: number; avgCheck: number }): string {
  const n = (st: LeadStatus) => s.byStatus[st] ?? 0;
  const clients = n("CLIENT");
  const pct = s.total ? ` (${((clients / s.total) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%)` : "";
  return [
    "📊 <b>ЛИДЫ</b>",
    "",
    `Всего: ${s.total}`,
    `❤️ Сохранённые: ${s.saved}`,
    "",
    ...LEAD_STATUS_ORDER.map((st) => `${LEAD_STATUS_EMOJI[st]} ${LEAD_STATUS_LABELS[st]}: ${n(st)}`),
    "",
    "Конверсия в клиента:",
    `${clients} / ${s.total}${pct}`,
    "",
    "💰 <b>Потенциальные продажи</b>",
    "",
    `Клиентов: ${clients}`,
    "",
    "Если средний чек:",
    formatMoney(s.avgCheck),
    "",
    "Потенциальный оборот:",
    formatMoney(clients * s.avgCheck),
    "",
    "<i>Это расчёт по введённому среднему чеку, а не гарантированный доход.</i>",
    "",
    `🔎 Поисков выполнено: ${s.searches}`,
  ].join("\n");
}

export function settingsText(s: { avgCheck: number; yandex: boolean; osm: boolean; proposalLabel: string }): string {
  return [
    "⚙️ <b>НАСТРОЙКИ ПОИСКА КЛИЕНТОВ</b>",
    "",
    `Средний чек: <b>${formatMoney(s.avgCheck)}</b>`,
    "",
    `Источник бизнесов — Яндекс Карты: ${s.yandex ? "✅ подключён" : "⚠️ не подключён (нужен YANDEX_PLACES_API_KEY в .env)"}`,
    `Проверка и дополнение — OpenStreetMap: ${s.osm ? "✅ включено" : "выключено (LEADS_OSM_ENABLED=false)"}`,
    `Тексты предложений: ${s.proposalLabel}`,
  ].join("\n");
}
