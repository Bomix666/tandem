// Сквозная проверка бота без настоящего Telegram и без внешних API.
//
// Поднимает локальный сервер, который изображает Telegram Bot API, Яндекс
// «API Поиска по организациям», OSM (Nominatim + Overpass) и сайты бизнесов,
// запускает НАСТОЯЩИЙ процесс бота (bot/index.ts) с TELEGRAM_API_ROOT на этот
// сервер и проходит сценарии кнопками, проверяя ответы бота и записи в БД.
//
// Нужна отдельная тестовая база (имя обязательно оканчивается на _e2e — она
// пересоздаётся при каждом запуске):
//   E2E_DATABASE_URL=postgresql://postgres:tandem@localhost:5432/tandem_e2e npx tsx scripts/leads-e2e.ts

import { execSync, spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { fakeSourcesEnv, handleFakeSource, seedLocalOsm, startAltSiteServer, type FakeSourcesState } from "./lib/fake-sources";

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:tandem@localhost:5432/tandem_e2e?schema=public";
const TOKEN = "123456:E2E-TEST-TOKEN";
const USER1 = 5550001;
const USER2 = 5550002;

// ---------------- поддельные источники (scripts/lib/fake-sources.ts) ----------------

let port = 0;
const state: FakeSourcesState = { yandexMode: "ok", osmMode: "ok" };

// ---------------- фейковый Telegram ----------------

interface StoredMessage {
  message_id: number;
  chat_id: number;
  text: string;
  reply_markup?: { inline_keyboard?: { text: string; callback_data?: string; url?: string }[][]; keyboard?: { text: string }[][] };
}
interface Call {
  method: string;
  body: Record<string, unknown>;
  messageId?: number; // для sendMessage — id созданного сообщения
}

const calls: Call[] = [];
const messages = new Map<number, StoredMessage>();
const updates: Record<string, unknown>[] = [];
let waiters: (() => void)[] = [];
let confirmedOffset = 0; // как в Telegram: подтверждённые апдейты не приходят повторно (важно при перезапуске бота)
let nextUpdateId = 1;
let nextMessageId = 1;
let nextUserMessageId = 100000;
let presses = 0;

function pushUpdate(u: Record<string, unknown>) {
  updates.push({ update_id: nextUpdateId++, ...u });
  const w = waiters;
  waiters = [];
  w.forEach((fn) => fn());
}

const chatOf = (id: number) => ({ id, type: "private", first_name: id === USER1 ? "Тест" : "Партнёр" });
const fromOf = (id: number) => ({ id, is_bot: false, first_name: id === USER1 ? "Тест" : "Партнёр", username: `user${id}` });
const asMessage = (m: StoredMessage) => ({ message_id: m.message_id, date: Math.floor(Date.now() / 1000), chat: chatOf(m.chat_id), text: m.text, reply_markup: m.reply_markup });

async function telegram(method: string, body: Record<string, unknown>): Promise<unknown> {
  const call: Call = { method, body };
  if (method !== "getUpdates") calls.push(call);
  switch (method) {
    case "getMe":
      return { id: 999, is_bot: true, first_name: "E2E", username: "e2e_bot", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false };
    case "getUpdates": {
      confirmedOffset = Math.max(confirmedOffset, Number(body.offset ?? 0));
      const offset = confirmedOffset;
      const pending = () => updates.filter((u) => Number(u.update_id) >= offset);
      if (!pending().length) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 2000);
          waiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
      }
      return pending();
    }
    case "sendMessage": {
      const m: StoredMessage = { message_id: nextMessageId++, chat_id: Number(body.chat_id), text: String(body.text), reply_markup: body.reply_markup as StoredMessage["reply_markup"] };
      messages.set(m.message_id, m);
      call.messageId = m.message_id;
      return asMessage(m);
    }
    case "editMessageText":
    case "editMessageReplyMarkup": {
      const m = messages.get(Number(body.message_id));
      if (!m) throw new Error("message not found");
      if (method === "editMessageText") m.text = String(body.text);
      m.reply_markup = body.reply_markup as StoredMessage["reply_markup"];
      return asMessage(m);
    }
    default:
      return true;
  }
}

// ---------------- HTTP-сервер: Telegram, Яндекс, OSM, сайты ----------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  const tg = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
  if (tg) {
    try {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      json(200, { ok: true, result: await telegram(tg[2]!, body) });
    } catch (err) {
      json(400, { ok: false, error_code: 400, description: `Bad Request: ${(err as Error).message}` });
    }
    return;
  }
  if (handleFakeSource(url, res, port, state)) return;
  res.writeHead(404).end();
});

// ---------------- управление ботом ----------------

let bot: ChildProcess | null = null;
let botLog = "";

function startBot(withYandex: boolean) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: E2E_DB,
    TELEGRAM_BOT_TOKEN: TOKEN,
    TELEGRAM_WEBAPP_URL: "https://example.test",
    APP_URL: "https://example.test", // не из .env: Prisma подмешивает его в окружение
    LEADS_PROPOSAL_ENGINE: "template", // тексты в проверках — шаблоном, без настоящего Claude
    LEADS_MAIL_POLL_MS: "0",
    GMAIL_SMTP_HOST: "127.0.0.1", // в настоящий Gmail тест не ходит: соединение отклоняется
    GMAIL_IMAP_HOST: "127.0.0.1",
    TELEGRAM_API_ROOT: `http://127.0.0.1:${port}`,
    ...fakeSourcesEnv(port, withYandex),
  };
  const cli = path.join("node_modules", "tsx", "dist", "cli.mjs");
  bot = spawn(process.execPath, [cli, "bot/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  bot.stdout!.on("data", (d) => (botLog += d.toString()));
  bot.stderr!.on("data", (d) => (botLog += d.toString()));
}

async function stopBot() {
  if (!bot) return;
  const b = bot;
  bot = null;
  await new Promise<void>((resolve) => {
    b.once("exit", () => resolve());
    b.kill();
  });
}

// ---------------- действия пользователя и ожидание ----------------

function sendText(text: string, userId = USER1) {
  const cmd = text.startsWith("/") ? text.split(" ")[0]! : null;
  pushUpdate({
    message: {
      message_id: nextUserMessageId++,
      date: Math.floor(Date.now() / 1000),
      chat: chatOf(userId),
      from: fromOf(userId),
      text,
      ...(cmd ? { entities: [{ type: "bot_command", offset: 0, length: cmd.length }] } : {}),
    },
  });
}

function buttons(messageId: number) {
  return messages.get(messageId)?.reply_markup?.inline_keyboard?.flat() ?? [];
}

function press(messageId: number, label: string | RegExp, userId = USER1) {
  const m = messages.get(messageId);
  const b = buttons(messageId).find((x) => (typeof label === "string" ? x.text === label : label.test(x.text)) && x.callback_data);
  if (!m || !b) throw new Error(`Кнопка «${label}» не найдена в сообщении ${messageId}: ${buttons(messageId).map((x) => x.text).join(" | ")}`);
  presses++;
  pushUpdate({
    callback_query: { id: `cb${presses}`, from: fromOf(userId), chat_instance: "e2e", data: b.callback_data, message: asMessage(m) },
  });
}

async function waitFor<T>(label: string, fn: () => T | undefined | null | false, timeoutMs = 20000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error(`Не дождался: ${label}\n--- последние вызовы ---\n${calls.slice(-6).map((c) => `${c.method}: ${String(c.body.text ?? "").slice(0, 160)}`).join("\n")}\n--- лог бота ---\n${botLog.slice(-1500)}`);
}

/** Ждёт сообщение бота (новое или отредактированное) после отметки `since`. */
function waitMessage(since: number, pred: (m: StoredMessage, c: Call) => boolean, label: string, timeoutMs?: number) {
  return waitFor(
    label,
    () => {
      for (const c of calls.slice(since)) {
        if (c.method !== "sendMessage" && c.method !== "editMessageText" && c.method !== "editMessageReplyMarkup") continue;
        const id = c.method === "sendMessage" ? c.messageId : Number(c.body.message_id);
        const m = id ? messages.get(id) : undefined;
        if (m && pred(m, c)) return m;
      }
      return undefined;
    },
    timeoutMs
  );
}
const toastsSince = (since: number) => calls.slice(since).filter((c) => c.method === "answerCallbackQuery").map((c) => String(c.body.text ?? ""));

// ---------------- проверки ----------------

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${!ok && detail ? `\n     ${detail}` : ""}`);
}

async function runWizard(opts: { nicheButton: string; city: string; count: string; extra?: string; start: string }) {
  let mark = calls.length;
  sendText("🔎 Найти клиентов");
  const wiz = await waitMessage(mark, (m) => m.text.includes("Шаг 1/4"), "шаг 1");
  mark = calls.length;
  press(wiz.message_id, opts.nicheButton);
  await waitMessage(mark, (m) => m.text.includes("Шаг 2/4"), "шаг 2");
  mark = calls.length;
  sendText(opts.city);
  const step3 = await waitMessage(mark, (m) => m.text.includes("Шаг 3/4"), "шаг 3");
  mark = calls.length;
  press(step3.message_id, opts.count);
  const step4 = await waitMessage(mark, (m) => m.text.includes("Шаг 4/4"), "шаг 4");
  mark = calls.length;
  if (opts.extra) sendText(opts.extra);
  else press(step4.message_id, "Пропустить");
  const confirm = await waitMessage(mark, (m) => m.text.includes("Количество:") && !m.text.includes("Шаг"), "подтверждение");
  const confirmText = confirm.text; // бот потом отредактирует это сообщение в «Запустил поиск»
  mark = calls.length;
  press(confirm.message_id, opts.start);
  const summary = await waitMessage(mark, (m) => /Поиск завершён|Поиск не выполнен/.test(m.text), "итог поиска", 30000);
  return { confirmText, summary, mark };
}

async function main() {
  const dbName = new URL(E2E_DB).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_e2e")) throw new Error(`Тестовая БД должна оканчиваться на _e2e (сейчас «${dbName}») — она пересоздаётся`);
  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", { env: { ...process.env, DATABASE_URL: E2E_DB }, stdio: "ignore" });
  process.env.DATABASE_URL = E2E_DB;
  const { prisma } = await import("../lib/prisma");

  const u1 = await prisma.user.create({ data: { telegramId: BigInt(USER1), firstName: "Тест", username: `user${USER1}` } });
  const u2 = await prisma.user.create({ data: { telegramId: BigInt(USER2), firstName: "Партнёр", username: `user${USER2}` } });
  const ws = await prisma.workspace.create({ data: { members: { create: [{ userId: u1.id }, { userId: u2.id }] } } });

  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  const altSites = await startAltSiteServer(state);
  startBot(true);
  await waitFor("бот запустился", () => calls.some((c) => c.method === "getMe"));

  try {
    // ===== существующий функционал =====
    let mark = calls.length;
    sendText("/start");
    const menu = await waitMessage(mark, (m) => !!m.reply_markup?.keyboard, "главное меню");
    const home0 = await waitMessage(mark, (m) => m.text.includes("SALES OS"), "дашборд Sales OS");
    const menuButtons = menu.reply_markup!.keyboard!.flat().map((b) => b.text);
    check(
      "/start: меню Sales OS",
      ["🚀 Sales OS", "🔎 Найти клиентов", "👥 Мои лиды", "📨 Outreach", "⏰ Follow-up", "📊 Аналитика", "📋 Задачи", "➕ Задача", "⚙️ Настройки"].every((b) => menuButtons.includes(b)),
      menuButtons.join(", ")
    );
    check("/start: дашборд с реальными нулями, без выдуманной статистики", /Новых лидов\s+0/.test(home0.text) && home0.text.includes("БЛИЖАЙШЕЕ ДЕЙСТВИЕ"), home0.text);
    check("/start: кнопка «Open Tandem» осталась", calls.slice(mark).some((c) => JSON.stringify(c.body.reply_markup ?? "").includes("Open Tandem")));

    mark = calls.length;
    sendText("/task Проверить старый функционал");
    await waitMessage(mark, (m) => m.text.startsWith("Создана задача «Проверить старый функционал»"), "/task");
    check("/task создаёт задачу как раньше", (await prisma.task.count({ where: { workspaceId: ws.id } })) === 1);

    mark = calls.length;
    sendText("➕ Задача");
    await waitMessage(mark, (m) => m.text.includes("Напиши задачу"), "подсказка новой задачи");
    mark = calls.length;
    sendText("Задача из меню");
    await waitMessage(mark, (m) => m.text.startsWith("Создана задача «Задача из меню»"), "задача из меню");
    check("«➕ Задача» из меню создаёт задачу", (await prisma.task.count({ where: { workspaceId: ws.id } })) === 2);

    mark = calls.length;
    sendText("📋 Задачи");
    const tasksMsg = await waitMessage(mark, (m) => m.text.includes("📋 <b>ЗАДАЧИ</b>"), "список задач");
    check("«📋 Задачи» — экран задач Sales OS", tasksMsg.text.includes("активных 2") && tasksMsg.text.includes("Проверить старый функционал"), tasksMsg.text);

    // ===== поиск клиентов =====
    // Яндекс — тестовая интеграция (кнопка 🧪); локальной копии OSM пока нет — дополнение идёт через Overpass
    const s1 = await runWizard({ nicheButton: "Барбершопы", city: "Москва", count: "5", start: "🧪 Искать через Яндекс (тест)" });
    check("мастер: основной источник — OpenStreetMap, Яндекс — тест", s1.confirmText.includes("Источник: 🗺 OpenStreetMap"), s1.confirmText);
    check("поиск в фоне: было сообщение о прогрессе", calls.slice(s1.mark).some((c) => String(c.body.text ?? "").includes("Ищу подходящие бизнесы")));
    check("итог поиска: 5 подходят", s1.summary.text.includes("<b>5 подходят</b>"), s1.summary.text);
    check("итог: воронка «бизнесов · подходят · с email»", /\d+ бизнес\S* · <b>5 подходят<\/b> · \d+ с публичным email/.test(s1.summary.text), s1.summary.text);
    check("итог: разбивка по потенциалу", /🔥 Высокий потенциал: 2[\s\S]*🟡 Средний: 3/.test(s1.summary.text), s1.summary.text);
    // бизнес без контактов стоит в конце очереди — 5 лидов набираются раньше, лишних проверок нет
    check("итог: проверено 5, без лишних проверок", s1.summary.text.includes("Проверено: 5 · Отфильтровано: 0"), s1.summary.text);

    const leads1 = await prisma.lead.findMany({ where: { workspaceId: ws.id } });
    check("в БД 5 лидов", leads1.length === 5, String(leads1.length));
    check("новые лиды — статус «🔎 Найден»", leads1.every((l) => l.status === "FOUND"), leads1.map((l) => l.status).join());
    check("история: событие FOUND у каждого лида", (await prisma.leadEvent.count({ where: { workspaceId: ws.id, type: "FOUND" } })) === 5);
    const black = leads1.find((l) => l.name === "Black Barber");
    check("OSM дополнил лид: email и Instagram", !!black && black.emails.includes("hello@blackbarber.ru") && JSON.stringify(black.socials).includes("instagram.com/blackbarber"));
    const blackContact = black ? await prisma.leadContact.findFirst({ where: { leadId: black.id } }) : null;
    check(
      "email из OSM: источник и проверка 🟡 (домен не совпадает с сайтом)",
      blackContact?.sourceType === "OSM" && blackContact.verification === "UNVERIFIED" && blackContact.isPrimary,
      JSON.stringify(blackContact)
    );
    check("лид без контактов не сохранён", !leads1.some((l) => l.name === "Ghost Barber"));
    check("сеть помечена", leads1.filter((l) => l.name === "Barber Chain").every((l) => JSON.stringify(l.scoreReasons).includes("похоже на сеть")));

    const card1 = await waitMessage(s1.mark, (m) => m.text.includes("LEAD #1"), "первая карточка");
    check("карточка #1 — лучший лид (Black Barber, 95/100)", card1.text.includes("Black Barber") && card1.text.includes("95/100"), card1.text.slice(0, 200));
    check("карточка: email с отметкой проверки и источником", card1.text.includes("🟡 hello@blackbarber.ru — найден, не подтверждён · <a href="), card1.text);
    check(
      "карточка: кнопки из ТЗ",
      ["✨ Подготовить письмо", "💬 Сообщение", "➕ Создать задачу", "⏰ Follow-up", "❤️ Сохранить", "📌 Статус", "📍 Источник", "🏠 Меню", "Следующий ›"].every((t) =>
        buttons(card1.message_id).some((b) => b.text === t)
      ),
      buttons(card1.message_id).map((b) => b.text).join(" | ")
    );
    check("карточка: блоки ТЗ — Lead Score, возможность, статус", card1.text.includes("🎯 <b>Lead Score</b> 95/100") && card1.text.includes("💡 <b>Возможность</b>") && card1.text.includes("<b>СТАТУС</b>  🔎 Найден"), card1.text);

    mark = calls.length;
    press(card1.message_id, "Следующий ›");
    const card2 = await waitMessage(mark, (m) => m.message_id === card1.message_id && m.text.includes("LEAD #2"), "следующий лид");
    check("«Следующий» листает подборку в том же сообщении", !!card2);
    check("нет email — «Не найден», а не выдуманный", card2.text.includes("📧 <b>Email</b>\nНе найден"), card2.text);

    // сохранить
    mark = calls.length;
    press(card1.message_id, "❤️ Сохранить");
    await waitMessage(mark, (m) => m.message_id === card1.message_id && buttons(m.message_id).some((b) => b.text === "💔 Убрать"), "сохранение");
    const savedLead = await prisma.lead.findFirst({ where: { workspaceId: ws.id, saved: true } });
    check("❤️ Сохранить лид", !!savedLead);
    check("сохранение берёт лид в работу: 🔎 Найден → 🆕 Новый", savedLead?.status === "NEW", savedLead?.status);
    check("история: событие SAVED", (await prisma.leadEvent.count({ where: { leadId: savedLead?.id, type: "SAVED", fromStatus: "FOUND", toStatus: "NEW" } })) === 1);
    const card2Lead = savedLead!;

    // статус
    mark = calls.length;
    press(card1.message_id, /^📌 Статус/);
    await waitMessage(mark, (m) => m.message_id === card1.message_id && buttons(m.message_id).some((b) => b.text.includes("Переговоры")), "выбор статуса");
    mark = calls.length;
    press(card1.message_id, /Переговоры$/);
    const afterStatus = await waitMessage(mark, (m) => m.message_id === card1.message_id && m.text.includes("<b>СТАТУС</b>  💬 Переговоры"), "статус в карточке");
    check("статус меняется из Telegram", (await prisma.lead.findUnique({ where: { id: card2Lead.id } }))?.status === "NEGOTIATION");
    check("история: смена статуса записана", (await prisma.leadEvent.count({ where: { leadId: card2Lead.id, type: "STATUS_CHANGED", toStatus: "NEGOTIATION" } })) === 1);
    check("после смены статуса «Следующий» сохранился", buttons(afterStatus.message_id).some((b) => b.text === "Следующий ›"));

    // предложение
    mark = calls.length;
    press(card1.message_id, "✨ Подготовить письмо");
    const proposal = await waitMessage(mark, (m) => m.message_id === card1.message_id && m.text.includes("📧 <b>EMAIL</b>"), "редактор письма");
    check("✨ письмо по фактам лида — в той же карточке, без новых сообщений", proposal.text.includes("Обратил внимание на ваш барбершоп") && !calls.slice(mark).some((c) => c.method === "sendMessage"), proposal.text);
    check("редактор: черновик, «Кому», тема, кнопки ТЗ", proposal.text.includes("📝 Черновик") && proposal.text.includes("Кому: <i>email не найден</i>") && proposal.text.includes("Тема: <b>") && ["✏️ Редактировать", "📋 Копировать", "🔄 Другой вариант", "✅ Я отправил", "❌ Отмена", "‹ К лиду"].every((t) => buttons(card1.message_id).some((b) => b.text === t)), buttons(card1.message_id).map((b) => b.text).join(" | "));
    check("нет email — нет кнопки «Открыть почту»", !buttons(card1.message_id).some((b) => b.text.includes("Открыть почту")));
    check("предложение сохранено в лиде", !!(await prisma.lead.findUnique({ where: { id: card2Lead.id } }))?.proposal);
    check("пометка «Сделано: шаблон по фактам»", proposal.text.includes("Сделано: шаблон по фактам"));
    const draft1 = await prisma.outreach.findFirst({ where: { leadId: card2Lead.id } });
    check("предложение = черновик обращения (Outreach DRAFT), ничего не отправлено", draft1?.status === "DRAFT" && draft1.channel === "EMAIL" && !draft1.sentAt, JSON.stringify(draft1));
    check("история: OUTREACH_DRAFTED", (await prisma.leadEvent.count({ where: { leadId: card2Lead.id, type: "OUTREACH_DRAFTED" } })) === 1);

    // без дублей: «‹ К лиду» → «✉️ Открыть письмо» открывает тот же черновик; «🔄» — новая формулировка в той же записи
    mark = calls.length;
    press(card1.message_id, "‹ К лиду");
    await waitMessage(mark, (m) => m.message_id === card1.message_id && buttons(m.message_id).some((b) => b.text === "✉️ Открыть письмо"), "карточка с черновиком");
    mark = calls.length;
    press(card1.message_id, "✉️ Открыть письмо");
    const reopened = await waitMessage(mark, (m) => m.message_id === card1.message_id && m.text.includes("Открыт сохранённый черновик"), "тот же черновик");
    check("повторное «письмо» открывает тот же черновик", !!reopened && (await prisma.outreach.count({ where: { leadId: card2Lead.id } })) === 1);
    mark = calls.length;
    press(card1.message_id, "🔄 Другой вариант");
    await waitMessage(mark, (m) => m.message_id === card1.message_id && m.text.includes("Новый вариант текста"), "другой вариант");
    const variant = await prisma.outreach.findFirstOrThrow({ where: { leadId: card2Lead.id } });
    check("🔄 другой вариант — в той же записи", variant.variant === 1 && (await prisma.outreach.count({ where: { leadId: card2Lead.id } })) === 1 && variant.body !== draft1!.body);

    // ✏️ свой текст с темой
    mark = calls.length;
    press(card1.message_id, "✏️ Редактировать");
    await waitMessage(mark, (m) => m.text.includes("Пришли новый текст"), "запрос текста");
    mark = calls.length;
    sendText("Тема: Сайт для вашего барбершопа\n\nДобрый день! Это мой собственный текст письма для проверки.");
    const edited = await waitMessage(mark, (m) => m.text.includes("Текст обновлён"), "обновлённый редактор");
    const editedRow = await prisma.outreach.findFirstOrThrow({ where: { leadId: card2Lead.id } });
    check("✏️ свой текст и тема сохранены", editedRow.subject === "Сайт для вашего барбершопа" && editedRow.body.startsWith("Добрый день! Это мой") && editedRow.generator === "manual", JSON.stringify(editedRow));
    check("✏️ редактор показан заново с новым текстом", edited.text.includes("Тема: <b>Сайт для вашего барбершопа</b>") && edited.text.includes("Текст отредактирован вручную"), edited.text);
    mark = calls.length;
    press(edited.message_id, "📋 Копировать");
    const copy = await waitMessage(mark, (m) => m.text.includes("Текст для копирования"), "текст для копирования");
    check("📋 копирование — текст в блоке, тема кнопкой", copy.text.includes("<pre>Добрый день! Это мой") && JSON.stringify(copy.reply_markup).includes("copy_text"), copy.text);
    mark = calls.length;
    press(edited.message_id, "‹ К лиду");
    await waitMessage(mark, (m) => m.message_id === edited.message_id && m.text.includes("LEAD"), "карточка из редактора");
    const card1Id = card1.message_id;
    card1.message_id = edited.message_id; // дальше работаем с карточкой в новом сообщении

    // задача из лида
    mark = calls.length;
    press(card1.message_id, "➕ Создать задачу");
    await waitMessage(mark, (m) => m.text.includes("Задача создана"), "задача создана");
    const leadTasks = await prisma.leadTask.findMany({ where: { leadId: card2Lead.id }, include: { task: true } });
    check("➕ задача создана и связана с лидом", leadTasks.length === 1 && leadTasks[0]!.task.title === `Связаться с ${card2Lead.name} — предложить сайт`);
    check("в задаче все данные лида", !!leadTasks[0]?.task.description?.includes("Тип: Продажа сайта") && !!leadTasks[0]?.task.description?.includes("Статус лида: Переговоры"));
    check("задача видна в общем списке задач", (await prisma.task.count({ where: { workspaceId: ws.id } })) === 3);
    check("в ленте активности есть запись", (await prisma.taskActivity.count({ where: { workspaceId: ws.id, type: "task_created" } })) === 1);
    void card1Id;
    check("задача не откатывает лид назад по воронке (Переговоры остаются)", (await prisma.lead.findUnique({ where: { id: card2Lead.id } }))?.status === "NEGOTIATION");
    check("связь лид ↔ задача: тип CONTACT, событие TASK_CREATED", leadTasks[0]?.kind === "CONTACT" && (await prisma.leadEvent.count({ where: { leadId: card2Lead.id, type: "TASK_CREATED" } })) === 1);

    mark = calls.length;
    press(card1.message_id, "✅ Задача есть");
    const again = await waitMessage(mark, (m) => m.text.includes("уже есть задача"), "повторная задача");
    check("повторно задачу без подтверждения не создаёт", (await prisma.leadTask.count({ where: { leadId: card2Lead.id } })) === 1);
    mark = calls.length;
    press(again.message_id, "➕ Да, создать ещё одну");
    await waitMessage(mark, (m) => m.text.includes("Задача создана"), "вторая задача");
    check("по явному подтверждению — вторая задача", (await prisma.leadTask.count({ where: { leadId: card2Lead.id } })) === 2);


    // ===== дубли =====
    const s2 = await runWizard({ nicheButton: "Барбершопы", city: "Москва", count: "5", start: "🧪 Искать через Яндекс (тест)" });
    check("повторный поиск: дубли не создаются", (await prisma.lead.count({ where: { workspaceId: ws.id } })) === 5);
    check("повторный поиск: «Уже были в базе: 5»", s2.summary.text.includes("Уже были в базе: 5"), s2.summary.text);
    check("статус и «сохранён» у дубля не сброшены", (await prisma.lead.findUnique({ where: { id: card2Lead.id } }))?.status === "NEGOTIATION");
    check("повторный поиск: email-контакты не задвоились", (await prisma.leadContact.count({ where: { leadId: black!.id } })) === 1);

    // ===== найти ещё =====
    mark = calls.length;
    press(s2.summary.message_id, "🔄 Найти ещё 5");
    const s3 = await waitMessage(mark, (m) => m.text.includes("Поиск завершён"), "найти ещё", 30000);
    const search3 = await prisma.leadSearch.findFirst({ where: { workspaceId: ws.id, parentId: { not: null } }, include: { results: { include: { lead: true } } } });
    const s3names = search3?.results.map((r) => r.lead.name) ?? [];
    check("«Найти ещё» нашёл другие бизнесы", s3names.length === 4 && !s3names.some((n) => leads1.some((l) => l.name === n && n !== "Barber Chain")), s3names.join(", "));
    check("«Найти ещё»: уже найденные пропущены", s3.text.includes("Пропущено уже найденных раньше"), s3.text);
    const old = await prisma.lead.findFirst({ where: { workspaceId: ws.id, name: "Old School Barber" } });
    check("проверка сайта: старый сайт — конкретные причины", !!old && JSON.stringify(old.scoreReasons).includes("нет адаптации под телефон") && JSON.stringify(old.scoreReasons).includes("© 2014"));
    check("с сайта взят только email компании", !!old && old.emails.join() === "oldschoolbarber@gmail.com", old?.emails.join());
    const down = await prisma.lead.findFirst({ where: { workspaceId: ws.id, name: "Down Barber" } });
    check("недоступный сайт — «не открывается»", !!down && JSON.stringify(down.scoreReasons).includes("не открывается"));
    const yc = await prisma.lead.findFirst({ where: { workspaceId: ws.id, name: "Yclients Barber" } });
    check("YCLIENTS вместо сайта распознан", yc?.websiteKind === "booking");

    // ===== ошибки источников =====
    state.osmMode = "500";
    mark = calls.length;
    const s4 = await runWizard({ nicheButton: "Барбершопы", city: "Казань", count: "5", start: "🧪 Искать через Яндекс (тест)" });
    check("OSM недоступен: предупреждение и поиск продолжился", s4.summary.text.includes("Не удалось получить данные из OpenStreetMap") && s4.summary.text.includes("<b>2 подходят</b>"), s4.summary.text);
    check("во время поиска было предупреждение", calls.slice(mark).some((c) => String(c.body.text ?? "").includes("Продолжаю поиск")));
    state.osmMode = "ok";

    state.yandexMode = "403";
    const s5 = await runWizard({ nicheButton: "Барбершопы", city: "Москва", count: "5", start: "🧪 Искать через Яндекс (тест)" });
    check("Яндекс вернул ошибку: переход на OSM с предупреждением", s5.summary.text.includes("Не удалось получить данные из Яндекса") && s5.summary.text.includes("Источник: OpenStreetMap"), s5.summary.text);
    state.yandexMode = "ok";

    // ===== «Дополнительно» как фильтр =====
    const s6 = await runWizard({ nicheButton: "Барбершопы", city: "Москва", count: "5", extra: "только без сайта", start: "🧪 Искать через Яндекс (тест)" });
    check("«Дополнительно: без сайта» распознано", s6.confirmText.includes("Учту: только бизнесы без собственного сайта"), s6.confirmText);
    const s6search = await prisma.leadSearch.findFirst({ where: { workspaceId: ws.id, extra: "только без сайта" }, include: { results: { include: { lead: true } } } });
    check("фильтр «без сайта» соблюдён", !!s6search && s6search.results.every((r) => r.lead.websiteKind !== "own"));

    // ===== мои лиды / история / статистика / настройки =====
    mark = calls.length;
    sendText("👥 Мои лиды");
    const list = await waitMessage(mark, (m) => m.text.includes("👥 <b>ЛИДЫ</b>"), "мои лиды");
    const total = await prisma.lead.count({ where: { workspaceId: ws.id } });
    check("👥 Мои лиды: все лиды", list.text.includes(`Всего: <b>${total}</b>`), list.text.slice(0, 160));
    mark = calls.length;
    press(list.message_id, "💬");
    const neg = await waitMessage(mark, (m) => m.message_id === list.message_id && m.text.includes("Переговоры"), "фильтр переговоры");
    check("фильтр «Переговоры»", neg.text.includes("Всего: <b>1</b>") && neg.text.includes(card2Lead.name), neg.text);
    mark = calls.length;
    press(list.message_id, "🔍 Поиск");
    await waitMessage(mark, (m) => m.text.includes("часть названия"), "запрос поиска");
    mark = calls.length;
    sendText("insta");
    const found = await waitMessage(mark, (m) => m.text.includes("👥 <b>ЛИДЫ</b>") && m.text.includes("«insta»"), "поиск по названию");
    check("поиск по названию", found.text.includes("Insta Cuts") && found.text.includes("Всего: <b>1</b>"), found.text);
    mark = calls.length;
    press(found.message_id, /Insta Cuts/);
    const opened = await waitMessage(mark, (m) => m.text.includes("🏢 <b>Insta Cuts</b>"), "открыть лид из списка");
    check("открытие лида из списка — в том же сообщении", opened.message_id === found.message_id);

    mark = calls.length;
    sendText("🕘 История поиска");
    const hist = await waitMessage(mark, (m) => m.text.includes("ИСТОРИЯ ПОИСКА"), "история");
    check("🕘 История: записи поисков", hist.text.includes("Барбершопы — Москва — 5 лидов") && hist.text.includes("Барбершопы — Казань — 2 лида"), hist.text);
    mark = calls.length;
    press(hist.message_id, /Казань/);
    const histOpen = await waitMessage(mark, (m) => m.text.includes("Поиск от"), "открыть поиск из истории");
    check("открытие поиска из истории", buttons(histOpen.message_id).some((b) => b.text === "👀 Смотреть лиды"));

    mark = calls.length;
    sendText("📊 Статистика"); // старая кнопка меню ведёт в аналитику
    const stats = await waitMessage(mark, (m) => m.text.includes("📊 <b>АНАЛИТИКА</b>"), "аналитика");
    check(
      "📊 Аналитика: воронка и коэффициенты по реальным данным",
      new RegExp(`Всего лидов\\s+${total}\\b`).test(stats.text) && /Переговоры\s+1\b/.test(stats.text) && stats.text.includes("Contact rate") && stats.text.includes("не гарантированный доход"),
      stats.text
    );
    mark = calls.length;
    press(stats.message_id, "✏️ Средний чек");
    await waitMessage(mark, (m) => m.text.includes("средний чек"), "запрос среднего чека");
    mark = calls.length;
    sendText("75 000");
    await waitMessage(mark, (m) => m.text.includes("Средний чек:"), "средний чек сохранён");
    check("⚙️ средний чек сохраняется", (await prisma.leadSettings.findUnique({ where: { workspaceId: ws.id } }))?.avgCheck === 75000);

    mark = calls.length;
    sendText("⚙️ Настройки");
    const settings = await waitMessage(mark, (m) => m.text.includes("НАСТРОЙКИ ПОИСКА КЛИЕНТОВ"), "настройки");
    check("⚙️ Настройки: OpenStreetMap — основной источник, Яндекс — тест", settings.text.includes("OpenStreetMap (основной)") && settings.text.includes("Яндекс Карты (тест)"), settings.text);
    mark = calls.length;
    press(settings.message_id, "✏️ Имя");
    await waitMessage(mark, (m) => m.text.includes("Как тебя зовут"), "запрос имени");
    mark = calls.length;
    sendText("Никита");
    const named = await waitMessage(mark, (m) => m.text.includes("Имя: Никита"), "имя в настройках");
    check("⚙️ подпись: имя сохраняется", (await prisma.leadSettings.findUnique({ where: { workspaceId: ws.id } }))?.senderName === "Никита");

    // ===== Gmail: подключение (без настоящего Gmail — вход не удаётся) =====
    check("⚙️ в настройках — Gmail и цены для Claude", named.text.includes("Письма через Gmail") && buttons(named.message_id).some((b) => b.text === "📧 Gmail"), named.text);
    mark = calls.length;
    press(named.message_id, "📧 Gmail");
    const gm = await waitMessage(mark, (m) => m.message_id === named.message_id && m.text.includes("GMAIL ДЛЯ ПИСЕМ"), "экран Gmail");
    check("📧 Gmail: не подключён, есть кнопка «Подключить»", gm.text.includes("Не подключён") && buttons(gm.message_id).some((b) => b.text === "✏️ Подключить Gmail"));
    mark = calls.length;
    press(gm.message_id, "✏️ Подключить Gmail");
    await waitMessage(mark, (m) => m.text.includes("Пришли адрес Gmail"), "запрос адреса");
    mark = calls.length;
    sendText("info@yandex.ru");
    await waitMessage(mark, (m) => m.text.includes("Нужен адрес Gmail"), "не Gmail");
    mark = calls.length;
    sendText("studio.test@gmail.com");
    await waitMessage(mark, (m) => m.text.includes("пароль приложения"), "запрос пароля");
    mark = calls.length;
    const passwordMessageId = nextUserMessageId;
    sendText("abcd efgh ijkl mnop");
    await waitMessage(mark, (m) => m.text.includes("Не достучался до Gmail") || m.text.includes("Google не принял"), "проверка входа");
    check(
      "🔑 сообщение с паролем удалено из чата; без входа в Gmail ящик не сохраняется",
      calls.slice(mark).some((c) => c.method === "deleteMessage" && Number(c.body.message_id) === passwordMessageId) && !(await prisma.leadSettings.findUnique({ where: { workspaceId: ws.id } }))?.gmailUser
    );

    // ===== Яндекс не настроен =====
    await stopBot();
    startBot(false);
    await waitFor("бот перезапущен", () => calls.filter((c) => c.method === "getMe").length >= 2);
    mark = calls.length;
    sendText("🔎 Найти клиентов");
    const wiz = await waitMessage(mark, (m) => m.text.includes("Шаг 1/4"), "мастер без ключа");
    press(wiz.message_id, "Барбершопы");
    await waitMessage(mark, (m) => m.text.includes("Шаг 2/4"), "шаг 2");
    sendText("Москва");
    const st3 = await waitMessage(mark, (m) => m.text.includes("Шаг 3/4"), "шаг 3");
    press(st3.message_id, "5");
    const st4 = await waitMessage(mark, (m) => m.text.includes("Шаг 4/4"), "шаг 4");
    press(st4.message_id, "Пропустить");
    const nc = await waitMessage(mark, (m) => m.text.includes("Количество:") && !m.text.includes("Шаг"), "подтверждение без ключа");
    check("без ключа Яндекса — поиск по OSM доступен, кнопки 🧪 нет", buttons(nc.message_id).some((b) => b.text === "✅ Начать поиск") && !buttons(nc.message_id).some((b) => b.text.includes("Яндекс")));
    // локальной копии OSM нет, Overpass лежит → понятная ошибка и кнопка «Повторить»; OSM ожил → повтор проходит
    state.osmMode = "500";
    let m2 = calls.length;
    press(nc.message_id, "✅ Начать поиск");
    const failed = await waitMessage(m2, (m) => m.text.includes("Поиск не выполнен"), "OSM недоступен", 30000);
    check("OSM недоступен — понятная ошибка без технического мусора", failed.text.includes("Не удалось выполнить поиск по OpenStreetMap") && !failed.text.includes("&lt;?xml"), failed.text);
    check("у неудачного поиска кнопка «🔁 Повторить поиск»", buttons(failed.message_id).some((b) => b.text === "🔁 Повторить поиск"));
    state.osmMode = "ok";
    m2 = calls.length;
    press(failed.message_id, "🔁 Повторить поиск");
    const osmOnly = await waitMessage(m2, (m) => m.text.includes("Поиск завершён"), "повтор поиска только по OSM", 30000);
    check("поиск только по OSM работает без ключа (после повтора)", osmOnly.text.includes("Источник: OpenStreetMap"), osmOnly.text);
    check("пока локальной копии нет — пометка «через публичные серверы»", osmOnly.text.includes("Локальная копия OpenStreetMap ещё загружается"), osmOnly.text);

    // ===== локальная копия OSM: граница города, email со страницы «Контакты» =====
    await seedLocalOsm(prisma);
    state.osmMode = "500"; // публичный Overpass «лежит» — поиск не должен в него ходить
    const s7 = await runWizard({ nicheButton: "Барбершопы", city: "Москва", count: "5", start: "✅ Начать поиск" });
    check("локальный OSM: поиск без Overpass", s7.summary.text.includes("Поиск завершён") && !s7.summary.text.includes("ещё загружается"), s7.summary.text);
    check(
      "итог: 2 бизнеса в границах города · 1 подходит · 1 с email · 1 требует проверки",
      s7.summary.text.includes("2 бизнеса · <b>1 подходит</b> · 1 с публичным email · 1 требует проверки"),
      s7.summary.text
    );
    check("прогресс: «Найдено бизнесов / Подходят / 📧 Email найден»", calls.slice(s7.mark).some((c) => /Найдено бизнесов: \d+[\s\S]*Подходят: \d+\/5[\s\S]*📧 Email найден: \d+/.test(String(c.body.text ?? ""))));
    state.osmMode = "ok";
    const lavka = await prisma.lead.findFirst({ where: { workspaceId: ws.id, osmId: "node/101" }, include: { contacts: true } });
    check("за границей города и не из ниши — не найдены", !(await prisma.lead.count({ where: { osmId: { in: ["node/102", "node/103"] } } })));
    check(
      "email найден на странице «Контакты»: info@ 🟡, мёртвый домен 🔴, личный — не сохранён",
      !!lavka &&
        lavka.contacts.length === 2 &&
        lavka.contacts.some((c) => c.value === "info@lavka-barber.ru" && c.verification === "UNVERIFIED" && c.sourceType === "SITE" && !!c.sourceUrl?.endsWith("/site/lavka/kontakty")) &&
        lavka.contacts.some((c) => c.value === "zakaz@lavkabarber.com" && c.verification === "INVALID") &&
        !lavka.contacts.some((c) => c.value.includes("ivan")),
      JSON.stringify(lavka?.contacts.map((c) => [c.value, c.verification, c.sourceType]))
    );
    check("Lead.emails — только пригодные адреса", lavka?.emails.join() === "info@lavka-barber.ru", lavka?.emails.join());
    const lavkaCard = await waitMessage(s7.mark, (m) => m.text.includes("Lavka Barber") && m.text.includes("LEAD #1"), "карточка Lavka");
    check(
      "карточка: 🟡 и 🔴 email с источником «сайт компании»",
      lavkaCard.text.includes("🟡 info@lavka-barber.ru — найден, не подтверждён · <a href=") && lavkaCard.text.includes("🔴 zakaz@lavkabarber.com — некорректный"),
      lavkaCard.text
    );
    check("карточка: статус «🔎 Найден»", lavkaCard.text.includes("<b>СТАТУС</b>  🔎 Найден"), lavkaCard.text);

    mark = calls.length;
    press(lavkaCard.message_id, "✨ Подготовить письмо");
    const lavkaHead = await waitMessage(mark, (m) => m.message_id === lavkaCard.message_id && m.text.includes("📧 <b>EMAIL</b>"), "письмо Lavka");
    check("письмо: адресат — лучший проверенный email, тема письма", lavkaHead.text.includes("Кому: 🟡 info@lavka-barber.ru") && lavkaHead.text.includes("Тема:"), lavkaHead.text);
    check("письмо: подпись из настроек", lavkaHead.text.includes("—\nНикита</blockquote>"), lavkaHead.text);
    const mailBtn = buttons(lavkaCard.message_id).find((b) => b.text === "📨 Открыть почту");
    check("📨 «Открыть почту» — подписанная ссылка приложения (Telegram не открывает mailto:)", !!mailBtn?.url && /^https:\/\/example\.test\/go\/mail\/\w+\?t=[0-9a-f]{24}$/.test(mailBtn.url), mailBtn?.url);
    const lavkaDraft = await prisma.outreach.findFirst({ where: { leadId: lavka!.id }, include: { contact: true } });
    check("Outreach связан с email-контактом", lavkaDraft?.recipient === "info@lavka-barber.ru" && lavkaDraft.contact?.value === "info@lavka-barber.ru" && lavkaDraft.status === "DRAFT");

    mark = calls.length;
    press(lavkaCard.message_id, "‹ К лиду");
    await waitMessage(mark, (m) => m.message_id === lavkaCard.message_id && m.text.includes("LEAD"), "карточка Lavka снова");
    mark = calls.length;
    press(lavkaCard.message_id, "➕ Создать задачу");
    await waitMessage(mark, (m) => m.text.includes("Задача создана"), "задача Lavka");
    const lavkaAfter = await prisma.lead.findUniqueOrThrow({ where: { id: lavka!.id } });
    check("задача → лид автоматически «📩 Связаться», без отправки", lavkaAfter.status === "TO_CONTACT" && !(await prisma.outreach.count({ where: { leadId: lavka!.id, status: { not: "DRAFT" } } })));
    check(
      "история: TASK_CREATED и STATUS_CHANGED FOUND → TO_CONTACT",
      (await prisma.leadEvent.count({ where: { leadId: lavka!.id, type: "TASK_CREATED" } })) === 1 &&
        (await prisma.leadEvent.count({ where: { leadId: lavka!.id, type: "STATUS_CHANGED", fromStatus: "FOUND", toStatus: "TO_CONTACT" } })) === 1
    );
    const lavkaTask = await prisma.leadTask.findFirst({ where: { leadId: lavka!.id }, include: { task: true } });
    check("в описании задачи email с отметкой проверки", !!lavkaTask?.task.description?.includes("info@lavka-barber.ru 🟡"), lavkaTask?.task.description ?? "");
    const reCard = await waitMessage(mark, (m) => m.message_id === lavkaCard.message_id && m.text.includes("<b>СТАТУС</b>  📩 Связаться"), "карточка обновилась");
    check("карточка обновилась: «📩 Связаться» · задача · письмо-черновик", reCard.text.includes("📋 задача") && reCard.text.includes("📧 Email: 📝 Черновик"), reCard.text);

    // ===== Sales OS: отправка руками → follow-up → напоминание → ответ → клиент =====
    const { daysFromNow } = await import("../lib/leads/time");
    mark = calls.length;
    press(lavkaCard.message_id, "✉️ Открыть письмо");
    await waitMessage(mark, (m) => m.message_id === lavkaCard.message_id && m.text.includes("📧 <b>EMAIL</b>"), "письмо Lavka снова");
    mark = calls.length;
    press(lavkaCard.message_id, "✅ Я отправил");
    const picker = await waitMessage(mark, (m) => m.message_id === lavkaCard.message_id && m.text.includes("Отмечено как отправленное"), "выбор follow-up");
    const sentRow = await prisma.outreach.findFirstOrThrow({ where: { leadId: lavka!.id } });
    const lavkaSent = await prisma.lead.findUniqueOrThrow({ where: { id: lavka!.id } });
    check("✅ отправил: обращение «📨 Отправлено», лид «📨 Связались»", sentRow.status === "SENT" && !!sentRow.sentAt && lavkaSent.status === "CONTACTED", `${sentRow.status} ${lavkaSent.status}`);
    check("✅ отправил: задача «Связаться» выполнена", (await prisma.task.findUniqueOrThrow({ where: { id: lavkaTask!.taskId } })).status === "DONE");
    check("выбор follow-up: 2/5/7 дней, своя дата, без напоминания", ["Через 2 дня", "Через 5 дней", "Через 7 дней", "📅 Своя дата", "Без напоминания"].every((t) => buttons(picker.message_id).some((b) => b.text === t)));
    mark = calls.length;
    press(picker.message_id, "Через 2 дня");
    await waitMessage(mark, (m) => m.message_id === picker.message_id && m.text.includes("Follow-up поставлен"), "follow-up поставлен");
    const fu1 = await prisma.leadTask.findFirstOrThrow({ where: { leadId: lavka!.id, kind: "FOLLOW_UP" }, include: { task: true } });
    check("follow-up = задача в таск-менеджере со сроком через 2 дня в 10:00", fu1.task.title === "Follow-up: Lavka Barber" && fu1.task.deadlineAt.getTime() === daysFromNow(2).getTime() && fu1.outreachId === sentRow.id, fu1.task.deadlineAt.toISOString());
    const waiting = await prisma.outreach.findUniqueOrThrow({ where: { id: sentRow.id } });
    check("обращение и лид — «⏳ Ждём ответа»", waiting.status === "WAITING" && waiting.followUpAt?.getTime() === fu1.task.deadlineAt.getTime() && (await prisma.lead.findUniqueOrThrow({ where: { id: lavka!.id } })).status === "WAITING");
    check("напоминание запланировано (одно, без лишних «за 24 часа»)", (await prisma.notification.count({ where: { taskId: fu1.taskId } })) === 1 && (await prisma.notification.count({ where: { taskId: fu1.taskId, type: "lead_followup" } })) === 1);

    // follow-up из карточки: та же задача переносится, дубля нет
    mark = calls.length;
    press(picker.message_id, "👀 Открыть лид");
    const lavkaCard2 = await waitMessage(mark, (m) => m.message_id === picker.message_id && m.text.includes("⏰ follow-up"), "карточка с follow-up");
    mark = calls.length;
    press(lavkaCard2.message_id, "⏰ Follow-up ✓");
    await waitMessage(mark, (m) => m.message_id === lavkaCard2.message_id && m.text.includes("Сейчас стоит"), "текущая дата follow-up");
    mark = calls.length;
    press(lavkaCard2.message_id, "Через 5 дней");
    await waitMessage(mark, (m) => m.message_id === lavkaCard2.message_id && m.text.includes("Follow-up перенесён"), "follow-up перенесён");
    check("повторный follow-up переносит задачу, а не создаёт дубль", (await prisma.leadTask.count({ where: { leadId: lavka!.id, kind: "FOLLOW_UP" } })) === 1 && (await prisma.task.findUniqueOrThrow({ where: { id: fu1.taskId } })).deadlineAt.getTime() === daysFromNow(5).getTime());

    // своя дата: непонятная → подсказка, понятная → перенос
    mark = calls.length;
    press(lavkaCard2.message_id, "⏰ Follow-up");
    await waitMessage(mark, (m) => m.message_id === lavkaCard2.message_id && m.text.includes("FOLLOW-UP"), "карточка follow-up");
    mark = calls.length;
    press(lavkaCard2.message_id, "⏰ Отложить");
    await waitMessage(mark, (m) => m.message_id === lavkaCard2.message_id && m.text.includes("Отложить follow-up"), "отложить");
    mark = calls.length;
    press(lavkaCard2.message_id, "📅 Своя дата");
    await waitMessage(mark, (m) => m.text.includes("Когда напомнить про «Lavka Barber»"), "запрос даты");
    mark = calls.length;
    sendText("вчера");
    await waitMessage(mark, (m) => m.text.includes("Не понял дату"), "непонятная дата");
    mark = calls.length;
    sendText("через 3 дня");
    await waitMessage(mark, (m) => m.text.includes("Follow-up перенесён"), "своя дата");
    check("📅 своя дата «через 3 дня»", (await prisma.task.findUniqueOrThrow({ where: { id: fu1.taskId } })).deadlineAt.getTime() === daysFromNow(3).getTime());

    // напоминание в срок: cron приложения присылает ⏰ FOLLOW-UP с кнопками
    await prisma.notification.updateMany({ where: { taskId: fu1.taskId, type: "lead_followup" }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    Object.assign(process.env, { TELEGRAM_API_ROOT: `http://127.0.0.1:${port}`, TELEGRAM_BOT_TOKEN: TOKEN });
    const { deliverDueNotifications, scheduleOverdueNotifications } = await import("../lib/notifications");
    mark = calls.length;
    await deliverDueNotifications();
    const notice = await waitMessage(mark, (m) => m.text.includes("⏰ <b>FOLLOW-UP</b>"), "напоминание follow-up");
    check(
      "напоминание: лид, когда написали, следующее действие, кнопки",
      notice.text.includes("Lavka Barber") && notice.text.includes("Написали: <b>") && notice.text.includes("Следующее действие") && ["👀 Открыть лид", "⏰ Отложить", "✅ Закрыть"].every((t) => buttons(notice.message_id).some((b) => b.text === t)),
      notice.text
    );
    check("напоминание отмечено доставленным", !!(await prisma.notification.findFirst({ where: { taskId: fu1.taskId, type: "lead_followup" } }))?.sentAt);
    await prisma.task.update({ where: { id: fu1.taskId }, data: { deadlineAt: new Date(Date.now() - 3600_000) } });
    await scheduleOverdueNotifications();
    check("просроченный follow-up не дублируется общим «задача просрочена»", (await prisma.notification.count({ where: { taskId: fu1.taskId, type: "task_overdue" } })) === 0);

    mark = calls.length;
    press(notice.message_id, "⏰ Отложить");
    await waitMessage(mark, (m) => m.message_id === notice.message_id && m.text.includes("Отложить follow-up"), "отложить из напоминания");
    mark = calls.length;
    press(notice.message_id, "+1 день");
    await waitMessage(mark, (m) => m.message_id === notice.message_id && m.text.includes("Follow-up перенесён"), "отложено");
    const snoozed = await prisma.notification.findFirstOrThrow({ where: { taskId: fu1.taskId, type: "lead_followup" } });
    check("⏰ отложить: новый срок и новое напоминание", snoozed.sentAt === null && snoozed.scheduledFor.getTime() === daysFromNow(1).getTime());

    mark = calls.length;
    press(notice.message_id, "⏰ Follow-up");
    await waitMessage(mark, (m) => m.message_id === notice.message_id && m.text.includes("FOLLOW-UP"), "карточка follow-up");
    mark = calls.length;
    press(notice.message_id, "✅ Закрыть");
    await waitMessage(mark, (m) => m.message_id === notice.message_id && m.text.includes("Чем закончилось"), "итог follow-up");
    mark = calls.length;
    press(notice.message_id, "👀 Ответили");
    await waitMessage(mark, (m) => m.message_id === notice.message_id && m.text.includes("Follow-up закрыт"), "follow-up закрыт");
    const replied = await prisma.outreach.findUniqueOrThrow({ where: { id: sentRow.id } });
    check("👀 ответили: обращение «Ответ получен», лид «💬 Переговоры», задача закрыта", replied.status === "REPLIED" && !!replied.repliedAt && (await prisma.lead.findUniqueOrThrow({ where: { id: lavka!.id } })).status === "NEGOTIATION" && (await prisma.task.findUniqueOrThrow({ where: { id: fu1.taskId } })).status === "DONE");
    check("история: отправлено, follow-up, ответ", (await prisma.leadEvent.count({ where: { leadId: lavka!.id, type: { in: ["OUTREACH_SENT", "FOLLOWUP_SET", "FOLLOWUP_DONE", "REPLY_RECEIVED"] } } })) >= 4);

    // раздел Outreach: статусы, список, итог «клиент»
    mark = calls.length;
    sendText("📨 Outreach");
    const out = await waitMessage(mark, (m) => m.text.includes("📨 <b>OUTREACH</b>"), "раздел Outreach");
    check("📨 Outreach: счётчики по статусам", /Ответ получен\s+1\b/.test(out.text) && /Черновик\s+1\b/.test(out.text), out.text);
    mark = calls.length;
    press(out.message_id, "👀 Ответы · 1");
    const outList = await waitMessage(mark, (m) => m.message_id === out.message_id && m.text.includes("Lavka Barber"), "список ответов");
    mark = calls.length;
    press(outList.message_id, /Lavka Barber/);
    await waitMessage(mark, (m) => m.message_id === out.message_id && m.text.includes("👀 Ответ получен"), "обращение с ответом");
    mark = calls.length;
    press(out.message_id, "🤝 Клиент");
    await waitMessage(mark, (m) => m.message_id === out.message_id && m.text.includes("🤝 Клиент"), "клиент");
    check("🤝 клиент: обращение и лид", (await prisma.outreach.findUniqueOrThrow({ where: { id: sentRow.id } })).status === "CLIENT" && (await prisma.lead.findUniqueOrThrow({ where: { id: lavka!.id } })).status === "CLIENT");

    // 💬 сообщение в другой канал: WhatsApp — короткий текст и ссылка wa.me; «❌ Отмена» удаляет черновик
    mark = calls.length;
    press(out.message_id, "‹ К лиду");
    await waitMessage(mark, (m) => m.message_id === out.message_id && m.text.includes("🏢 <b>Lavka Barber</b>"), "карточка из Outreach");
    mark = calls.length;
    press(out.message_id, "💬 Сообщение");
    await waitMessage(mark, (m) => m.message_id === out.message_id && m.text.includes("Выбери канал"), "выбор канала");
    mark = calls.length;
    press(out.message_id, "📱 WhatsApp");
    const wa = await waitMessage(mark, (m) => m.message_id === out.message_id && m.text.includes("<b>WHATSAPP</b>"), "сообщение WhatsApp");
    const waBtn = buttons(out.message_id).find((b) => b.text === "📱 Открыть WhatsApp");
    const waRow = await prisma.outreach.findFirstOrThrow({ where: { leadId: lavka!.id, channel: "WHATSAPP" } });
    check("📱 WhatsApp: короче письма, ссылка wa.me с текстом", waRow.body.length < sentRow.body.length && !!waBtn?.url?.startsWith("https://wa.me/74953330101?text="), `${waRow.body.length} vs ${sentRow.body.length} · ${waBtn?.url}`);
    check("📱 WhatsApp: куда — номер телефона", wa.text.includes("Куда: +7"), wa.text);
    mark = calls.length;
    press(out.message_id, "❌ Отмена");
    await waitMessage(mark, (m) => m.message_id === out.message_id && m.text.includes("🏢 <b>Lavka Barber</b>"), "отмена черновика");
    check("❌ отмена удаляет только черновик", !(await prisma.outreach.count({ where: { leadId: lavka!.id, channel: "WHATSAPP" } })) && (await prisma.outreach.count({ where: { leadId: lavka!.id } })) === 1);

    // дашборд: реальные цифры и ⚡ ближайшее действие (черновик письма card2Lead — отправить)
    mark = calls.length;
    sendText("🚀 Sales OS");
    const dash = await waitMessage(mark, (m) => m.text.includes("🚀 <b>SALES OS</b>"), "дашборд");
    check("дашборд: клиенты и outreach за сегодня из БД", /Клиенты\s+1\b/.test(dash.text) && dash.text.includes("отправлено") && /\b1 отправлено/.test(dash.text), dash.text);
    check("⚡ ближайшее действие — отправить готовый черновик", dash.text.includes(`<b>${card2Lead.name}</b>\n→ отправить предложение`), dash.text);
    mark = calls.length;
    press(dash.message_id, "⚡ Открыть");
    const jumped = await waitMessage(mark, (m) => m.message_id === dash.message_id && m.text.includes("📧 <b>EMAIL</b>"), "переход к черновику");
    check("⚡ открывает нужный черновик", jumped.text.includes("Сайт для вашего барбершопа"), jumped.text);

    mark = calls.length;
    sendText("⏰ Follow-up");
    const fuList = await waitMessage(mark, (m) => m.text.includes("⏰ <b>FOLLOW-UP</b>"), "список follow-up");
    check("⏰ Follow-up: закрытые не показываются", fuList.text.includes("открытых 0"), fuList.text);
    mark = calls.length;
    sendText("📊 Аналитика");
    const an = await waitMessage(mark, (m) => m.text.includes("📊 <b>АНАЛИТИКА</b>"), "аналитика");
    check("📊 Аналитика: связались, ответили, клиенты, коэффициенты", /Связались\s+[1-9]/.test(an.text) && /Клиенты\s+1\b/.test(an.text) && /Reply rate\s+\d+%/.test(an.text), an.text);
    mark = calls.length;
    press(an.message_id, "7 дней");
    const an7 = await waitMessage(mark, (m) => m.message_id === an.message_id && m.text.includes("АНАЛИТИКА"), "аналитика за 7 дней");
    check("📊 период «7 дней»", an7.text.includes("за 7 дней"), an7.text);

    // ===== старые команды после всего =====
    mark = calls.length;
    sendText("/tasks");
    await waitMessage(mark, (m) => m.text.startsWith("АКТИВНЫХ"), "/tasks в конце");
    check("/tasks работает после всех сценариев", true);

    // ===== служебные проверки =====
    check("на каждое нажатие кнопки бот ответил (без «часиков»)", calls.filter((c) => c.method === "answerCallbackQuery").length >= presses, `${calls.filter((c) => c.method === "answerCallbackQuery").length}/${presses}`);
    check("в логе бота нет ошибок", !/Bot error|callback failed|crashed|Unhandled/i.test(botLog), botLog.slice(-800));
    check("лимит callback_data (64 байта) не превышен", calls.every((c) => !JSON.stringify(c.body.reply_markup ?? {}).match(/"callback_data":"([^"]{65,})"/)));
    const toasts = toastsSince(0).filter(Boolean);
    check("всплывающие подсказки на кнопках", toasts.some((t) => t.startsWith("❤️ Лид сохранён")) && toasts.some((t) => t.startsWith("Статус:")), toasts.join(" | "));
  } catch (err) {
    check("сценарий выполнен без исключений", false, (err as Error).message);
  } finally {
    await stopBot();
    server.close();
    await altSites.close();
    await prisma.$disconnect();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nИтого: ${results.length - failed.length}/${results.length} проверок пройдено`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
