// Экраны Sales OS в Telegram: дашборд, Outreach, редактор обращения, выбор
// канала, follow-up, аналитика, задачи. Только текст и клавиатуры — данные
// приходят из lib/leads, обработчики кнопок — в sales.ts.
//
// callback_data (≤ 64 байт), префикс os:
//   os:home · os:next · os:find · os:out · os:ol:<статус>:<стр> · os:o:<обращение>
//   os:pe:<лид> письмо · os:ch:<лид> выбор канала · os:pm:<лид>:<T|W|S> сообщение
//   os:oe|oc|or|os|ox:<обращение> править · копировать · другой вариант · отправил · отмена
//   os:oo:<обращение>:<r|x|k> ответили · отказ · клиент
//   os:fp:<l|o>:<id> выбор даты follow-up · os:fs:<l|o>:<id>:<дни> · os:fd:<l|o>:<id> своя дата
//   os:fl:<стр> список · os:fo:<задача> карточка · os:fz:<задача>[:<дни>] · os:fc:<задача>[:<итог>]
//   os:an:<0|7|30> аналитика · os:tk задачи · os:del убрать сообщение

import type { LeadContact, OutreachChannel, OutreachStatus, Task } from "@prisma/client";
import { InlineKeyboard } from "grammy";
import type { Analytics } from "../../lib/leads/analytics";
import type { Dashboard, NextAction } from "../../lib/leads/dashboard";
import type { FollowUp } from "../../lib/leads/followups";
import { followUpNotice, relativeDay } from "../../lib/leads/followup-notice";
import {
  CHANNEL_EMOJI,
  CHANNEL_LABELS,
  EMAIL_CHECK_EMOJI,
  OUTREACH_STATUS_EMOJI,
  OUTREACH_STATUS_LABELS,
  outreachStatusText,
  statusText,
} from "../../lib/leads/labels";
import { EDITABLE, OUTREACH_STATUS_ORDER, type OutreachWithLead } from "../../lib/leads/outreach";
import { manualSenders } from "../../lib/leads/outreach/senders";
import type { LeadWithTasks } from "../../lib/leads/repository";
import { formatDay, formatDayShort, formatDayTime } from "../../lib/leads/time";
import type { SocialLink } from "../../lib/leads/types";
import { clip, crumbs, DIV, e, pct, plural, table } from "./ui";

export interface View {
  text: string;
  kb: InlineKeyboard;
}

const money = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

// ---------------- дашборд ----------------

function nextActionText(n: NextAction | null): { text: string; data: string | null } {
  if (!n) return { text: "Срочных дел нет — найди новых клиентов: 🔎", data: "os:find" };
  const name = `<b>${e(n.name)}</b>`;
  switch (n.kind) {
    case "followup":
      return { text: `${name}\n→ follow-up: напомнить о себе · ${relativeDay(n.at)}`, data: `os:fo:${n.taskId}` };
    case "reply":
      return { text: `${name}\n→ пришёл ответ — договориться о следующем шаге`, data: `ld:ol:a:${n.leadId}` };
    case "send":
      return { text: `${name}\n→ отправить предложение`, data: `os:o:${n.outreachId}` };
    case "prepare":
      return { text: `${name}\n→ подготовить предложение`, data: `ld:ol:t:${n.leadId}` };
    case "hot":
      return { text: `${name} · 🔥 ${n.score}/100\n→ посмотреть и взять в работу`, data: `ld:ol:h:${n.leadId}` };
    case "upcoming":
      return { text: `${name}\n→ follow-up ${formatDayShort(n.at)} (${relativeDay(n.at)})`, data: `os:fo:${n.taskId}` };
  }
}

export function dashboardView(d: Dashboard, now: Date, appUrl?: string): View {
  const next = nextActionText(d.next);
  const lines = [
    `🚀 <b>SALES OS</b> · ${formatDay(now)}`,
    DIV,
    "🔥 <b>СЕГОДНЯ</b>",
    table([
      ["Новых лидов", d.today.newLeads],
      ["Нужно обработать", d.today.toProcess],
      ["Follow-up", d.today.followUps],
      ["Ответов", d.today.replies],
      ["Горячих лидов", d.today.hot],
    ]),
    "📈 <b>ВОРОНКА</b>",
    table([
      ["Новые лиды", d.pipeline.fresh],
      ["Нужно связаться", d.pipeline.toContact],
      ["Ожидают ответа", d.pipeline.waiting],
      ["Переговоры", d.pipeline.negotiation],
      ["Клиенты", d.pipeline.clients],
    ]),
    `📨 <b>OUTREACH СЕГОДНЯ</b>\n${d.outreachToday.drafted} подготовлено · ${d.outreachToday.sent} отправлено · ${d.outreachToday.replies} ${plural(d.outreachToday.replies, ["ответ", "ответа", "ответов"])}`,
    DIV,
    "⚡ <b>БЛИЖАЙШЕЕ ДЕЙСТВИЕ</b>",
    next.text,
  ];
  const kb = new InlineKeyboard();
  if (next.data && d.next) kb.text("⚡ Открыть", next.data).row();
  kb.text(`🔥 Горячие · ${d.today.hot}`, "ld:ml:h:0").text(`📩 Связаться · ${d.pipeline.toContact}`, "ld:ml:t:0").row();
  kb.text("🔎 Найти клиентов", "os:find").text("👥 Мои лиды", "ld:ml:a:0").row();
  kb.text("📨 Outreach", "os:out").text(`⏰ Follow-up${d.today.followUps ? ` · ${d.today.followUps}` : ""}`, "os:fl:0").row();
  kb.text("📋 Задачи", "os:tk").text("📊 Аналитика", "os:an:0").row();
  kb.text("⚙️ Настройки", "os:set").text("🔄 Обновить", "os:home").row();
  if (appUrl) kb.webApp("📱 Open Tandem", appUrl);
  return { text: lines.join("\n"), kb };
}

// ---------------- Outreach CRM ----------------

const STATUS_CODE: Record<OutreachStatus, string> = { DRAFT: "d", READY: "r", SENT: "s", WAITING: "w", REPLIED: "p", FOLLOW_UP: "f", REJECTED: "x", CLIENT: "k" };
export const STATUS_BY_CODE = Object.fromEntries(Object.entries(STATUS_CODE).map(([s, c]) => [c, s as OutreachStatus])) as Record<string, OutreachStatus>;
const SHORT: Record<OutreachStatus, string> = { DRAFT: "Черновики", READY: "Готово", SENT: "Отправлено", WAITING: "Ждём", REPLIED: "Ответы", FOLLOW_UP: "Follow-up", REJECTED: "Отказ", CLIENT: "Клиент" };

export function outreachOverviewView(counts: Record<OutreachStatus, number>, today: Dashboard["outreachToday"]): View {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const text = [
    crumbs("Outreach"),
    `📨 <b>OUTREACH</b> · всего ${total}`,
    table(OUTREACH_STATUS_ORDER.map((s) => [OUTREACH_STATUS_LABELS[s], counts[s]])),
    `Сегодня: ${today.drafted} подготовлено · ${today.sent} отправлено · ${today.replies} ${plural(today.replies, ["ответ", "ответа", "ответов"])}`,
    "",
    "<i>Письма и сообщения готовит бот, отправляешь ты сам — так проверяем качество лидов и текстов.</i>",
  ].join("\n");
  const kb = new InlineKeyboard();
  OUTREACH_STATUS_ORDER.forEach((s, i) => {
    kb.text(`${OUTREACH_STATUS_EMOJI[s]} ${SHORT[s]} · ${counts[s]}`, `os:ol:${STATUS_CODE[s]}:0`);
    if (i % 2 === 1) kb.row();
  });
  kb.text("🏠 Меню", "os:home");
  return { text, kb };
}

type OutreachListItem = { id: string; channel: OutreachChannel; recipient: string | null; subject: string | null; sentAt: Date | null; updatedAt: Date; followUpAt: Date | null; lead: { name: string } };

export function outreachListView(status: OutreachStatus, page: number, pageSize: number, data: { items: OutreachListItem[]; total: number }): View {
  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  const rows = data.items.map((o, i) => {
    const when = o.sentAt ? `отправлено ${formatDayShort(o.sentAt)}` : `изменено ${formatDayShort(o.updatedAt)}`;
    const fu = o.followUpAt ? ` · ⏰ ${formatDayShort(o.followUpAt)}` : "";
    return `${page * pageSize + i + 1}. ${CHANNEL_EMOJI[o.channel]} <b>${e(o.lead.name)}</b>\n     ${when}${fu}${o.recipient ? ` · ${e(clip(o.recipient, 32))}` : ""}`;
  });
  const text = [
    crumbs("Outreach", OUTREACH_STATUS_LABELS[status]),
    `${outreachStatusText(status)} · <b>${data.total}</b>${pages > 1 ? ` · стр. ${page + 1}/${pages}` : ""}`,
    DIV,
    rows.length ? rows.join("\n") : "Здесь пока пусто.",
  ].join("\n");
  const kb = new InlineKeyboard();
  data.items.forEach((o, i) => {
    kb.text(clip(`${page * pageSize + i + 1} · ${o.lead.name}`, 30), `os:o:${o.id}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row();
  if (pages > 1) {
    if (page > 0) kb.text("‹", `os:ol:${STATUS_CODE[status]}:${page - 1}`);
    kb.text(`${page + 1}/${pages}`, `os:ol:${STATUS_CODE[status]}:${page}`);
    if (page < pages - 1) kb.text("›", `os:ol:${STATUS_CODE[status]}:${page + 1}`);
    kb.row();
  }
  kb.text("‹ Outreach", "os:out").text("🏠 Меню", "os:home");
  return { text, kb };
}

// ---------------- редактор обращения ----------------

const BODY_LIMIT = 3000; // сообщение Telegram — до 4096 символов вместе с шапкой

function recipientLine(o: OutreachWithLead, contact: LeadContact | null): string {
  if (!o.recipient) return o.channel === "EMAIL" ? "Кому: <i>email не найден</i>" : "Куда: <i>контакт не найден — скопируй текст</i>";
  const check = contact?.verification ? `${EMAIL_CHECK_EMOJI[contact.verification]} ` : "";
  return `${o.channel === "EMAIL" ? "Кому" : "Куда"}: ${check}${e(o.recipient)}`;
}

/** Ссылка, по которой пользователь сам откроет почту / чат с готовым текстом. */
function openButton(o: OutreachWithLead, mailUrl: string | null): { text: string; url: string } | null {
  if (o.channel === "EMAIL") return mailUrl && o.recipient ? { text: "📨 Открыть почту", url: mailUrl } : null;
  const handoff = manualSenders[o.channel].prepare({ recipient: o.recipient, subject: o.subject, body: o.body });
  if (!handoff.url || !/^https?:\/\//.test(handoff.url)) return null;
  const label = o.channel === "WHATSAPP" ? "📱 Открыть WhatsApp" : o.channel === "TELEGRAM" ? "💬 Открыть чат" : "🌐 Открыть страницу";
  return { text: label, url: handoff.url };
}

export function outreachEditorView(o: OutreachWithLead, opts: { warnings: string[]; engine: string; mailUrl: string | null; notice?: string }): View {
  const body = o.body.length > BODY_LIMIT ? `${o.body.slice(0, BODY_LIMIT)}…\n(полный текст — «📋 Копировать»)` : o.body;
  const lines = [
    crumbs("Outreach", o.lead.name),
    `${CHANNEL_EMOJI[o.channel]} <b>${CHANNEL_LABELS[o.channel].toUpperCase()}</b> · ${outreachStatusText(o.status)}`,
  ];
  if (opts.notice) lines.push(opts.notice);
  lines.push(recipientLine(o, o.contact));
  if (o.subject) lines.push(`Тема: <b>${e(o.subject)}</b>`);
  lines.push(DIV, `<blockquote expandable>${e(body)}</blockquote>`, DIV);
  if (o.sentAt) lines.push(`📨 Отправлено: ${formatDay(o.sentAt)}${o.followUpAt ? ` · ⏰ follow-up ${formatDayTime(o.followUpAt)}` : ""}`);
  if (o.repliedAt) lines.push(`👀 Ответ: ${formatDay(o.repliedAt)}`);
  if (EDITABLE.includes(o.status)) {
    lines.push(...opts.warnings.map((w) => `⚠️ ${e(w)}`));
    lines.push(`<i>${o.generator === "manual" ? "Текст отредактирован вручную" : `Сделано: ${e(opts.engine)}`}. Бот ничего не отправляет сам — проверь и отправь.</i>`);
  }

  const kb = new InlineKeyboard();
  const open = openButton(o, opts.mailUrl);
  if (EDITABLE.includes(o.status)) {
    kb.text("✏️ Редактировать", `os:oe:${o.id}`).text("📋 Копировать", `os:oc:${o.id}`).row();
    if (open) kb.url(open.text, open.url);
    kb.text("🔄 Другой вариант", `os:or:${o.id}`).row();
    kb.text("✅ Я отправил", `os:os:${o.id}`).row();
    kb.text("❌ Отмена", `os:ox:${o.id}`).text("‹ К лиду", `ld:bk:${o.leadId}`);
  } else if (o.status === "REJECTED" || o.status === "CLIENT") {
    kb.text("📋 Копировать", `os:oc:${o.id}`).text("‹ К лиду", `ld:bk:${o.leadId}`);
  } else {
    if (o.status !== "REPLIED") kb.text("👀 Ответили", `os:oo:${o.id}:r`);
    kb.text("⏰ Follow-up", `os:fp:o:${o.id}`).row();
    kb.text("🤝 Клиент", `os:oo:${o.id}:k`).text("❌ Отказ", `os:oo:${o.id}:x`).row();
    kb.text("📋 Копировать", `os:oc:${o.id}`).text("‹ К лиду", `ld:bk:${o.leadId}`);
  }
  kb.row().text("📨 Outreach", "os:out").text("🏠 Меню", "os:home");
  return { text: lines.join("\n"), kb };
}

/** «📋 Копировать»: отдельное сообщение — по нажатию на блок Telegram копирует текст. */
export function copyView(o: OutreachWithLead): View {
  const lines = ["📋 <b>Текст для копирования</b> — нажми на блок, чтобы скопировать"];
  if (o.recipient) lines.push(`${o.channel === "EMAIL" ? "Кому" : "Куда"}: <code>${e(o.recipient)}</code>`);
  if (o.subject) lines.push(`Тема: <code>${e(o.subject)}</code>`);
  lines.push(`<pre>${e(o.body)}</pre>`);
  const kb = new InlineKeyboard();
  if (o.recipient && o.recipient.length <= 256) kb.copyText(o.channel === "EMAIL" ? "📋 Адрес" : "📋 Контакт", o.recipient);
  if (o.subject && o.subject.length <= 256) kb.copyText("📋 Тему", o.subject);
  kb.row().text("🗑 Убрать", "os:del");
  return { text: lines.join("\n"), kb };
}

// ---------------- выбор канала ----------------

export function channelPickerView(lead: LeadWithTasks): View {
  const socials = (lead.socials as unknown as SocialLink[] | null) ?? [];
  const has = (t: string) => socials.some((s) => s.type === t);
  const email = lead.emails[0];
  const lines = [
    crumbs("Лиды", lead.name, "Сообщение"),
    `💬 <b>СООБЩЕНИЕ</b> · ${e(lead.name)}`,
    "Выбери канал — у каждого свой формат текста:",
    "",
    `📧 <b>Email</b> — подробное письмо · ${email ? e(email) : "<i>email не найден</i>"}`,
    `💬 <b>Telegram</b> — коротко · ${has("telegram") ? "есть контакт" : "<i>нет контакта</i>"}`,
    `📱 <b>WhatsApp</b> — коротко и по-разговорному · ${has("whatsapp") || lead.phones.length ? "есть номер" : "<i>нет номера</i>"}`,
    `🌐 <b>Соцсети</b> — очень коротко · ${has("vk") || has("instagram") ? socials.filter((s) => s.type === "vk" || s.type === "instagram").map((s) => (s.type === "vk" ? "VK" : "Instagram")).join(", ") : "<i>нет страниц</i>"}`,
    "",
    "<i>Ничего не отправляется автоматически: бот готовит текст, отправляешь ты.</i>",
  ];
  const kb = new InlineKeyboard()
    .text("📧 Email", `os:pe:${lead.id}`)
    .text("💬 Telegram", `os:pm:${lead.id}:T`)
    .row()
    .text("📱 WhatsApp", `os:pm:${lead.id}:W`)
    .text("🌐 Соцсети", `os:pm:${lead.id}:S`)
    .row()
    .text("‹ К лиду", `ld:bk:${lead.id}`);
  return { text: lines.join("\n"), kb };
}

// ---------------- follow-up ----------------

export type FollowUpTarget = { scope: "l" | "o"; id: string; leadId: string; leadName: string; current: Date | null };

export function followUpPickerView(t: FollowUpTarget, opts: { notice?: string; skip?: boolean } = {}): View {
  const lines = [crumbs("Follow-up", t.leadName), `⏰ <b>FOLLOW-UP</b> · ${e(t.leadName)}`];
  if (opts.notice) lines.push(opts.notice);
  lines.push(
    t.current ? `Сейчас стоит: <b>${formatDayTime(t.current)}</b> — новая дата заменит её.` : "Когда напомнить, если не ответят?",
    "",
    "<i>Напоминание придёт сообщением в 10:00, задача «Follow-up» появится в «📋 Задачах».</i>"
  );
  const key = `${t.scope}:${t.id}`;
  const kb = new InlineKeyboard()
    .text("Через 2 дня", `os:fs:${key}:2`)
    .text("Через 5 дней", `os:fs:${key}:5`)
    .text("Через 7 дней", `os:fs:${key}:7`)
    .row()
    .text("📅 Своя дата", `os:fd:${key}`)
    .row();
  if (opts.skip) kb.text("Без напоминания", t.scope === "o" ? `os:o:${t.id}` : `ld:bk:${t.leadId}`);
  else kb.text("‹ Назад", t.scope === "o" ? `os:o:${t.id}` : `ld:bk:${t.leadId}`);
  return { text: lines.join("\n"), kb };
}

export function followUpSetView(leadId: string, leadName: string, at: Date, created: boolean, taskId: string): View {
  const text = [
    crumbs("Follow-up", leadName),
    `⏰ <b>Follow-up ${created ? "поставлен" : "перенесён"}</b>`,
    `<b>${e(leadName)}</b> — ${formatDayTime(at)} (${relativeDay(at)})`,
    "",
    "В «📋 Задачах» — «Follow-up: …». В срок пришлю напоминание с кнопками.",
  ].join("\n");
  const kb = new InlineKeyboard()
    .text("👀 Открыть лид", `ld:ol:a:${leadId}`)
    .text("⏰ Follow-up", `os:fo:${taskId}`)
    .row()
    .text("🏠 Меню", "os:home");
  return { text, kb };
}

export function followUpCardView(fu: FollowUp, now = new Date()): View {
  const n = followUpNotice(fu, now);
  const kb = new InlineKeyboard();
  for (const row of n.inline_keyboard) {
    for (const b of row) kb.text(b.text, b.callback_data!);
    kb.row();
  }
  kb.text("‹ Follow-up", "os:fl:0").text("🏠 Меню", "os:home");
  return { text: `${crumbs("Follow-up", fu.lead.name)}\n${n.text}`, kb };
}

export function snoozeView(fu: FollowUp): View {
  const kb = new InlineKeyboard()
    .text("+1 день", `os:fz:${fu.taskId}:1`)
    .text("+3 дня", `os:fz:${fu.taskId}:3`)
    .text("+7 дней", `os:fz:${fu.taskId}:7`)
    .row()
    .text("📅 Своя дата", fu.outreachId ? `os:fd:o:${fu.outreachId}` : `os:fd:l:${fu.leadId}`)
    .row()
    .text("‹ Назад", `os:fo:${fu.taskId}`);
  return { text: `${crumbs("Follow-up", fu.lead.name)}\n⏰ <b>Отложить follow-up</b> · ${e(fu.lead.name)}\nСейчас: ${formatDayTime(fu.task.deadlineAt)}. Напомню в 10:00 выбранного дня.`, kb };
}

export function closeFollowUpView(fu: FollowUp): View {
  const kb = new InlineKeyboard()
    .text("👀 Ответили", `os:fc:${fu.taskId}:r`)
    .text("❌ Отказ", `os:fc:${fu.taskId}:x`)
    .row()
    .text("🔁 Написал ещё раз", `os:fc:${fu.taskId}:a`)
    .text("🤝 Клиент", `os:fc:${fu.taskId}:k`)
    .row()
    .text("✔️ Просто закрыть", `os:fc:${fu.taskId}:d`)
    .row()
    .text("‹ Назад", `os:fo:${fu.taskId}`);
  return {
    text: `${crumbs("Follow-up", fu.lead.name)}\n✅ <b>Закрыть follow-up</b> · ${e(fu.lead.name)}\nЧем закончилось? Статусы лида и обращения обновятся, задача закроется.`,
    kb,
  };
}

type FollowUpListItem = { taskId: string; leadId: string; task: Pick<Task, "deadlineAt">; lead: { name: string; status: LeadWithTasks["status"] } };

export function followUpListView(page: number, pageSize: number, data: { items: FollowUpListItem[]; total: number }, counts: { overdue: number; today: number; later: number }, now = new Date()): View {
  const pages = Math.max(1, Math.ceil(data.total / pageSize));
  const mark = (at: Date) => (at < now && relativeDay(at, now).startsWith("просрочено") ? "🔴" : relativeDay(at, now).startsWith("сегодня") ? "🟠" : "⚪");
  const rows = data.items.map(
    (f, i) => `${page * pageSize + i + 1}. ${mark(f.task.deadlineAt)} <b>${e(f.lead.name)}</b>\n     ${formatDayTime(f.task.deadlineAt)} · ${relativeDay(f.task.deadlineAt, now)} · ${statusText(f.lead.status)}`
  );
  const text = [
    crumbs("Follow-up"),
    `⏰ <b>FOLLOW-UP</b> · открытых ${data.total}`,
    `🔴 Просрочено <b>${counts.overdue}</b> · 🟠 Сегодня <b>${counts.today}</b> · ⚪ Позже <b>${counts.later}</b>`,
    DIV,
    rows.length ? rows.join("\n") : "Напоминаний нет. Follow-up ставится из карточки лида или после отправки письма.",
  ].join("\n");
  const kb = new InlineKeyboard();
  data.items.forEach((f, i) => {
    kb.text(clip(`${page * pageSize + i + 1} · ${f.lead.name}`, 30), `os:fo:${f.taskId}`);
    if (i % 2 === 1) kb.row();
  });
  kb.row();
  if (pages > 1) {
    if (page > 0) kb.text("‹", `os:fl:${page - 1}`);
    kb.text(`${page + 1}/${pages}`, `os:fl:${page}`);
    if (page < pages - 1) kb.text("›", `os:fl:${page + 1}`);
    kb.row();
  }
  kb.text("🏠 Меню", "os:home");
  return { text, kb };
}

// ---------------- аналитика ----------------

export function analyticsView(a: Analytics): View {
  const period = a.period ? `за ${a.period} дней` : "за всё время";
  const text = [
    crumbs("Аналитика"),
    `📊 <b>АНАЛИТИКА</b> · ${period}`,
    table([
      ["Всего лидов", a.total],
      ["Найдено", a.found],
      ["Сохранено", a.saved],
      ["Связались", a.contacted],
      ["Ответили", a.replied],
      ["Переговоры", a.negotiation],
      ["Клиенты", a.clients],
      ["Отказы", a.rejected],
    ]),
    "<b>Конверсия</b>",
    table([
      ["Contact rate", pct(a.rates.contact)],
      ["Reply rate", pct(a.rates.reply)],
      ["Conversion rate", pct(a.rates.conversion)],
    ]),
    "<i>Contact — связались из всех лидов · Reply — ответили из тех, с кем связались · Conversion — клиенты из тех, с кем связались. «—» — пока не из чего считать.</i>",
    "",
    `📨 Outreach: ${a.outreach.drafted} подготовлено · ${a.outreach.sent} отправлено · ${a.outreach.replies} ${plural(a.outreach.replies, ["ответ", "ответа", "ответов"])}`,
    `💰 Потенциальный оборот: ${a.clients} × ${money(a.avgCheck)} = <b>${money(a.clients * a.avgCheck)}</b>`,
    "<i>Это расчёт по введённому среднему чеку, а не гарантированный доход.</i>",
  ].join("\n");
  const p = (v: 0 | 7 | 30, label: string) => kb.text(`${(a.period ?? 0) === v ? "• " : ""}${label}`, `os:an:${v}`);
  const kb = new InlineKeyboard();
  p(0, "Всё время");
  p(7, "7 дней");
  p(30, "30 дней");
  kb.row().text("✏️ Средний чек", "ld:set:avg").row().text("🏠 Меню", "os:home");
  return { text, kb };
}

// ---------------- задачи ----------------

type TaskItem = Pick<Task, "id" | "title" | "deadlineAt" | "status"> & { leadLinks: { kind: string }[] };

export function tasksView(tasks: TaskItem[], total: number, appUrl?: string, now = new Date()): View {
  const rows = tasks.map((t) => {
    const overdue = t.deadlineAt < now;
    const tag = t.leadLinks.some((l) => l.kind === "FOLLOW_UP") ? "⏰ " : t.leadLinks.length ? "🎯 " : "";
    return `• ${tag}<b>${e(t.title)}</b>\n   ${overdue ? "⚠️ просрочено, " : "до "}${formatDayTime(t.deadlineAt)}${t.status === "IN_PROGRESS" ? " · в работе" : ""}`;
  });
  const text = [
    crumbs("Задачи"),
    `📋 <b>ЗАДАЧИ</b> · активных ${total}`,
    DIV,
    rows.length ? rows.join("\n") : "Активных задач нет. Всё чисто.",
    total > tasks.length ? `\n…и ещё ${total - tasks.length} — в приложении.` : "",
    "<i>🎯 — задача по лиду, ⏰ — follow-up.</i>",
  ].join("\n");
  const kb = new InlineKeyboard();
  if (appUrl) kb.webApp("📱 Открыть в приложении", appUrl).row();
  kb.text("⏰ Follow-up", "os:fl:0").text("🏠 Меню", "os:home");
  return { text, kb };
}
