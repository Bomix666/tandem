// Модуль «Поиск клиентов» в Telegram-боте. Подключается одной строкой из
// bot/index.ts (registerLeadsModule) и не меняет существующие команды.
//
// Сценарий: 🔎 Найти клиентов → ниша → город → количество → дополнительно →
// фоновый поиск → карточки лидов → предложение / задача / статус / сохранение.

import type { LeadStatus, User } from "@prisma/client";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { isYandexConfigured, leadsConfig } from "../../lib/leads/config";
import type { LeadSource } from "../../lib/leads/jobs";
import { createTaskFromLead } from "../../lib/leads/lead-tasks";
import { EMAIL_CHECK_EMOJI, LEAD_STATUS_ORDER, POTENTIAL_LABELS, statusText } from "../../lib/leads/labels";
import { createOutreachDraft, getOutreachGenerator } from "../../lib/leads/outreach";
import { osmLocalStatus } from "../../lib/leads/providers/osm-local";
import { redactError } from "../../lib/leads/redact";
import { CITY_PRESETS, NICHE_PRESETS } from "../../lib/leads/niches";
import {
  failInterruptedSearches,
  getLead,
  getLeadSettings,
  getLeadStats,
  getSearch,
  getSearchLeadAt,
  LEAD_FILTERS,
  listLeads,
  listSearches,
  nextLeadAfter,
  potentialBreakdown,
  setAvgCheck,
  setLeadStatus,
  setSenderField,
  toggleLeadSaved,
  type LeadFilter,
  type LeadWithTasks,
} from "../../lib/leads/repository";
import { socialLabel } from "../../lib/leads/scoring";
import type { SocialLink } from "../../lib/leads/types";
import { getUserWorkspace } from "../../lib/telegram-auth";
import { MENU } from "../menu";
import { chatState, type ChatState, type SenderField } from "../state";
import {
  e,
  emailLines,
  EXTRA_PRESETS,
  formatDate,
  formatMoney,
  historyView,
  leadCardKeyboard,
  myLeadsView,
  notConfiguredText,
  NO_PREVIEW,
  numberFromNav,
  parseMoney,
  renderLeadCard,
  settingsKeyboard,
  settingsText,
  statsText,
  statusPickerKeyboard,
  summaryKeyboard,
  summaryText,
  wizardConfirmView,
  wizardView,
  type Nav,
} from "./format";
import { launchSearch, searchNav } from "./runner";

export interface LeadsModuleDeps {
  resolveUser: (telegramId: number, firstName: string, username?: string) => Promise<User>;
  openAppKeyboard: () => InlineKeyboard;
}

type Workspace = NonNullable<Awaited<ReturnType<typeof getUserWorkspace>>>;
interface Ctx {
  user: User;
  workspace: Workspace;
  chatId: number;
}
type WizardState = Extract<ChatState, { kind: "lead_wizard" }>;

const PAGE_SIZE = 8;
const SENDER_PROMPTS: Record<SenderField, string> = {
  name: "✍️ Как тебя зовут? Имя появится в подписи предложений.",
  company: "🏢 Название студии или компании (если есть).",
  portfolio: "🔗 Ссылка на портфолио — например, https://behance.net/…",
  contact: "📞 Контакт для подписи: телефон или @username в Telegram.",
};
const lastQueries = new Map<number, string>(); // «🔍 Поиск» в «Мои лиды» — последний запрос чата

const ignoreNotModified = (err: Error) => {
  if (!/message is not modified/i.test(err.message)) throw err;
};
const listNav = (f: LeadFilter, leadId: string): Nav => ({ label: "➡️ Следующий", data: `ld:nx:m:${f}:${leadId}` });
const isFilter = (f: string | undefined): f is LeadFilter => !!f && (LEAD_FILTERS as string[]).includes(f);

export function registerLeadsModule(bot: Bot, deps: LeadsModuleDeps) {
  failInterruptedSearches()
    .then((n) => n && console.log(`Leads: прервано перезапуском поисков — ${n}`))
    .catch((err) => console.error("Leads: не удалось обновить прерванные поиски:", err));

  async function resolveCtx(ctx: Context): Promise<Ctx | null> {
    const from = ctx.from;
    const chatId = ctx.chat?.id ?? from?.id;
    if (!from || chatId === undefined) return null;
    const user = await deps.resolveUser(from.id, from.first_name, from.username);
    const workspace = await getUserWorkspace(user.id);
    if (!workspace) {
      await ctx.reply("Сначала откройте приложение, чтобы настроить рабочее пространство.", { reply_markup: deps.openAppKeyboard() });
      return null;
    }
    return { user, workspace, chatId };
  }

  // ---------------- мастер поиска ----------------

  async function renderWizard(ctx: Context, st: WizardState, mode: "edit" | "send") {
    const view =
      st.step === "confirm"
        ? wizardConfirmView(st.draft, { yandex: isYandexConfigured(), osm: leadsConfig.osmEnabled })
        : wizardView(st.step, st.draft);
    const opts = { parse_mode: "HTML" as const, reply_markup: view.kb, link_preview_options: NO_PREVIEW };
    if (mode === "edit") await ctx.editMessageText(view.text, opts).catch(ignoreNotModified);
    else await ctx.reply(view.text, opts);
  }

  async function startWizard(ctx: Context, c: Ctx, mode: "edit" | "send" = "send") {
    const st: WizardState = { kind: "lead_wizard", step: "niche", draft: {} };
    chatState.set(c.chatId, st);
    await renderWizard(ctx, st, mode);
  }

  async function wizardCallback(ctx: Context, c: Ctx, parts: string[]): Promise<string | undefined> {
    const act = parts[2];
    if (act === "x") {
      chatState.clear(c.chatId);
      await ctx.editMessageText("Поиск отменён.").catch(ignoreNotModified);
      return;
    }
    const st = chatState.get(c.chatId);
    if (!st || st.kind !== "lead_wizard") {
      await startWizard(ctx, c);
      return "Мастер устарел — начинаю заново";
    }
    const d = st.draft;
    const arg = parts[3] ?? "";
    switch (act) {
      case "n": {
        const preset = NICHE_PRESETS[Number(arg)];
        if (!preset) return;
        d.niche = preset.label;
        st.step = "city";
        break;
      }
      case "c": {
        const city = CITY_PRESETS[Number(arg)];
        if (!city) return;
        d.city = city;
        st.step = "count";
        break;
      }
      case "q":
        d.requested = Math.max(1, Math.min(30, Number(arg) || 10));
        st.step = "extra";
        break;
      case "e":
        d.extra = arg === "0" ? null : EXTRA_PRESETS[arg] ?? null;
        st.step = "confirm";
        break;
      case "go":
      case "osm": // кнопка из старых сообщений («только OSM»)
      case "ya": {
        if (st.step !== "confirm" || !d.niche || !d.city || !d.requested) return "Сначала заполни все шаги";
        const source: LeadSource = act === "ya" ? "yandex" : "osm";
        if (source === "yandex" && !isYandexConfigured()) {
          await ctx.editMessageText(notConfiguredText(), { parse_mode: "HTML" }).catch(ignoreNotModified);
          return;
        }
        const result = await launchSearch(ctx.api, {
          chatId: c.chatId,
          workspaceId: c.workspace.id,
          userId: c.user.id,
          niche: d.niche,
          city: d.city,
          requested: d.requested,
          extra: d.extra ?? null,
          source,
        });
        if (result !== "started") return result === "busy" ? "Поиск уже идёт — дождись результата" : "Поиск клиентов пока не настроен";
        chatState.clear(c.chatId);
        await ctx
          .editMessageText(`🔎 Запустил поиск: <b>${e(d.niche)}</b> · <b>${e(d.city)}</b> · ${d.requested}${source === "yandex" ? " · 🧪 Яндекс" : ""}`, {
            parse_mode: "HTML",
          })
          .catch(ignoreNotModified);
        return "Ищу…";
      }
      default:
        return;
    }
    chatState.set(c.chatId, st);
    await renderWizard(ctx, st, "edit");
  }

  async function wizardText(ctx: Context, c: Ctx, st: WizardState, text: string) {
    const d = st.draft;
    switch (st.step) {
      case "niche":
      case "city": {
        if (text.length < 2 || text.length > 60 || text.startsWith("/")) {
          await ctx.reply(st.step === "niche" ? "Название ниши — от 2 до 60 символов." : "Название города — от 2 до 60 символов.");
          return;
        }
        if (st.step === "niche") {
          d.niche = text.charAt(0).toUpperCase() + text.slice(1);
          st.step = "city";
        } else {
          d.city = text.charAt(0).toUpperCase() + text.slice(1);
          st.step = "count";
        }
        break;
      }
      case "count": {
        const n = Number(text.replace(/\D/g, ""));
        if (!n || n < 1 || n > 30) {
          await ctx.reply("Нужно число от 1 до 30.");
          return;
        }
        d.requested = n;
        st.step = "extra";
        break;
      }
      case "extra":
        d.extra = text.slice(0, 300);
        st.step = "confirm";
        break;
      case "confirm":
        await ctx.reply("Нажми «✅ Начать поиск» или «✖️ Отмена» в сообщении выше.");
        return;
    }
    chatState.set(c.chatId, st);
    await renderWizard(ctx, st, "send");
  }

  // ---------------- карточки ----------------

  async function sendOrEditCard(ctx: Context, lead: LeadWithTasks, nav: Nav, mode: "edit" | "send") {
    const text = renderLeadCard(lead, { number: numberFromNav(nav) });
    const opts = { parse_mode: "HTML" as const, reply_markup: leadCardKeyboard(lead, nav), link_preview_options: NO_PREVIEW };
    if (mode === "edit") await ctx.editMessageText(text, opts).catch(ignoreNotModified);
    else await ctx.reply(text, opts);
  }

  /** Кнопка навигации текущей карточки — чтобы после действий «Следующий» вёл туда же. */
  function navFromMessage(ctx: Context): Nav | null {
    const msg = ctx.callbackQuery?.message;
    const markup = msg && "reply_markup" in msg ? msg.reply_markup : undefined;
    for (const row of markup?.inline_keyboard ?? []) {
      for (const b of row) {
        if ("callback_data" in b && b.callback_data?.startsWith("ld:nx:")) return { label: b.text, data: b.callback_data };
      }
    }
    return null;
  }

  async function rerenderCard(ctx: Context, c: Ctx, leadId: string, view: "card" | "picker" = "card") {
    const lead = await getLead(leadId, c.workspace.id);
    if (!lead) return null;
    const nav = navFromMessage(ctx) ?? listNav("a", lead.id);
    if (view === "picker") await ctx.editMessageReplyMarkup({ reply_markup: statusPickerKeyboard(lead, nav) }).catch(ignoreNotModified);
    else await sendOrEditCard(ctx, lead, nav, "edit");
    return lead;
  }

  async function showSearchLead(ctx: Context, c: Ctx, searchId: string, pos: number, mode: "edit" | "send") {
    const r = await getSearchLeadAt(searchId, c.workspace.id, pos);
    if (!r) return "Поиск не найден";
    if (!r.lead) {
      if (r.total === 0) return "В этой подборке нет лидов";
      await ctx.reply(`🏁 Это был последний лид подборки «${e(r.search.niche)} · ${e(r.search.city)}».`, {
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard().text(`🔄 Найти ещё ${r.search.requested}`, `ld:more:${searchId}`),
      });
      return "Подборка закончилась";
    }
    const lead = await getLead(r.lead.id, c.workspace.id);
    if (!lead) return "Лид не найден";
    await sendOrEditCard(ctx, lead, searchNav(searchId, pos, r.total), mode);
    return;
  }

  async function sendContacts(ctx: Context, lead: LeadWithTasks) {
    const lines = [
      `📞 <b>Контакты «${e(lead.name)}»</b>`,
      "",
      `Телефон: ${lead.phones.length ? lead.phones.map(e).join(", ") : "Не найден"}`,
      "Email:",
      ...emailLines(lead),
      `Адрес: ${lead.address ? e(lead.address) : "Не найден"}`,
      lead.hours ? `Режим работы: ${e(lead.hours)}` : null,
      `Сайт: ${lead.website ? e(lead.website) : "Не найден"}`,
    ].filter((l): l is string => l !== null);
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: NO_PREVIEW });
  }

  async function sendSocials(ctx: Context, lead: LeadWithTasks): Promise<string | undefined> {
    const socials = (lead.socials as unknown as SocialLink[] | null) ?? [];
    if (!socials.length) return "Соцсети не найдены";
    const kb = new InlineKeyboard();
    socials.forEach((s, i) => {
      kb.url(socialLabel(s.type), s.url);
      if (i % 2 === 1) kb.row();
    });
    await ctx.reply(`📱 <b>Соцсети «${e(lead.name)}»</b>`, { parse_mode: "HTML", reply_markup: kb });
    return;
  }

  async function makeProposal(ctx: Context, c: Ctx, lead: LeadWithTasks) {
    const draft = await createOutreachDraft({ lead, channel: "EMAIL", actorId: c.user.id });
    const contact = lead.contacts.find((x) => x.value === draft.recipient);
    const to = draft.recipient
      ? `Кому: ${contact?.verification ? `${EMAIL_CHECK_EMOJI[contact.verification]} ` : ""}${e(draft.recipient)}`
      : "Кому: email не найден — отправь через телефон или соцсети";
    const head = [
      `✨ <b>Предложение для «${e(lead.name)}»</b>`,
      to,
      draft.text.subject ? `Тема: ${e(draft.text.subject)}` : null,
      `Сделано: ${e(draft.engine)}.${draft.note ? ` ${e(draft.note)}` : ""}`,
      ...draft.text.warnings.map((w) => `⚠️ ${e(w)}`),
      "Проверь текст перед отправкой — бот ничего не отправляет сам.",
    ].filter((l): l is string => l !== null);
    await ctx.reply(head.join("\n"), { parse_mode: "HTML" });
    const contacted = LEAD_STATUS_ORDER.indexOf("CONTACTED");
    await ctx.reply(draft.text.body, { reply_markup: new InlineKeyboard().text("💬 Отметить: Написали", `ld:sq:${lead.id}:${contacted}`) });
  }

  async function makeTask(ctx: Context, c: Ctx, leadId: string, force: boolean): Promise<string | undefined> {
    const result = await createTaskFromLead({ leadId, workspace: c.workspace, user: c.user, force });
    if (result.status === "not_found") return "Лид не найден";
    if (result.status === "exists") {
      await ctx.reply(
        `⚠️ У этого лида уже есть задача «${e(result.task.title)}» (создана ${formatDate(result.task.createdAt)}).\nСоздать ещё одну?`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("➕ Да, создать ещё одну", `ld:tkf:${leadId}`) }
      );
      return "Задача уже есть";
    }
    const text = `✅ <b>Задача создана</b>\n«${e(result.task.title)}»\nСрок: через 24 часа · Приоритет: ${POTENTIAL_LABELS[result.task.priority as "HIGH" | "MEDIUM" | "LOW"] ?? result.task.priority}\nВсе данные лида — в описании задачи.`;
    if (force) await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: deps.openAppKeyboard() }).catch(ignoreNotModified);
    else {
      await rerenderCard(ctx, c, leadId);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: deps.openAppKeyboard() });
    }
    return "Задача создана";
  }

  // ---------------- списки ----------------

  async function showMyLeads(ctx: Context, c: Ctx, filter: LeadFilter, page: number, mode: "edit" | "send") {
    let query = filter === "q" ? lastQueries.get(c.chatId) : undefined;
    if (filter === "q" && !query) filter = "a";
    const data = await listLeads(c.workspace.id, filter, page, query, PAGE_SIZE);
    const view = myLeadsView(filter, page, PAGE_SIZE, data, query);
    const opts = { parse_mode: "HTML" as const, reply_markup: view.kb };
    if (mode === "edit") await ctx.editMessageText(view.text, opts).catch(ignoreNotModified);
    else await ctx.reply(view.text, opts);
  }

  async function showHistory(ctx: Context, c: Ctx, page: number, mode: "edit" | "send") {
    const data = await listSearches(c.workspace.id, page, PAGE_SIZE);
    const view = historyView(page, PAGE_SIZE, data);
    const opts = { parse_mode: "HTML" as const, reply_markup: view.kb };
    if (mode === "edit") await ctx.editMessageText(view.text, opts).catch(ignoreNotModified);
    else await ctx.reply(view.text, opts);
  }

  async function showStats(ctx: Context, c: Ctx) {
    const stats = await getLeadStats(c.workspace.id);
    await ctx.reply(statsText(stats), {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard().text("✏️ Изменить средний чек", "ld:set:avg"),
    });
  }

  async function showSettings(ctx: Context, c: Ctx) {
    const settings = await getLeadSettings(c.workspace.id);
    const { generator } = getOutreachGenerator();
    const osmLocal = await osmLocalStatus().catch(() => "состояние неизвестно");
    await ctx.reply(
      settingsText({ ...settings, yandex: isYandexConfigured(), osm: leadsConfig.osmEnabled, osmLocal, proposalLabel: generator.label }),
      { parse_mode: "HTML", reply_markup: settingsKeyboard(), link_preview_options: NO_PREVIEW }
    );
  }

  /** «Найти ещё» (продолжение с пропуском найденного) или «Повторить» (тот же поиск заново). */
  async function relaunch(ctx: Context, c: Ctx, searchId: string, mode: "more" | "retry"): Promise<string | undefined> {
    const prev = await getSearch(searchId, c.workspace.id);
    if (!prev) return "Поиск не найден";
    const source: LeadSource = prev.source === "yandex" ? "yandex" : "osm";
    if (source === "yandex" && !isYandexConfigured()) {
      await ctx.reply(notConfiguredText(), { parse_mode: "HTML" });
      return;
    }
    const result = await launchSearch(ctx.api, {
      chatId: c.chatId,
      workspaceId: c.workspace.id,
      userId: c.user.id,
      niche: prev.niche,
      city: prev.city,
      requested: prev.requested,
      extra: prev.extra,
      source,
      parent: mode === "more" ? prev : undefined,
    });
    if (result !== "started") return result === "busy" ? "Поиск уже идёт — дождись результата" : "Поиск клиентов пока не настроен";
    return mode === "more" ? "Ищу ещё…" : "Повторяю поиск…";
  }

  // ---------------- маршрутизация кнопок ----------------

  async function routeCallback(ctx: Context, c: Ctx, parts: string[]): Promise<string | undefined> {
    const [, action, a1 = "", a2 = "", a3 = ""] = parts;
    switch (action) {
      case "w":
        return wizardCallback(ctx, c, parts);

      case "nx":
      case "o": {
        const mode = action === "nx" ? "edit" : "send";
        if (a1 === "s") return showSearchLead(ctx, c, a2, Number(a3), mode);
        if (a1 === "m" && isFilter(a2)) {
          const query = a2 === "q" ? lastQueries.get(c.chatId) : undefined;
          const next = await nextLeadAfter(c.workspace.id, a2, a3, query);
          if (!next) return "Это последний лид в списке";
          const lead = await getLead(next.id, c.workspace.id);
          if (lead) await sendOrEditCard(ctx, lead, listNav(a2, lead.id), "edit");
        }
        return;
      }
      case "ol": {
        if (!isFilter(a1)) return;
        const lead = await getLead(a2, c.workspace.id);
        if (!lead) return "Лид не найден";
        await sendOrEditCard(ctx, lead, listNav(a1, lead.id), "send");
        return;
      }

      case "site": {
        const lead = await getLead(a1, c.workspace.id);
        if (!lead) return "Лид не найден";
        const booking = lead.bookingPage as { name: string; url: string } | null;
        if (lead.websiteKind === "booking" && booking) {
          await ctx.reply(`Собственный сайт не найден. Запись идёт через ${e(booking.name)}:`, {
            parse_mode: "HTML",
            reply_markup: new InlineKeyboard().url(`Открыть ${booking.name}`, booking.url),
          });
          return "Собственный сайт не найден";
        }
        if (lead.websiteKind === "social") return "Собственного сайта нет — вместо него соцсеть, смотри «📱 Соцсети»";
        return "Сайт не найден ни в одном источнике";
      }
      case "soc": {
        const lead = await getLead(a1, c.workspace.id);
        return lead ? sendSocials(ctx, lead) : "Лид не найден";
      }
      case "ct": {
        const lead = await getLead(a1, c.workspace.id);
        if (!lead) return "Лид не найден";
        await sendContacts(ctx, lead);
        return;
      }
      case "pr": {
        const lead = await getLead(a1, c.workspace.id);
        if (!lead) return "Лид не найден";
        await makeProposal(ctx, c, lead);
        return "Готово";
      }
      case "tk":
      case "tkf":
        return makeTask(ctx, c, a1, action === "tkf");
      case "sv": {
        const saved = await toggleLeadSaved(a1, c.workspace.id, c.user.id);
        if (saved === null) return "Лид не найден";
        await rerenderCard(ctx, c, a1);
        return saved ? "❤️ Лид сохранён" : "Убран из сохранённых";
      }
      case "st":
        await rerenderCard(ctx, c, a1, "picker");
        return "Выбери статус";
      case "bk":
        await rerenderCard(ctx, c, a1);
        return;
      case "ss":
      case "sq": {
        const status = LEAD_STATUS_ORDER[Number(a2)] as LeadStatus | undefined;
        if (!status || !(await setLeadStatus(a1, c.workspace.id, status, c.user.id))) return "Лид не найден";
        if (action === "ss") await rerenderCard(ctx, c, a1);
        else await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(ignoreNotModified);
        return `Статус: ${statusText(status)}`;
      }

      case "ml":
        if (!isFilter(a1)) return;
        await showMyLeads(ctx, c, a1, Math.max(0, Number(a2) || 0), "edit");
        return;
      case "mq":
        chatState.set(c.chatId, { kind: "lead_name_query" });
        await ctx.reply("🔍 Напиши часть названия бизнеса.");
        return;
      case "h":
        await showHistory(ctx, c, Math.max(0, Number(a1) || 0), "edit");
        return;
      case "ho": {
        const s = await getSearch(a1, c.workspace.id);
        if (!s) return "Поиск не найден";
        const breakdown = await potentialBreakdown(s.id);
        await ctx.reply(summaryText(s, breakdown, { fromHistory: true }), { parse_mode: "HTML", reply_markup: summaryKeyboard(s) });
        return;
      }
      case "more":
        return relaunch(ctx, c, a1, "more");
      case "retry":
        return relaunch(ctx, c, a1, "retry");
      case "set":
        if (a1 === "avg") {
          chatState.set(c.chatId, { kind: "lead_avg_check" });
          await ctx.reply("Напиши средний чек в рублях, например: 50000");
        } else if (a1 in SENDER_PROMPTS) {
          chatState.set(c.chatId, { kind: "lead_sender", field: a1 as SenderField });
          await ctx.reply(`${SENDER_PROMPTS[a1 as SenderField]}\n\nЧтобы очистить поле, отправь «-».`);
        }
        return;
      default:
        return;
    }
  }

  // ---------------- регистрация ----------------

  const withCtx = (fn: (ctx: Context, c: Ctx) => Promise<unknown>) => async (ctx: Context) => {
    const c = await resolveCtx(ctx);
    if (c) await fn(ctx, c);
  };

  const openWizard = withCtx((ctx, c) => startWizard(ctx, c));
  const openLeads = withCtx((ctx, c) => {
    chatState.clear(c.chatId);
    return showMyLeads(ctx, c, "a", 0, "send");
  });
  bot.hears(MENU.findClients, openWizard);
  bot.command("find", openWizard);
  bot.hears(MENU.myLeads, openLeads);
  bot.command("leads", openLeads);
  bot.hears(
    MENU.history,
    withCtx((ctx, c) => {
      chatState.clear(c.chatId);
      return showHistory(ctx, c, 0, "send");
    })
  );
  bot.hears(
    MENU.stats,
    withCtx((ctx, c) => {
      chatState.clear(c.chatId);
      return showStats(ctx, c);
    })
  );
  bot.hears(
    MENU.settings,
    withCtx((ctx, c) => {
      chatState.clear(c.chatId);
      return showSettings(ctx, c);
    })
  );

  bot.callbackQuery(/^ld:/, async (ctx) => {
    let toast: string | undefined;
    try {
      const c = await resolveCtx(ctx);
      if (c) toast = await routeCallback(ctx, c, ctx.callbackQuery.data.split(":"));
    } catch (err) {
      console.error("Leads callback failed:", redactError(err));
      toast = "Что-то пошло не так, попробуй ещё раз";
    }
    await ctx.answerCallbackQuery(toast ? { text: toast } : undefined).catch(() => void 0);
  });

  // Текстовый ввод для шагов мастера, поиска по названию и настроек.
  // Если чат ничего такого не ждёт — передаём дальше (next).
  bot.on("message:text", async (ctx, next) => {
    const st = chatState.get(ctx.chat.id);
    if (!st || st.kind === "new_task") return next();
    const c = await resolveCtx(ctx);
    if (!c) return;
    const text = ctx.message.text.trim();

    if (st.kind === "lead_wizard") return wizardText(ctx, c, st, text);
    if (st.kind === "lead_name_query") {
      if (text.length < 2) {
        await ctx.reply("Нужно хотя бы 2 символа.");
        return;
      }
      chatState.clear(c.chatId);
      lastQueries.set(c.chatId, text.slice(0, 60));
      return showMyLeads(ctx, c, "q", 0, "send");
    }
    if (st.kind === "lead_sender") {
      const value = text === "-" ? null : text.slice(0, 200);
      if (value && st.field === "portfolio" && !/^https?:\/\/\S+\.\S+/i.test(value)) {
        await ctx.reply("Нужна ссылка вида https://… — или «-», чтобы очистить.");
        return;
      }
      chatState.clear(c.chatId);
      await setSenderField(c.workspace.id, st.field, value);
      await ctx.reply(value ? "✅ Сохранил. Подпись добавится в новые предложения." : "✅ Поле очищено.");
      return showSettings(ctx, c);
    }
    if (st.kind === "lead_avg_check") {
      const value = parseMoney(text);
      if (!value) {
        await ctx.reply("Не понял сумму. Напиши число, например: 50000");
        return;
      }
      chatState.clear(c.chatId);
      await setAvgCheck(c.workspace.id, value);
      await ctx.reply(`✅ Средний чек: ${formatMoney(value)}. Он используется только для расчёта в «📊 Статистика».`);
    }
  });
}
