// Gmail в боте: подключение ящика, «📤 Отправить через Gmail», ответы клиентов
// с черновиком от Claude на одобрение. Кнопки — префикс ml:
//   ml:gm Gmail · ml:gc подключить · ml:gx отключить · ml:pr цены и сроки
//   ml:sq:<обращение> подтвердить отправку · ml:sy:<обращение> отправить
//   ml:ra|re|rs:<черновик> отправить ответ · изменить · отвечу сам
//   ml:rg:<обращение> написать ответ заново
// Ответы проверяются раз в 2 минуты (LEADS_MAIL_POLL_MS, 0 — выключить).

import { InlineKeyboard, type Bot, type Context } from "grammy";
import { openFollowUp } from "../../lib/leads/followups";
import { statusText } from "../../lib/leads/labels";
import { disconnectMailAccount, getMailAccount, normalizeAppPassword, normalizeGmail, saveMailAccount } from "../../lib/leads/mail/account";
import { verifyAccount } from "../../lib/leads/mail/gmail";
import { pollInboxes, prepareReplyDraft, type IncomingEvent } from "../../lib/leads/mail/inbox";
import { dropReplyDraft, getReplyDraft, sendOutreachEmail, sendReplyDraft, updateReplyDraft } from "../../lib/leads/mail/send";
import { getOutreach, getOutreachGenerator } from "../../lib/leads/outreach";
import { redactError } from "../../lib/leads/redact";
import { getLeadSettings } from "../../lib/leads/repository";
import { formatDayTime } from "../../lib/leads/time";
import { prisma } from "../../lib/prisma";
import { chatState, type ChatState } from "../state";
import { safeDelete, show, NO_PREVIEW, type Ctx, type ShowMode } from "./context";
import { followUpPickerView, type View } from "./sales-views";
import { clip, crumbs, DIV, e } from "./ui";

export interface MailShared {
  resolveCtx(ctx: Context): Promise<Ctx | null>;
  showSettings(ctx: Context, c: Ctx, mode: ShowMode): Promise<void>;
}

// ---------------- экраны ----------------

export function gmailView(user: string | null): View {
  const kb = new InlineKeyboard();
  const lines = [crumbs("Настройки", "Gmail"), "📧 <b>GMAIL ДЛЯ ПИСЕМ КЛИЕНТАМ</b>", ""];
  if (user) {
    lines.push(
      `Подключён: <b>${e(user)}</b>`,
      "",
      "• В письме лиду есть кнопка «📤 Отправить через Gmail».",
      "• Ответы клиентов проверяю раз в 2 минуты и присылаю сюда с черновиком ответа от Claude — отправляешь ты.",
      "• Вся переписка видна и в самом Gmail."
    );
    kb.text("🔌 Отключить", "ml:gx");
  } else {
    lines.push(
      "Не подключён.",
      "",
      "Подключи отдельный Gmail под рассылку: письма будут уходить с него по кнопке, а ответы клиентов — приходить сюда.",
      "Понадобится пароль приложения Google — покажу, как его получить."
    );
    kb.text("✏️ Подключить Gmail", "ml:gc");
  }
  kb.row().text("‹ Настройки", "os:set");
  return { text: lines.join("\n"), kb };
}

function confirmView(o: NonNullable<Awaited<ReturnType<typeof getOutreach>>>, from: string): View {
  const text = [
    crumbs("Outreach", o.lead.name),
    "📤 <b>Отправить письмо через Gmail?</b>",
    `От: ${e(from)}`,
    `Кому: ${e(o.recipient ?? "—")}`,
    o.subject ? `Тема: <b>${e(o.subject)}</b>` : null,
    "",
    "<i>Письмо уйдёт сразу — отменить отправку нельзя. Ответ клиента придёт сюда.</i>",
  ]
    .filter((l) => l !== null)
    .join("\n");
  return { text, kb: new InlineKeyboard().text("✅ Отправить", `ml:sy:${o.id}`).text("‹ Назад", `os:o:${o.id}`) };
}

const INTENT_NOTE: Partial<Record<string, string>> = {
  refusal: "🙅 Клиент отказался или просит не писать — отвечать не нужно. Отметь отказ.",
  auto: "🤖 Похоже на автоответ — отвечать не нужно.",
};

/** Карточка ответа клиента: его письмо, черновик Claude и кнопки. */
async function replyCard(outreachId: string, extra: { draftId?: string | null; intent?: string | null; handoff?: string | null; draftError?: boolean } = {}): Promise<View | null> {
  const o = await prisma.outreach.findUnique({ where: { id: outreachId }, include: { lead: { select: { id: true, name: true } } } });
  if (!o) return null;
  const lastIn = await prisma.outreachMessage.findFirst({ where: { outreachId, direction: "IN" }, orderBy: { createdAt: "desc" } });
  const draft = extra.draftId
    ? await prisma.outreachMessage.findUnique({ where: { id: extra.draftId } })
    : await prisma.outreachMessage.findFirst({ where: { outreachId, direction: "OUT", sentAt: null }, orderBy: { createdAt: "desc" } });
  const lines = [`📩 <b>ОТВЕТ КЛИЕНТА</b> · <b>${e(o.lead.name)}</b>`];
  if (lastIn) {
    lines.push(`от ${e(lastIn.fromAddr ?? o.recipient ?? "—")} · ${formatDayTime(lastIn.sentAt ?? lastIn.createdAt)}`, `<blockquote expandable>${e(clip(lastIn.body, 1500))}</blockquote>`);
  }
  lines.push(DIV);
  const kb = new InlineKeyboard();
  if (draft && !draft.sentAt) {
    lines.push("✍️ <b>Черновик ответа</b> · Claude", `<blockquote expandable>${e(clip(draft.body, 2000))}</blockquote>`);
    if (extra.handoff) lines.push(`⚠️ <i>Лучше ответить самому: ${e(extra.handoff)}</i>`);
    lines.push("<i>Проверь: ответ уйдёт в ту же переписку с твоего Gmail.</i>");
    kb.text("📤 Отправить ответ", `ml:ra:${draft.id}`).text("✏️ Изменить", `ml:re:${draft.id}`).row();
    kb.text("🔄 Другой вариант", `ml:rg:${o.id}`).text("🙋 Отвечу сам", `ml:rs:${draft.id}`).row();
  } else {
    const note = (extra.intent && INTENT_NOTE[extra.intent]) ?? (extra.draftError ? "⚠️ Claude сейчас не ответил — нажми «🔄 Написать ответ» чуть позже или ответь в Gmail сам." : null);
    if (note) lines.push(note);
    else if (getOutreachGenerator().generator.id !== "claude") lines.push("<i>Claude не подключён — ответь клиенту в Gmail сам.</i>");
    if (getOutreachGenerator().generator.id === "claude" && extra.intent !== "auto") kb.text("🔄 Написать ответ", `ml:rg:${o.id}`).row();
  }
  kb.text("👀 Лид", `ld:ol:a:${o.lead.id}`).text("❌ Отказ", `os:oo:${o.id}:x`).text("🤝 Клиент", `os:oo:${o.id}:k`);
  return { text: lines.join("\n"), kb };
}

async function eventView(ev: IncomingEvent): Promise<{ view: View; silent: boolean } | null> {
  if (ev.kind === "bounce") {
    const text = [
      `⚠️ <b>Письмо не доставлено</b> · <b>${e(ev.lead.name)}</b>`,
      `Адрес <code>${e(ev.address)}</code> не принимает почту — отметил его 🔴, больше на него не пишем.`,
      "Посмотри другие контакты в карточке лида.",
    ].join("\n");
    return { view: { text, kb: new InlineKeyboard().text("👀 Лид", `ld:ol:a:${ev.lead.id}`) }, silent: false };
  }
  if (ev.kind === "auto") {
    const text = `🤖 <b>Автоответ</b> · ${e(ev.lead.name)}\n<blockquote expandable>${e(clip(ev.message.body, 400))}</blockquote>\n<i>Это не ответ человека — статус не менял.</i>`;
    return { view: { text, kb: new InlineKeyboard().text("👀 Лид", `ld:ol:a:${ev.lead.id}`) }, silent: true };
  }
  const view = await replyCard(ev.outreach.id, { draftId: ev.draft?.id, intent: ev.intent, handoff: ev.handoff, draftError: ev.draftError });
  return view ? { view, silent: false } : null;
}

// ---------------- регистрация ----------------

export function registerMail(bot: Bot, shared: MailShared) {
  const { resolveCtx } = shared;

  /** Уведомление о письме — всем участникам пространства. */
  async function notify(ev: IncomingEvent) {
    const v = await eventView(ev);
    if (!v) return;
    const members = await prisma.workspaceMember.findMany({ where: { workspaceId: ev.workspaceId }, include: { user: { select: { telegramId: true } } } });
    for (const m of members) {
      await bot.api
        .sendMessage(Number(m.user.telegramId), v.view.text, { parse_mode: "HTML", reply_markup: v.view.kb, link_preview_options: NO_PREVIEW, disable_notification: v.silent })
        .catch((err) => console.error("Mail notify failed:", redactError(err)));
    }
  }

  function startPolling() {
    const every = Number(process.env.LEADS_MAIL_POLL_MS ?? 120_000);
    if (!every) return;
    const tick = () => void pollInboxes(notify).catch((err) => console.error("Mail poll failed:", redactError(err)));
    setTimeout(tick, 15_000);
    setInterval(tick, every);
  }

  async function sendFirst(ctx: Context, c: Ctx, outreachId: string): Promise<string> {
    const r = await sendOutreachEmail(outreachId, c.workspace.id, c.user.id);
    if (!r.ok) {
      await show(ctx, { text: `⚠️ ${e(r.error)}`, kb: new InlineKeyboard().text("‹ К письму", `os:o:${outreachId}`) }, "edit");
      return "Не отправлено";
    }
    const o = await getOutreach(outreachId, c.workspace.id);
    const account = await getMailAccount(c.workspace.id);
    if (o) {
      const open = await openFollowUp(o.leadId);
      const t = { scope: "o" as const, id: o.id, leadId: o.leadId, leadName: o.lead.name, current: open?.task.deadlineAt ?? null };
      const notice = `✅ <b>Письмо отправлено</b> с ${e(account?.user ?? "Gmail")}. Лид → ${statusText("CONTACTED")}\nОтвет клиента придёт сюда — с черновиком от Claude.`;
      await show(ctx, followUpPickerView(t, { notice, skip: true }), "edit");
    }
    return "📤 Отправлено";
  }

  async function regenerate(ctx: Context, c: Ctx, outreachId: string): Promise<string | undefined> {
    const o = await getOutreach(outreachId, c.workspace.id);
    if (!o) return "Обращение не найдено";
    await show(ctx, { text: `✍️ Пишу ответ для «${e(o.lead.name)}»…\n<i>Claude читает переписку, это до минуты.</i>`, kb: new InlineKeyboard() }, "edit");
    void prepareReplyDraft(o.id)
      .then(async (r) => {
        const view = await replyCard(o.id, { draftId: r.draft?.id, intent: r.intent, handoff: r.handoff, draftError: r.error });
        if (view) await show(ctx, view, "edit");
      })
      .catch((err) => console.error("Reply regenerate failed:", redactError(err)));
    return "✍️ Пишу…";
  }

  async function route(ctx: Context, c: Ctx, parts: string[]): Promise<string | undefined> {
    const [, action, a1 = ""] = parts;
    switch (action) {
      case "gm": {
        const account = await getMailAccount(c.workspace.id);
        await show(ctx, gmailView(account?.user ?? null), "edit");
        return;
      }
      case "gc": {
        const prompt = await ctx.reply("📧 Пришли адрес Gmail, с которого будут уходить письма, например studio.mail@gmail.com.", {
          reply_markup: new InlineKeyboard().text("✖️ Отмена", "os:cx"),
        });
        chatState.set(c.chatId, { kind: "gmail_user", promptMessageId: prompt.message_id });
        return "Жду адрес";
      }
      case "gx":
        await disconnectMailAccount(c.workspace.id);
        await show(ctx, gmailView(null), "edit");
        return "Gmail отключён";
      case "pr": {
        const s = await getLeadSettings(c.workspace.id);
        const prompt = await ctx.reply(
          [
            "💰 Какие цены и сроки Claude может называть клиентам в ответах?",
            "Например: «Лендинг — от 30 000 ₽, 7–10 дней; сайт-визитка — от 50 000 ₽, 2–3 недели».",
            "Точную цену Claude не называет — предложит созвон и позовёт тебя.",
            s.priceInfo ? `\nСейчас: ${s.priceInfo}` : "",
            "\nЧтобы очистить, отправь «-».",
          ].join("\n"),
          { reply_markup: new InlineKeyboard().text("✖️ Отмена", "os:cx") }
        );
        chatState.set(c.chatId, { kind: "price_info", promptMessageId: prompt.message_id });
        return "Жду цены";
      }
      case "sq": {
        const o = await getOutreach(a1, c.workspace.id);
        if (!o) return "Обращение не найдено";
        const account = await getMailAccount(c.workspace.id);
        if (!account) return "Gmail не подключён";
        await show(ctx, confirmView(o, account.user), "edit");
        return;
      }
      case "sy":
        return sendFirst(ctx, c, a1);
      case "ra": {
        const draft = await getReplyDraft(a1, c.workspace.id);
        if (!draft) return "Ответ уже отправлен или удалён";
        const r = await sendReplyDraft(a1, c.workspace.id, c.user.id);
        if (!r.ok) return clip(r.error, 190);
        const kb = new InlineKeyboard()
          .text("👀 Лид", `ld:ol:a:${draft.outreach.lead.id}`)
          .text("⏰ Follow-up", `os:fp:o:${draft.outreachId}`)
          .row()
          .text("🏠 Меню", "os:home");
        await show(ctx, { text: `✅ <b>Ответ отправлен</b> · ${e(draft.outreach.lead.name)}\n<blockquote expandable>${e(clip(draft.body, 1500))}</blockquote>\nСледующий ответ клиента тоже придёт сюда.`, kb }, "edit");
        return "📤 Ответ отправлен";
      }
      case "re": {
        const draft = await getReplyDraft(a1, c.workspace.id);
        if (!draft) return "Ответ уже отправлен или удалён";
        const prompt = await ctx.reply("✏️ Пришли новый текст ответа одним сообщением — подпись допиши сам, если нужна.", {
          reply_markup: new InlineKeyboard().text("✖️ Отмена", "os:cx"),
        });
        chatState.set(c.chatId, { kind: "reply_edit", draftId: draft.id, cardMessageId: ctx.callbackQuery?.message?.message_id, promptMessageId: prompt.message_id });
        return "Жду текст";
      }
      case "rs": {
        const draft = await dropReplyDraft(a1, c.workspace.id);
        if (!draft) return "Ответ уже отправлен или удалён";
        const view = await replyCard(draft.outreachId);
        if (view) await show(ctx, { text: `${view.text}\n\n🙋 <i>Черновик убран — ответь клиенту в Gmail сам.</i>`, kb: new InlineKeyboard().text("👀 Лид", `ld:ol:a:${draft.outreach.lead.id}`) }, "edit");
        return "Ок, отвечаешь сам";
      }
      case "rg":
        return regenerate(ctx, c, a1);
      default:
        return;
    }
  }

  bot.callbackQuery(/^ml:/, async (ctx) => {
    let toast: string | undefined;
    try {
      const c = await resolveCtx(ctx);
      if (c) toast = await route(ctx, c, ctx.callbackQuery.data.split(":"));
    } catch (err) {
      console.error("Mail callback failed:", redactError(err));
      toast = "Что-то пошло не так, попробуй ещё раз";
    }
    await ctx.answerCallbackQuery(toast ? { text: toast } : undefined).catch(() => void 0);
  });

  /** Ввод адреса, пароля приложения, цен и своего текста ответа. true — сообщение обработано. */
  async function handleText(ctx: Context, c: Ctx, st: ChatState, text: string): Promise<boolean> {
    if (st.kind === "gmail_user") {
      const user = normalizeGmail(text);
      if (!user) {
        await ctx.reply("Нужен адрес Gmail вида name@gmail.com — или нажми «✖️ Отмена».");
        return true;
      }
      await safeDelete(ctx, c.chatId, st.promptMessageId);
      const prompt = await ctx.reply(
        [
          `🔑 Теперь <b>пароль приложения</b> для ${e(user)} — это не пароль от почты:`,
          "1. Включи двухэтапную проверку: myaccount.google.com/signinoptions/twosv",
          "2. Открой myaccount.google.com/apppasswords, введи название «Tandem» и нажми «Создать».",
          "3. Пришли сюда 16 букв, которые покажет Google.",
          "",
          "<i>Сообщение с паролем сразу удалю из чата, в базе он хранится зашифрованным.</i>",
        ].join("\n"),
        { parse_mode: "HTML", link_preview_options: NO_PREVIEW, reply_markup: new InlineKeyboard().text("✖️ Отмена", "os:cx") }
      );
      chatState.set(c.chatId, { kind: "gmail_pass", user, promptMessageId: prompt.message_id });
      return true;
    }
    if (st.kind === "gmail_pass") {
      await safeDelete(ctx, c.chatId, ctx.message?.message_id); // пароль не оставляем в истории чата
      const pass = normalizeAppPassword(text);
      if (!pass) {
        await ctx.reply("Это не похоже на пароль приложения: нужно 16 латинских букв (пробелы можно). Пришли ещё раз или нажми «✖️ Отмена».");
        return true;
      }
      chatState.clear(c.chatId);
      await safeDelete(ctx, c.chatId, st.promptMessageId);
      const wait = await ctx.reply("⏳ Проверяю вход в Gmail…");
      try {
        const lastUid = await verifyAccount({ user: st.user, pass });
        await saveMailAccount(c.workspace.id, st.user, pass, lastUid);
        await safeDelete(ctx, c.chatId, wait.message_id);
        await show(ctx, gmailView(st.user), "send");
      } catch (err) {
        const x = err as { code?: string; authenticationFailed?: boolean; responseCode?: number };
        const why =
          x.code === "EAUTH" || x.authenticationFailed || x.responseCode === 535
            ? "Google не принял пароль. Проверь, что это пароль приложения (16 букв), а не пароль от почты, и что адрес верный."
            : "Не достучался до Gmail — проверь интернет или VPN и попробуй ещё раз.";
        console.error("Gmail connect failed:", redactError(err));
        await safeDelete(ctx, c.chatId, wait.message_id);
        await ctx.reply(`⚠️ ${why}`, { reply_markup: new InlineKeyboard().text("✏️ Ещё раз", "ml:gc").text("‹ Настройки", "os:set") });
      }
      return true;
    }
    if (st.kind === "price_info") {
      chatState.clear(c.chatId);
      const value = text === "-" ? null : text.slice(0, 600);
      await prisma.leadSettings.upsert({ where: { workspaceId: c.workspace.id }, update: { priceInfo: value }, create: { workspaceId: c.workspace.id, priceInfo: value } });
      await safeDelete(ctx, c.chatId, st.promptMessageId);
      await ctx.reply(value ? "✅ Сохранил. Claude будет называть только эти цены и сроки." : "✅ Очистил. О цене Claude будет предлагать созвон.");
      await shared.showSettings(ctx, c, "send");
      return true;
    }
    if (st.kind === "reply_edit") {
      if (text.length < 5) {
        await ctx.reply("Слишком коротко — пришли текст целиком или нажми «✖️ Отмена».");
        return true;
      }
      chatState.clear(c.chatId);
      const draft = await updateReplyDraft(st.draftId, c.workspace.id, text);
      await safeDelete(ctx, c.chatId, st.promptMessageId);
      if (!draft) {
        await ctx.reply("Этот ответ уже отправлен или удалён.");
        return true;
      }
      await safeDelete(ctx, c.chatId, ctx.message?.message_id);
      await safeDelete(ctx, c.chatId, st.cardMessageId);
      const view = await replyCard(draft.outreachId, { draftId: draft.id });
      if (view) await show(ctx, { ...view, text: `${view.text}\n✏️ <i>Текст обновлён — проверь и отправь.</i>` }, "send");
      return true;
    }
    return false;
  }

  return { handleText, startPolling, notify };
}
