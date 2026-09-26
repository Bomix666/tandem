// Standalone Telegram bot process — deploy separately from the Next.js app
// (a small always-on worker: Railway/Fly/Render "background worker", or a
// serverless webhook target). Run with: `npm run bot`
//
// Responsibilities: /start, /app, /task, /tasks, /done, and Telegram deep
// links for the invite flow. Notification delivery itself lives in
// lib/notifications.ts + the /api/notifications/cron route, not here.
// Main menu keyboard (bot/menu.ts) and the client-search module (bot/leads)
// are registered below; the commands above work exactly as before.

import { Bot, InlineKeyboard, type Context } from "grammy";
import { prisma } from "../lib/prisma";
import { getUserWorkspace } from "../lib/telegram-auth";
import { parseQuickAdd } from "../lib/quick-add-parser";
import { MENU, mainMenuKeyboard } from "./menu";
import { chatState } from "./state";
import { registerLeadsModule } from "./leads";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
const appUrl = process.env.TELEGRAM_WEBAPP_URL;
if (!appUrl) throw new Error("TELEGRAM_WEBAPP_URL is not configured");

// TELEGRAM_API_ROOT — необязательный адрес Bot API (свой Bot API сервер или
// тестовый стенд, см. scripts/leads-e2e.ts). По умолчанию — api.telegram.org.
const apiRoot = process.env.TELEGRAM_API_ROOT?.trim();
const bot = new Bot(token, apiRoot ? { client: { apiRoot } } : undefined);

// Любая команда прерывает начатый пошаговый ввод (мастер поиска и т. п.).
bot.on("message:text", async (ctx, next) => {
  if (ctx.message.text.startsWith("/")) chatState.clear(ctx.chat.id);
  await next();
});

async function resolveUser(telegramId: number, first: string, username?: string) {
  return prisma.user.upsert({
    where: { telegramId: BigInt(telegramId) },
    update: { username, firstName: first },
    create: { telegramId: BigInt(telegramId), firstName: first, username },
  });
}

function openAppKeyboard(startParam?: string) {
  const url = startParam ? `${appUrl}?startapp=${startParam}` : appUrl!;
  return new InlineKeyboard().webApp("Open Tandem", url);
}

bot.command("start", async (ctx) => {
  const payload = ctx.match?.toString().trim();
  const user = await resolveUser(ctx.from!.id, ctx.from!.first_name, ctx.from!.username);

  if (payload?.startsWith("invite_")) {
    const token = payload.replace("invite_", "");
    const existing = await getUserWorkspace(user.id);
    if (existing) {
      await ctx.reply("Вы уже состоите в рабочем пространстве — Tandem поддерживает только одно.", { reply_markup: openAppKeyboard() });
      return;
    }
    const workspace = await prisma.workspace.findUnique({ where: { inviteToken: token }, include: { members: true } });
    if (!workspace || workspace.members.length >= 2) {
      await ctx.reply("Эта ссылка-приглашение больше недействительна.");
      return;
    }
    await ctx.reply("Вас пригласили в приватное пространство для двоих. Откройте приложение, чтобы присоединиться.", {
      reply_markup: openAppKeyboard(payload),
    });
    return;
  }

  await ctx.reply(
    `Tandem — приватное рабочее пространство для двоих. Откройте приложение, чтобы начать, или используйте /task для быстрого добавления задачи.`,
    { reply_markup: openAppKeyboard() }
  );
  await sendMainMenu(ctx);
});

async function sendMainMenu(ctx: Context) {
  await ctx.reply("Меню — кнопками внизу 👇", { reply_markup: mainMenuKeyboard() });
}

bot.command("menu", sendMainMenu);

bot.command("app", async (ctx) => {
  await ctx.reply("Открываю Tandem.", { reply_markup: openAppKeyboard() });
});

bot.command("task", async (ctx) => {
  const text = ctx.match?.toString().trim();
  if (!text) {
    await ctx.reply("Использование: /task Закончить сайт завтра 18:00");
    return;
  }
  await createQuickTask(ctx, text);
});

bot.hears(MENU.newTask, async (ctx) => {
  chatState.set(ctx.chat.id, { kind: "new_task" });
  await ctx.reply("Напиши задачу одним сообщением, например: Закончить сайт завтра 18:00");
});

async function createQuickTask(ctx: Context, text: string) {
  const user = await resolveUser(ctx.from!.id, ctx.from!.first_name, ctx.from!.username);
  const workspace = await getUserWorkspace(user.id);
  if (!workspace) {
    await ctx.reply("Сначала откройте приложение, чтобы настроить рабочее пространство.", { reply_markup: openAppKeyboard() });
    return;
  }

  const parsed = parseQuickAdd(text);
  const task = await prisma.task.create({
    data: {
      workspaceId: workspace.id,
      creatorId: user.id,
      assigneeId: user.id,
      title: parsed.title,
      deadlineAt: parsed.deadline ?? new Date(Date.now() + 24 * 3600_000),
      priority: "MEDIUM",
    },
  });

  await ctx.reply(
    `Создана задача «${task.title}»${parsed.deadline ? ` — срок ${parsed.deadline.toLocaleString("ru-RU")}` : " — срок через 24ч (время не распознано)"}.`,
    { reply_markup: openAppKeyboard() }
  );
}

bot.command("tasks", replyActiveTasks);
bot.hears(MENU.tasks, async (ctx) => {
  chatState.clear(ctx.chat.id);
  await replyActiveTasks(ctx);
});

async function replyActiveTasks(ctx: Context) {
  const user = await resolveUser(ctx.from!.id, ctx.from!.first_name, ctx.from!.username);
  const workspace = await getUserWorkspace(user.id);
  if (!workspace) {
    await ctx.reply("Сначала откройте приложение, чтобы настроить рабочее пространство.", { reply_markup: openAppKeyboard() });
    return;
  }

  const tasks = await prisma.task.findMany({
    where: { workspaceId: workspace.id, status: { not: "DONE" } },
    orderBy: { deadlineAt: "asc" },
    take: 5,
  });

  if (tasks.length === 0) {
    await ctx.reply("Активных задач нет. Всё чисто.", { reply_markup: openAppKeyboard() });
    return;
  }

  const next = tasks[0]!;
  const lines = [
    `АКТИВНЫХ: ${tasks.length}`,
    "",
    `Ближайший дедлайн: ${next.title}`,
    formatCountdown(next.deadlineAt),
  ];
  await ctx.reply(lines.join("\n"), { reply_markup: openAppKeyboard() });
}

function formatCountdown(deadline: Date) {
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) return "Просрочено";
  const h = Math.floor(diff / 3600_000);
  const m = Math.floor((diff % 3600_000) / 60_000);
  return `Осталось ${h} ч ${m} мин`;
}

// Модуль «Поиск клиентов» (bot/leads, lib/leads): меню, мастер поиска, лиды.
registerLeadsModule(bot, { resolveUser, openAppKeyboard });

// «➕ Новая задача» из меню: следующее сообщение — текст задачи (как /task).
bot.on("message:text", async (ctx, next) => {
  if (chatState.get(ctx.chat.id)?.kind !== "new_task") return next();
  chatState.clear(ctx.chat.id);
  await createQuickTask(ctx, ctx.message.text.trim());
});

bot.catch((err) => console.error("Bot error:", err));

bot.start();
console.log("Tandem bot running (long polling).");
