// Общее для обработчиков модуля лидов и Sales OS: контекст пользователя и
// показ экрана — редактированием текущего сообщения (навигация кнопками) или
// новым сообщением (кнопки меню внизу, текстовый ввод).

import type { User } from "@prisma/client";
import type { Context, InlineKeyboard } from "grammy";
import type { getUserWorkspace } from "../../lib/telegram-auth";

export type Workspace = NonNullable<Awaited<ReturnType<typeof getUserWorkspace>>>;
export interface Ctx {
  user: User;
  workspace: Workspace;
  chatId: number;
}

export const NO_PREVIEW = { is_disabled: true } as const;

export const ignoreNotModified = (err: Error) => {
  if (!/message is not modified/i.test(err.message)) throw err;
};

export type ShowMode = "edit" | "send";

/**
 * Показать экран. «edit» — заменить сообщение с нажатой кнопкой; если его
 * нельзя отредактировать (старое, не текст) — отправить новым сообщением.
 */
export async function show(ctx: Context, view: { text: string; kb: InlineKeyboard }, mode: ShowMode): Promise<void> {
  const opts = { parse_mode: "HTML" as const, reply_markup: view.kb, link_preview_options: NO_PREVIEW };
  if (mode === "edit" && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(view.text, opts);
      return;
    } catch (err) {
      if (/message is not modified/i.test((err as Error).message)) return;
    }
  }
  await ctx.reply(view.text, opts);
}

/** Удалить сообщение, не падая, если его уже нет или прошло больше 48 часов. */
export async function safeDelete(ctx: Context, chatId: number, messageId: number | undefined) {
  if (messageId) await ctx.api.deleteMessage(chatId, messageId).catch(() => void 0);
}
