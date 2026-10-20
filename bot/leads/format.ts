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
  CHANNEL_EMOJI,
  CHANNEL_LABELS,
  CONTACT_SOURCE_LABELS,
  EMAIL_CHECK_EMOJI,
  EMAIL_CHECK_LABELS,
  formatScoreReasons,
  LEAD_STATUS_EMOJI,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_ORDER,
  POTENTIAL_EMOJI,
  POTENTIAL_LABELS,
  siteIssues,
  outreachStatusText,
  SOURCE_LABELS,
  statusText,
} from "../../lib/leads/labels";
import { CITY_PRESETS, NICHE_PRESETS } from "../../lib/leads/niches";
import { leadMessengers } from "../../lib/leads/normalize";
import type { LeadWithTasks, LeadFilter } from "../../lib/leads/repository";
import { describeRequirements, parseRequirements, type SearchRequirements } from "../../lib/leads/requirements";
import { socialLabel } from "../../lib/leads/scoring";
import type { SearchProgress } from "../../lib/leads/search";
import type { ScoreReason, SiteAudit, SocialLink, SourceRef } from "../../lib/leads/types";
import { formatDayShort } from "../../lib/leads/time";
import type { WizardDraft } from "../state";
import { clip, crumbs, DIV, e, plural } from "./ui";

export { e, plural };

const DISPLAY_TZ = process.env.LEADS_TIMEZONE?.trim() || "Europe/Moscow";

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
    const issues = siteIssues(audit);
    return issues.length ? `${link} — ⚠️ ${issues.join(", ")}` : `${link} — ✅ выглядит современным`;
  }
  if (lead.websiteKind === "booking" && booking) {
    return `❌ Не найден · запись через <a href="${e(booking.url)}">${e(booking.name)}</a>`;
  }
  if (lead.websiteKind === "social") return "❌ Не найден (вместо сайта — соцсеть)";
  return "❌ Не найден";
}

/** Email с проверкой и источником: «🟢 info@site.ru — подтверждён · сайт компании». */
export function emailLines(lead: LeadWithTasks): string[] {
  const contacts = lead.contacts ?? [];
  if (!contacts.length) return lead.emails.length ? lead.emails.map(e) : ["Не найден"];
  return contacts.map((c) => {
    const check = c.verification ? `${EMAIL_CHECK_EMOJI[c.verification]} ` : "";
    const label = c.verification ? ` — ${EMAIL_CHECK_LABELS[c.verification].toLowerCase()}` : "";
    const source = CONTACT_SOURCE_LABELS[c.sourceType];
    const from = c.sourceUrl ? `<a href="${e(c.sourceUrl)}">${source}</a>` : source;
    return `${check}${e(c.value)}${label} · ${from}`;
  });
}

const openTask = (lead: LeadWithTasks, kind: "CONTACT" | "FOLLOW_UP") => lead.tasks.find((t) => t.kind === kind && t.task.status !== "DONE");

/** Строка состояния под статусом: сохранён · задача · follow-up · обращение. */
function workLine(lead: LeadWithTasks): string | null {
  const parts: string[] = [];
  if (lead.saved) parts.push("❤️ сохранён");
  if (lead.tasks.some((t) => t.kind === "CONTACT")) parts.push(openTask(lead, "CONTACT") ? "📋 задача" : "📋 задача выполнена");
  const fu = openTask(lead, "FOLLOW_UP");
  if (fu) parts.push(`⏰ follow-up ${formatDayShort(fu.task.deadlineAt)}`);
  return parts.length ? parts.join(" · ") : null;
}

function outreachLine(lead: LeadWithTasks): string | null {
  const o = lead.outreach?.[0];
  if (!o) return null;
  const when = o.status === "SENT" || o.status === "WAITING" || o.status === "FOLLOW_UP" ? (o.sentAt ? ` ${formatDayShort(o.sentAt)}` : "") : "";
  return `${CHANNEL_EMOJI[o.channel]} ${CHANNEL_LABELS[o.channel]}: ${outreachStatusText(o.status)}${when}`;
}

export function renderLeadCard(lead: LeadWithTasks, opts: { number?: number } = {}): string {
  const allSocials = (lead.socials as unknown as SocialLink[] | null) ?? [];
  const socials = allSocials.filter((s) => s.type !== "whatsapp" && s.type !== "telegram");
  const messengers = leadMessengers(lead.phones, allSocials);
  const sources = (lead.sources as unknown as SourceRef[] | null) ?? [];
  const reasons = (lead.scoreReasons as unknown as ScoreReason[] | null) ?? [];
  const address = lead.address ? displayAddress(lead.address, lead.city) : "";
  const nicheLine = lead.category && lead.category.toLowerCase() !== lead.niche.toLowerCase() ? `${lead.category}` : lead.niche;

  const lines = [
    `${POTENTIAL_EMOJI[lead.potential]} <b>LEAD${opts.number ? ` #${opts.number}` : ""}</b> · <b>${lead.score}</b>/100`,
    DIV,
    `🏢 <b>${e(lead.name)}</b>`,
    `📍 ${e(lead.city)}${address ? `, ${e(address)}` : ""}`,
    `💼 ${e(nicheLine)}`,
    "",
    "🌐 <b>Сайт</b>",
    siteLine(lead),
    "📧 <b>Email</b>",
    ...emailLines(lead),
    "📞 <b>Телефон</b>",
    lead.phones.length ? lead.phones.map(e).join(", ") : "Не найден",
    "💬 <b>Мессенджеры</b>",
    messengers.length
      ? messengers.map((m) => `<a href="${e(m.url)}">${socialLabel(m.type)}</a>${m.byPhone ? " <i>(по номеру)</i>" : ""}`).join(" · ") +
          (messengers.some((m) => m.byPhone) ? "\n<i>по номеру — чат откроется, если номер есть в мессенджере</i>" : "")
      : "Не найдены",
    "📱 <b>Соцсети</b>",
    socials.length ? socials.map((s) => `<a href="${e(s.url)}">${socialLabel(s.type)}</a>`).join(" · ") : "Не найдены",
    DIV,
    `🎯 <b>Lead Score</b> ${lead.score}/100 · ${POTENTIAL_LABELS[lead.potential].toLowerCase()} потенциал`,
    ...formatScoreReasons(reasons, { withMarks: true }).slice(0, 6).map(e),
    "",
    "💡 <b>Возможность</b>",
    e(lead.offer ?? "—"),
    DIV,
    `<b>СТАТУС</b>  ${statusText(lead.status)}`,
  ];
  const work = workLine(lead);
  if (work) lines.push(work);
  const outreach = outreachLine(lead);
  if (outreach) lines.push(outreach);
  lines.push(`🔗 Источник: ${sources.map((s) => `<a href="${e(s.url)}">${SOURCE_LABELS[s.provider] ?? s.provider}</a>`).join(" · ")}`);
  return lines.join("\n");
}

export function leadCardKeyboard(lead: LeadWithTasks, nav: Nav): InlineKeyboard {
  const kb = new InlineKeyboard();
  const draft = lead.outreach?.[0];
  const hasEmailDraft = draft && draft.channel === "EMAIL" && (draft.status === "DRAFT" || draft.status === "READY");
  kb.text(hasEmailDraft ? "✉️ Открыть письмо" : "✨ Подготовить письмо", `os:pe:${lead.id}`).text("💬 Сообщение", `os:ch:${lead.id}`).row();
  kb.text(lead.tasks.some((t) => t.kind === "CONTACT") ? "✅ Задача есть" : "➕ Создать задачу", `ld:tk:${lead.id}`);
  kb.text(openTask(lead, "FOLLOW_UP") ? "⏰ Follow-up ✓" : "⏰ Follow-up", `os:fp:l:${lead.id}`).row();
  kb.text(lead.saved ? "💔 Убрать" : "❤️ Сохранить", `ld:sv:${lead.id}`).text("📌 Статус", `ld:st:${lead.id}`).row();
  const source = ((lead.sources as unknown as SourceRef[] | null) ?? [])[0];
  const booking = lead.bookingPage as { name: string; url: string } | null;
  const site = lead.website ?? booking?.url;
  if (site) kb.url("🌐 Открыть сайт", site);
  if (source) kb.url("📍 Источник", source.url);
  if (site || source) kb.row();
  kb.text("🏠 Меню", "os:home").text(nav.label, nav.data);
  return kb;
}

export function statusPickerKeyboard(lead: { id: string; status: LeadStatus }, nav: Nav): InlineKeyboard {
  const kb = new InlineKeyboard();
  LEAD_STATUS_ORDER.forEach((s, i) => {
    kb.text(`${s === lead.status ? "• " : ""}${LEAD_STATUS_EMOJI[s]} ${LEAD_STATUS_LABELS[s]}`, `ld:ss:${lead.id}:${i}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row().text("‹ Назад к карточке", `ld:bk:${lead.id}`).row();
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
  return "⚠️ <b>Яндекс не подключён.</b>\n\nПоиск через Яндекс — тестовая интеграция: нужен ключ «API Поиска по организациям» в переменной <code>YANDEX_PLACES_API_KEY</code> (файл .env). Основной поиск по OpenStreetMap работает без ключа.";
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

  lines.push("", "Источник: 🗺 OpenStreetMap — вся Россия, email ищу на сайтах компаний");
  kb.text("✅ Начать поиск", "ld:w:go").row();
  if (opts.yandex) kb.text("🧪 Искать через Яндекс (тест)", "ld:w:ya").row();
  kb.text("✖️ Отмена", "ld:w:x");
  return { text: lines.join("\n"), kb };
}

// ---------------- прогресс и итог поиска ----------------

export function progressText(s: Pick<LeadSearch, "niche" | "city">, p: SearchProgress): string {
  const lines = [
    "🔎 <b>Ищу подходящие бизнесы...</b>",
    `${e(s.niche)} · ${e(s.city)}`,
    "",
    `Найдено бизнесов: ${p.candidates}`,
    `Проверено: ${p.checked}`,
    `Подходят: ${p.found}/${p.target}`,
    `📧 Email найден: ${p.withEmail}`,
  ];
  if (p.stage) lines.push("", `<i>${e(p.stage)}</i>`);
  if (p.warnings.length) lines.push("", ...p.warnings.map(e));
  return lines.join("\n");
}

export function summaryText(
  s: Pick<
    LeadSearch,
    "niche" | "city" | "found" | "checked" | "filtered" | "candidates" | "withEmail" | "needsReview" | "createdAt" | "parentId" | "warnings" | "status" | "error"
  >,
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
  const funnel = [
    s.candidates ? `${s.candidates} ${plural(s.candidates, ["бизнес", "бизнеса", "бизнесов"])}` : null,
    `<b>${s.found} ${plural(s.found, ["подходит", "подходят", "подходят"])}</b>`,
    `${s.withEmail} с публичным email`,
    s.needsReview ? `${s.needsReview} ${plural(s.needsReview, ["требует", "требуют", "требуют"])} проверки` : null,
  ].filter(Boolean);
  lines.push("", funnel.join(" · "));
  if (s.found > 0) {
    lines.push("", `🔥 Высокий потенциал: ${b.high}`, `🟡 Средний: ${b.medium}`, `⚪ Низкий: ${b.low}`);
    if (s.needsReview) lines.push("", "<i>🟡 — email найден, но не подтверждён (бесплатная почта или другой домен). Проверь перед отправкой.</i>");
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
  if (s.status === "FAILED") return kb.text("🔁 Повторить поиск", `ld:retry:${s.id}`);
  if (s.found > 0) kb.text("👀 Смотреть лиды", `ld:o:s:${s.id}:0`).row();
  kb.text(`🔄 Найти ещё ${s.requested}`, `ld:more:${s.id}`);
  return kb;
}

// ---------------- «Мои лиды» ----------------

export const FILTER_LABELS: Record<LeadFilter, string> = {
  a: "Все",
  h: "🔥 Горячие",
  f: "❤️ Сохранённые",
  d: "🔎 Найденные",
  n: "🆕 Новые",
  t: "📩 Связаться",
  w: "⏳ Ждут ответа",
  g: "💬 Переговоры",
  c: "🤝 Клиенты",
  r: "❌ Отказы",
  q: "🔍 Поиск",
};

type ListLead = Pick<LeadWithTasks, "id" | "name" | "score" | "potential" | "status" | "saved" | "emails"> & Partial<Pick<LeadWithTasks, "tasks">>;

export function myLeadsView(
  filter: LeadFilter,
  page: number,
  pageSize: number,
  data: { items: ListLead[]; total: number },
  query?: string
): { text: string; kb: InlineKeyboard } {
  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  const head = [
    crumbs("Лиды"),
    `👥 <b>ЛИДЫ</b> · ${FILTER_LABELS[filter]}${filter === "q" && query ? ` «${e(query)}»` : ""}`,
    `Всего: <b>${data.total}</b>${pages > 1 ? ` · стр. ${page + 1}/${pages}` : ""}`,
  ].join("\n");
  const rows = data.items.map((l, i) => {
    const fu = l.tasks?.find((t) => t.kind === "FOLLOW_UP" && t.task.status !== "DONE");
    const marks = [l.saved ? "❤️" : null, l.emails.length ? "📧" : null, fu ? `⏰ ${formatDayShort(fu.task.deadlineAt)}` : null].filter(Boolean).join(" ");
    return `${page * pageSize + i + 1}. ${POTENTIAL_EMOJI[l.potential]} <b>${l.score}</b> · <b>${e(l.name)}</b>\n     ${statusText(l.status)}${marks ? ` · ${marks}` : ""}`;
  });
  const empty =
    data.total === 0
      ? filter === "a"
        ? "Пока пусто. Найди клиентов кнопкой «🔎 Найти клиентов»."
        : "В этом фильтре пока пусто."
      : "";
  const kb = new InlineKeyboard();
  data.items.forEach((l, i) => {
    kb.text(clip(`${page * pageSize + i + 1} · ${l.name}`, 30), `ld:ol:${filter}:${l.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row();
  if (pages > 1) {
    kb.text(page > 0 ? "‹" : "·", page > 0 ? `ld:ml:${filter}:${page - 1}` : `ld:ml:${filter}:${page}`);
    kb.text(`${page + 1}/${pages}`, `ld:ml:${filter}:${page}`);
    kb.text(page < pages - 1 ? "›" : "·", page < pages - 1 ? `ld:ml:${filter}:${page + 1}` : `ld:ml:${filter}:${page}`);
    kb.row();
  }
  const f = (code: LeadFilter, label: string) => kb.text(`${filter === code ? "• " : ""}${label}`, code === "q" ? "ld:mq" : `ld:ml:${code}:0`);
  f("a", "Все");
  f("h", "🔥");
  f("f", "❤️");
  f("d", "🔎");
  f("n", "🆕");
  kb.row();
  f("t", "📩");
  f("w", "⏳");
  f("g", "💬");
  f("c", "🤝");
  f("r", "❌");
  kb.row();
  f("q", "🔍 Поиск");
  kb.text("🕘 История", "ld:h:0").row();
  kb.text("🏠 Меню", "os:home").text("🔎 Найти клиентов", "os:find");
  return { text: `${head}\n${DIV}\n${rows.length ? rows.join("\n") : empty}`, kb };
}

// ---------------- история, статистика, настройки ----------------

export function historyView(
  page: number,
  pageSize: number,
  data: { items: Pick<LeadSearch, "id" | "niche" | "city" | "found" | "status" | "createdAt" | "parentId">[]; total: number }
): { text: string; kb: InlineKeyboard } {
  const kb = new InlineKeyboard();
  const head = `${crumbs("Лиды", "История")}\n🕘 <b>ИСТОРИЯ ПОИСКА</b>`;
  if (data.total === 0) {
    kb.text("🔎 Найти клиентов", "os:find").text("🏠 Меню", "os:home");
    return { text: `${head}\n\nПоисков пока не было. Начни с «🔎 Найти клиентов».`, kb };
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
    kb.row();
  }
  kb.text("👥 Лиды", "ld:ml:a:0").text("🏠 Меню", "os:home");
  return { text: `${head}\n${DIV}\n${rows.join("\n\n")}`, kb };
}

export interface SenderSettings {
  senderName: string | null;
  companyName: string | null;
  portfolioUrl: string | null;
  senderContact: string | null;
}

export function settingsText(
  s: { avgCheck: number; yandex: boolean; osm: boolean; osmLocal: string; proposalLabel: string } & SenderSettings
): string {
  const v = (x: string | null) => (x ? e(x) : "<i>не указано</i>");
  return [
    crumbs("Настройки"),
    "⚙️ <b>НАСТРОЙКИ ПОИСКА КЛИЕНТОВ</b>",
    "",
    `Средний чек: <b>${formatMoney(s.avgCheck)}</b>`,
    "",
    "✍️ <b>Подпись в предложениях</b>",
    `Имя: ${v(s.senderName)}`,
    `Компания / студия: ${v(s.companyName)}`,
    `Портфолио: ${v(s.portfolioUrl)}`,
    `Контакт: ${v(s.senderContact)}`,
    "",
    "<b>Источники</b>",
    `🗺 OpenStreetMap (основной): ${s.osm ? `✅ ${e(s.osmLocal)}` : "выключен (LEADS_OSM_ENABLED=false)"}`,
    `🧪 Яндекс Карты (тест): ${s.yandex ? "ключ подключён" : "не подключён"}`,
    `Тексты предложений: ${s.proposalLabel}`,
  ].join("\n");
}

export function settingsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✏️ Средний чек", "ld:set:avg")
    .row()
    .text("✏️ Имя", "ld:set:name")
    .text("✏️ Компания", "ld:set:company")
    .row()
    .text("✏️ Портфолио", "ld:set:portfolio")
    .text("✏️ Контакт", "ld:set:contact")
    .row()
    .text("🏠 Меню", "os:home");
}
