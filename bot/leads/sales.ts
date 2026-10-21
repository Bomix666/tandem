// Sales OS в боте: дашборд, Outreach (редактор, отметки отправки и итога),
// follow-up, аналитика, задачи. Кнопки — префикс os: (см. sales-views.ts).
// Навигация кнопками редактирует одно сообщение; новое сообщение — только для
// «📋 Копировать», запросов текста и кнопок меню внизу чата.
//
// Без спроса клиенту ничего не уходит: письмо — по кнопке «📤 Отправить
// письмо» (bot/leads/mail.ts), остальное пользователь отправляет сам и жмёт «✅ Я отправил».

import type { OutreachChannel } from "@prisma/client";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { getAnalytics, type AnalyticsPeriod } from "../../lib/leads/analytics";
import { getDashboard } from "../../lib/leads/dashboard";
import { closeFollowUp, followUpCounts, getFollowUp, listFollowUps, openFollowUp, setFollowUp, snoozeFollowUp, type FollowUpClose } from "../../lib/leads/followups";
import { outreachStatusText, statusText } from "../../lib/leads/labels";
import {
  discardDraft,
  editOutreachText,
  getOutreach,
  generatorLabel,
  getOutreachGenerator,
  listOutreach,
  markOutreachSent,
  outreachCounts,
  outreachWarnings,
  prepareOutreach,
  setOutreachOutcome,
  type OutreachOutcome,
} from "../../lib/leads/outreach";
import { getMailAccount } from "../../lib/leads/mail/account";
import { outreachMailUrl } from "../../lib/leads/outreach/links";
import { getLead, type LeadFilter } from "../../lib/leads/repository";
import { daysFromNow, parseUserDate } from "../../lib/leads/time";
import { prisma } from "../../lib/prisma";
import { MENU, LEGACY_MENU } from "../menu";
import { chatState, type ChatState } from "../state";
import { safeDelete, show, type Ctx, type ShowMode } from "./context";
import {
  analyticsView,
  channelPickerView,
  closeFollowUpView,
  copyView,
  dashboardView,
  followUpCardView,
  followUpListView,
  followUpPickerView,
  followUpSetView,
  outreachEditorView,
  outreachListView,
  outreachOverviewView,
  snoozeView,
  STATUS_BY_CODE,
  tasksView,
  type FollowUpTarget,
} from "./sales-views";
import { e } from "./ui";

export interface SalesShared {
  resolveCtx(ctx: Context): Promise<Ctx | null>;
  openLead(ctx: Context, c: Ctx, leadId: string, mode: ShowMode, filter?: LeadFilter): Promise<string | undefined>;
  showMyLeads(ctx: Context, c: Ctx, filter: LeadFilter, page: number, mode: ShowMode): Promise<void>;
  startWizard(ctx: Context, c: Ctx, mode: ShowMode): Promise<void>;
  showSettings(ctx: Context, c: Ctx, mode: ShowMode): Promise<void>;
  appUrl?: string;
}

const PAGE = 8;
const CHANNEL_BY_CODE: Record<string, OutreachChannel> = { T: "TELEGRAM", W: "WHATSAPP", S: "SOCIAL" };
const OUTCOME_BY_CODE: Record<string, OutreachOutcome> = { r: "replied", x: "rejected", k: "client" };
const CLOSE_BY_CODE: Record<string, FollowUpClose> = { r: "replied", x: "rejected", k: "client", a: "again", d: "done" };
const OUTCOME_TOAST: Record<OutreachOutcome, string> = { replied: "👀 Ответ отмечен · лид → 💬 Переговоры", rejected: "❌ Отказ отмечен", client: "🤝 Клиент! Поздравляю" };

export function registerSalesOs(bot: Bot, shared: SalesShared) {
  const { resolveCtx } = shared;
  /** Лид:канал, по которым Claude сейчас пишет текст, — без двойных черновиков. */
  const writing = new Set<string>();

  // ---------------- экраны ----------------

  async function home(ctx: Context, c: Ctx, mode: ShowMode) {
    const now = new Date();
    await show(ctx, dashboardView(await getDashboard(c.workspace.id, now), now, shared.appUrl), mode);
  }

  async function overview(ctx: Context, c: Ctx, mode: ShowMode) {
    const [counts, d] = await Promise.all([outreachCounts(c.workspace.id), getDashboard(c.workspace.id)]);
    await show(ctx, outreachOverviewView(counts, d.outreachToday), mode);
  }

  async function editor(ctx: Context, c: Ctx, outreachId: string, mode: ShowMode, notice?: string): Promise<string | undefined> {
    const o = await getOutreach(outreachId, c.workspace.id);
    if (!o) return "Обращение не найдено";
    const view = outreachEditorView(o, {
      warnings: await outreachWarnings(o),
      engine: generatorLabel(o.generator),
      mailUrl: o.channel === "EMAIL" ? outreachMailUrl(o.id) : null,
      gmail: o.channel === "EMAIL" && !!(await getMailAccount(c.workspace.id)),
      notice,
    });
    await show(ctx, view, mode);
    return;
  }

  async function prepare(ctx: Context, c: Ctx, leadId: string, channel: OutreachChannel, regenerate = false): Promise<string | undefined> {
    const lead = await getLead(leadId, c.workspace.id);
    if (!lead) return "Лид не найден";
    const key = `${lead.id}:${channel}`;
    if (writing.has(key)) return "✍️ Уже пишу, подожди";
    const finish = async () => {
      const p = await prepareOutreach({ lead, channel, actorId: c.user.id, regenerate });
      const notice = p.reused ? "📝 <i>Открыт сохранённый черновик — новый не создавал.</i>" : regenerate ? "🔄 <i>Новый вариант текста.</i>" : undefined;
      await editor(ctx, c, p.outreach.id, "edit", [notice, p.note && !p.reused ? `⚠️ <i>${e(p.note)}</i>` : null].filter(Boolean).join("\n") || undefined);
      return p.reused ? "Открыл черновик" : regenerate ? "Новый вариант" : "Черновик готов";
    };
    if (getOutreachGenerator().generator.id !== "claude") return finish();

    // Claude пишет 10–40 с: не держим очередь бота — показываем «пишу…» и дописываем в фоне
    writing.add(key);
    await show(ctx, { text: `✍️ Пишу текст под «${e(lead.name)}»…\n<i>Claude смотрит сайт и данные бизнеса, это до минуты.</i>`, kb: new InlineKeyboard() }, "edit");
    void finish()
      .catch(async (err) => {
        const { redactError } = await import("../../lib/leads/redact");
        console.error("Outreach prepare failed:", redactError(err));
        await show(ctx, { text: "Не получилось подготовить текст, попробуй ещё раз.", kb: new InlineKeyboard().text("‹ К лиду", `ld:bk:${lead.id}`) }, "edit").catch(() => void 0);
      })
      .finally(() => writing.delete(key));
    return "✍️ Пишу…";
  }

  async function followUpTarget(c: Ctx, scope: string, id: string): Promise<FollowUpTarget | null> {
    if (scope === "o") {
      const o = await getOutreach(id, c.workspace.id);
      if (!o) return null;
      const open = await openFollowUp(o.leadId);
      return { scope: "o", id, leadId: o.leadId, leadName: o.lead.name, current: open?.task.deadlineAt ?? null };
    }
    const lead = await prisma.lead.findFirst({ where: { id, workspaceId: c.workspace.id }, select: { id: true, name: true } });
    if (!lead) return null;
    const open = await openFollowUp(lead.id);
    return { scope: "l", id, leadId: lead.id, leadName: lead.name, current: open?.task.deadlineAt ?? null };
  }

  async function applyFollowUp(ctx: Context, c: Ctx, t: FollowUpTarget, at: Date, mode: ShowMode) {
    const r = await setFollowUp({ leadId: t.leadId, workspaceId: c.workspace.id, userId: c.user.id, at, outreachId: t.scope === "o" ? t.id : null });
    if (!r) return "Лид не найден";
    await show(ctx, followUpSetView(t.leadId, t.leadName, r.at, r.created, r.taskId), mode);
    return r.created ? "⏰ Follow-up поставлен" : "⏰ Follow-up перенесён";
  }

  async function followUpList(ctx: Context, c: Ctx, page: number, mode: ShowMode) {
    const [data, counts] = await Promise.all([listFollowUps(c.workspace.id, page, PAGE), followUpCounts(c.workspace.id)]);
    await show(ctx, followUpListView(page, PAGE, data, counts), mode);
  }

  async function analytics(ctx: Context, c: Ctx, period: AnalyticsPeriod, mode: ShowMode) {
    await show(ctx, analyticsView(await getAnalytics(c.workspace.id, period)), mode);
  }

  async function tasks(ctx: Context, c: Ctx, mode: ShowMode) {
    const where = { workspaceId: c.workspace.id, status: { not: "DONE" as const } };
    const [items, total] = await Promise.all([
      prisma.task.findMany({ where, orderBy: { deadlineAt: "asc" }, take: 10, include: { leadLinks: { select: { kind: true } } } }),
      prisma.task.count({ where }),
    ]);
    await show(ctx, tasksView(items, total, shared.appUrl), mode);
  }

  // ---------------- кнопки ----------------

  async function route(ctx: Context, c: Ctx, parts: string[]): Promise<string | undefined> {
    const [, action, a1 = "", a2 = "", a3 = ""] = parts;
    switch (action) {
      case "home":
        await home(ctx, c, "edit");
        return;
      case "find":
        await shared.startWizard(ctx, c, "edit");
        return;
      case "set":
        await shared.showSettings(ctx, c, "edit");
        return;
      case "out":
        await overview(ctx, c, "edit");
        return;
      case "ol": {
        const status = STATUS_BY_CODE[a1];
        if (!status) return;
        const page = Math.max(0, Number(a2) || 0);
        await show(ctx, outreachListView(status, page, PAGE, await listOutreach(c.workspace.id, status, page, PAGE)), "edit");
        return;
      }
      case "o":
        return editor(ctx, c, a1, "edit");
      case "pe":
        return prepare(ctx, c, a1, "EMAIL");
      case "pm": {
        const channel = CHANNEL_BY_CODE[a2];
        return channel ? prepare(ctx, c, a1, channel) : undefined;
      }
      case "ch": {
        const lead = await getLead(a1, c.workspace.id);
        if (!lead) return "Лид не найден";
        await show(ctx, channelPickerView(lead), "edit");
        return;
      }
      case "or": {
        const o = await getOutreach(a1, c.workspace.id);
        if (!o) return "Обращение не найдено";
        return prepare(ctx, c, o.leadId, o.channel, true);
      }
      case "oe": {
        const o = await getOutreach(a1, c.workspace.id);
        if (!o) return "Обращение не найдено";
        const prompt = await ctx.reply(
          `✏️ Пришли новый текст ${o.channel === "EMAIL" ? "письма" : "сообщения"} одним сообщением.${o.channel === "EMAIL" ? "\nЧтобы поменять тему, начни с первой строки «Тема: …»." : ""}`,
          { reply_markup: new InlineKeyboard().text("✖️ Отмена", "os:cx") }
        );
        chatState.set(c.chatId, { kind: "outreach_edit", outreachId: o.id, editorMessageId: ctx.callbackQuery?.message?.message_id, promptMessageId: prompt.message_id });
        return "Жду текст";
      }
      case "oc": {
        const o = await getOutreach(a1, c.workspace.id);
        if (!o) return "Обращение не найдено";
        await show(ctx, copyView(o), "send");
        return "Нажми на блок с текстом, чтобы скопировать";
      }
      case "os": {
        const sent = await markOutreachSent(a1, c.workspace.id, c.user.id);
        if (!sent) return "Уже отмечено или черновик удалён";
        const t = await followUpTarget(c, "o", a1);
        if (t) await show(ctx, followUpPickerView(t, { notice: `✅ <b>Отмечено как отправленное.</b> Лид → ${statusText("CONTACTED")}`, skip: true }), "edit");
        return "📨 Отмечено как отправленное";
      }
      case "ox": {
        const r = await discardDraft(a1, c.workspace.id);
        if (!r) return "Черновик уже отправлен или удалён";
        await shared.openLead(ctx, c, r.leadId, "edit");
        return "Черновик удалён";
      }
      case "oo": {
        const outcome = OUTCOME_BY_CODE[a2];
        if (!outcome) return;
        const o = await setOutreachOutcome(a1, c.workspace.id, outcome, c.user.id);
        if (!o) return "Обращение не найдено";
        await editor(ctx, c, a1, "edit", `${OUTCOME_TOAST[outcome]} · обращение: ${outreachStatusText(o.status)}`);
        return OUTCOME_TOAST[outcome];
      }

      // ---- follow-up ----
      case "fp": {
        const t = await followUpTarget(c, a1, a2);
        if (!t) return "Лид не найден";
        await show(ctx, followUpPickerView(t), "edit");
        return;
      }
      case "fs": {
        const t = await followUpTarget(c, a1, a2);
        const days = Number(a3);
        if (!t || !days) return "Лид не найден";
        return applyFollowUp(ctx, c, t, daysFromNow(days), "edit");
      }
      case "fd": {
        const t = await followUpTarget(c, a1, a2);
        if (!t) return "Лид не найден";
        const prompt = await ctx.reply(
          `📅 Когда напомнить про «${t.leadName}»? Напиши дату: «05.10», «05.10 15:00», «завтра», «через 3 дня».`,
          { reply_markup: new InlineKeyboard().text("✖️ Отмена", "os:cx") }
        );
        chatState.set(c.chatId, { kind: "followup_date", scope: t.scope, id: t.id, promptMessageId: prompt.message_id });
        return "Жду дату";
      }
      case "fl":
        await followUpList(ctx, c, Math.max(0, Number(a1) || 0), "edit");
        return;
      case "fo": {
        const fu = await getFollowUp(a1, c.workspace.id);
        if (!fu) return "Follow-up не найден";
        await show(ctx, followUpCardView(fu), "edit");
        return;
      }
      case "fz": {
        const fu = await getFollowUp(a1, c.workspace.id);
        if (!fu) return "Follow-up не найден";
        if (fu.task.status === "DONE") return "Этот follow-up уже закрыт";
        if (!a2) {
          await show(ctx, snoozeView(fu), "edit");
          return;
        }
        const r = await snoozeFollowUp(a1, c.workspace.id, c.user.id, Math.max(1, Number(a2) || 1));
        if (!r) return "Follow-up не найден";
        await show(ctx, followUpSetView(fu.leadId, fu.lead.name, r.at, false, r.taskId), "edit");
        return "⏰ Отложено";
      }
      case "fc": {
        const fu = await getFollowUp(a1, c.workspace.id);
        if (!fu) return "Follow-up не найден";
        if (fu.task.status === "DONE") return "Этот follow-up уже закрыт";
        const how = CLOSE_BY_CODE[a2];
        if (!how) {
          await show(ctx, closeFollowUpView(fu), "edit");
          return;
        }
        await closeFollowUp(a1, c.workspace.id, c.user.id, how);
        if (how === "again") {
          const t = fu.outreachId ? await followUpTarget(c, "o", fu.outreachId) : await followUpTarget(c, "l", fu.leadId);
          if (t) await show(ctx, followUpPickerView(t, { notice: "🔁 <b>Отмечено: написал ещё раз.</b> Когда напомнить снова?", skip: true }), "edit");
          return "🔁 Отмечено";
        }
        const lead = await prisma.lead.findUnique({ where: { id: fu.leadId }, select: { status: true } });
        const view = {
          text: `✅ <b>Follow-up закрыт</b> · ${e(fu.lead.name)}\nСтатус лида: ${lead ? statusText(lead.status) : "—"}`,
          kb: new InlineKeyboard().text("👀 Открыть лид", `ld:ol:a:${fu.leadId}`).text("⏰ Follow-up", "os:fl:0").row().text("🏠 Меню", "os:home"),
        };
        await show(ctx, view, "edit");
        return "✅ Закрыто";
      }

      case "an": {
        const p = Number(a1);
        await analytics(ctx, c, p === 7 || p === 30 ? p : null, "edit");
        return;
      }
      case "tk":
        await tasks(ctx, c, "edit");
        return;
      case "del":
        await ctx.deleteMessage().catch(() => void 0);
        return;
      case "cx": {
        chatState.clear(c.chatId);
        await ctx.deleteMessage().catch(() => void 0);
        return "Отменено";
      }
      default:
        return;
    }
  }

  bot.callbackQuery(/^os:/, async (ctx) => {
    let toast: string | undefined;
    try {
      const c = await resolveCtx(ctx);
      if (c) toast = await route(ctx, c, ctx.callbackQuery.data.split(":"));
    } catch (err) {
      const { redactError } = await import("../../lib/leads/redact");
      console.error("Sales OS callback failed:", redactError(err));
      toast = "Что-то пошло не так, попробуй ещё раз";
    }
    await ctx.answerCallbackQuery(toast ? { text: toast } : undefined).catch(() => void 0);
  });

  // ---------------- кнопки меню внизу ----------------

  const withCtx = (fn: (ctx: Context, c: Ctx) => Promise<unknown>) => async (ctx: Context) => {
    const c = await resolveCtx(ctx);
    if (!c) return;
    chatState.clear(c.chatId);
    await fn(ctx, c);
  };
  bot.hears(MENU.home, withCtx((ctx, c) => home(ctx, c, "send")));
  bot.command("os", withCtx((ctx, c) => home(ctx, c, "send")));
  bot.hears(MENU.outreach, withCtx((ctx, c) => overview(ctx, c, "send")));
  bot.hears(MENU.followUp, withCtx((ctx, c) => followUpList(ctx, c, 0, "send")));
  bot.hears([MENU.analytics, LEGACY_MENU.stats], withCtx((ctx, c) => analytics(ctx, c, null, "send")));
  bot.hears(MENU.tasks, withCtx((ctx, c) => tasks(ctx, c, "send")));

  // ---------------- текстовый ввод ----------------

  /** Свой текст обращения / своя дата follow-up. true — сообщение обработано. */
  async function handleText(ctx: Context, c: Ctx, st: ChatState, text: string): Promise<boolean> {
    if (st.kind === "outreach_edit") {
      if (text.length < 10) {
        await ctx.reply("Слишком коротко — пришли текст целиком или нажми «✖️ Отмена».");
        return true;
      }
      chatState.clear(c.chatId);
      const updated = await editOutreachText(st.outreachId, c.workspace.id, text);
      if (!updated) {
        await ctx.reply("Это обращение уже отмечено отправленным или удалено — править его нельзя.");
        return true;
      }
      await safeDelete(ctx, c.chatId, st.promptMessageId);
      await safeDelete(ctx, c.chatId, ctx.message?.message_id);
      await safeDelete(ctx, c.chatId, st.editorMessageId);
      await editor(ctx, c, st.outreachId, "send", "✏️ <i>Текст обновлён — проверь перед отправкой.</i>");
      return true;
    }
    if (st.kind === "followup_date") {
      const at = parseUserDate(text);
      if (!at) {
        await ctx.reply("Не понял дату. Примеры: «05.10», «05.10 15:00», «завтра», «через 3 дня». Дата должна быть в будущем.");
        return true;
      }
      chatState.clear(c.chatId);
      const t = await followUpTarget(c, st.scope, st.id);
      await safeDelete(ctx, c.chatId, st.promptMessageId);
      if (!t) {
        await ctx.reply("Лид не найден.");
        return true;
      }
      await applyFollowUp(ctx, c, t, at, "send");
      return true;
    }
    return false;
  }

  return { home, handleText, prepare };
}
