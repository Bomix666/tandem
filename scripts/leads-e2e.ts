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

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:tandem@localhost:5432/tandem_e2e?schema=public";
const TOKEN = "123456:E2E-TEST-TOKEN";
const USER1 = 5550001;
const USER2 = 5550002;
const YANDEX_KEY = "e2e-yandex-key";

// ---------------- фейковые данные ----------------

interface FakeOrg {
  id: string;
  name: string;
  addr: string;
  ll: [number, number];
  phones: string[];
  url?: string;
  hours?: string;
}

let port = 0;
// разные хосты — как у настоящих разных бизнесов (иначе защита от дублей справедливо склеит их по домену)
const site = (p: string, host = "127.0.0.1") => `http://${host}:${port}/site/${p}`;

const moscow = (): FakeOrg[] => [
  { id: "m1", name: "Black Barber", addr: "Россия, Москва, Тверская улица, 7", ll: [37.61, 55.76], phones: ["+7 (495) 111-11-01"], hours: "ежедневно, 10:00–22:00" },
  { id: "m2", name: "Barber Chain", addr: "Россия, Москва, улица Арбат, 1", ll: [37.59, 55.75], phones: ["+7 (495) 111-11-02"] },
  { id: "m3", name: "Barber Chain", addr: "Россия, Москва, улица Покровка, 2", ll: [37.64, 55.758], phones: ["+7 (495) 111-11-03"] },
  { id: "m4", name: "Barber Chain", addr: "Россия, Москва, Мясницкая улица, 3", ll: [37.635, 55.765], phones: ["+7 (495) 111-11-04"] },
  { id: "m5", name: "Ghost Barber", addr: "Россия, Москва, улица Сретенка, 5", ll: [37.63, 55.77], phones: [] },
  { id: "m6", name: "Insta Cuts", addr: "Россия, Москва, Пятницкая улица, 6", ll: [37.628, 55.74], phones: ["+7 (495) 111-11-06"], url: "https://instagram.com/instacuts" },
  { id: "m7", name: "Yclients Barber", addr: "Россия, Москва, Никольская улица, 7", ll: [37.622, 55.757], phones: ["+7 (495) 111-11-07"], url: "https://n1.yclients.com/company/7" },
  { id: "m8", name: "Old School Barber", addr: "Россия, Москва, Малая Бронная улица, 8", ll: [37.6, 55.762], phones: ["+7 (495) 111-11-08"], url: site("old") },
  { id: "m9", name: "Modern Barber", addr: "Россия, Москва, Садовая улица, 9", ll: [37.62, 55.77], phones: ["+7 (495) 111-11-09"], url: site("modern", "localhost") },
  { id: "m10", name: "Down Barber", addr: "Россия, Москва, Лесная улица, 10", ll: [37.59, 55.78], phones: ["+7 (495) 111-11-10"], url: "http://127.0.0.2:1/" },
];
const kazan = (): FakeOrg[] => [
  { id: "k1", name: "Казань Барбер", addr: "Россия, Казань, улица Баумана, 1", ll: [49.12, 55.79], phones: ["+7 (843) 222-22-01"] },
  { id: "k2", name: "Kazan Cuts", addr: "Россия, Казань, Кремлёвская улица, 2", ll: [49.11, 55.8], phones: ["+7 (843) 222-22-02"], url: "vk.com/kazancuts" },
];

const OVERPASS = {
  elements: [
    { type: "node", id: 1, lat: 55.7601, lon: 37.6101, tags: { name: "Black Barber", shop: "hairdresser", "contact:instagram": "blackbarber", "contact:email": "hello@blackbarber.ru" } },
    { type: "node", id: 2, lat: 55.7621, lon: 37.6001, tags: { name: "Old School Barber", shop: "hairdresser", "contact:vk": "oldschool", phone: "+7 495 111-11-08" } },
  ],
};

const OLD_SITE = `<html><head><script src="//s1.ucoz.net/x.js"></script></head><body><font>Барбершоп</font><font>Услуги</font><font>Цены</font>
<a href="mailto:oldschoolbarber@gmail.com">Почта</a><a href="tel:+74951111108">Звоните</a><p>© 2014 Old School</p></body></html>`;
const MODERN_SITE = `<html><head><meta name="viewport" content="width=device-width"></head><body><form><input type="tel" name="phone"><button>Записаться</button></form>
<a href="https://t.me/modernbarber">Telegram</a><footer>© 2020–2026</footer></body></html>`;

const state = { yandexMode: "ok" as "ok" | "403", osmMode: "ok" as "ok" | "500" };

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

function yandexResponse(text: string, skip: number) {
  const orgs = text.includes("Казань") ? kazan() : text.includes("Москва") ? moscow() : [];
  return {
    type: "FeatureCollection",
    properties: { ResponseMetaData: { SearchResponse: { found: orgs.length } } },
    features: orgs.slice(skip, skip + 50).map((o) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: o.ll },
      properties: {
        name: o.name,
        CompanyMetaData: {
          id: o.id,
          name: o.name,
          address: o.addr,
          url: o.url,
          Phones: o.phones.map((p) => ({ type: "phone", formatted: p })),
          Categories: [{ class: "beauty", name: "Барбершоп" }],
          Hours: o.hours ? { text: o.hours } : undefined,
        },
      },
    })),
  };
}

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
  if (url.pathname.startsWith("/yandex/")) {
    if (state.yandexMode === "403" || url.searchParams.get("apikey") !== YANDEX_KEY) return json(403, { message: "Invalid key" });
    return json(200, yandexResponse(url.searchParams.get("text") ?? "", Number(url.searchParams.get("skip") ?? 0)));
  }
  if (url.pathname === "/nominatim/search") return json(200, [{ boundingbox: ["55.1", "56.1", "36.8", "38.0"] }]);
  if (url.pathname === "/overpass") return state.osmMode === "500" ? json(500, { error: "overloaded" }) : json(200, OVERPASS);
  if (url.pathname === "/site/old" || url.pathname === "/site/modern") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(url.pathname === "/site/old" ? OLD_SITE : MODERN_SITE);
    return;
  }
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
    TELEGRAM_API_ROOT: `http://127.0.0.1:${port}`,
    YANDEX_PLACES_API_KEY: withYandex ? YANDEX_KEY : "",
    YANDEX_PLACES_API_URL: `http://127.0.0.1:${port}/yandex/v1/`,
    OVERPASS_API_URL: `http://127.0.0.1:${port}/overpass`,
    NOMINATIM_URL: `http://127.0.0.1:${port}/nominatim`,
    LEADS_ALLOW_PRIVATE_URLS: "true",
    LEADS_OSM_ENABLED: "true",
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
  startBot(true);
  await waitFor("бот запустился", () => calls.some((c) => c.method === "getMe"));

  try {
    // ===== существующий функционал =====
    let mark = calls.length;
    sendText("/start");
    const menu = await waitMessage(mark, (m) => !!m.reply_markup?.keyboard, "главное меню");
    const menuButtons = menu.reply_markup!.keyboard!.flat().map((b) => b.text);
    check("/start: главное меню с новыми кнопками", ["📋 Задачи", "➕ Новая задача", "🔎 Найти клиентов", "❤️ Мои лиды", "🕘 История поиска", "📊 Статистика", "⚙️ Настройки"].every((b) => menuButtons.includes(b)), menuButtons.join(", "));
    check("/start: кнопка «Open Tandem» осталась", calls.slice(mark).some((c) => JSON.stringify(c.body.reply_markup ?? "").includes("Open Tandem")));

    mark = calls.length;
    sendText("/task Проверить старый функционал");
    await waitMessage(mark, (m) => m.text.startsWith("Создана задача «Проверить старый функционал»"), "/task");
    check("/task создаёт задачу как раньше", (await prisma.task.count({ where: { workspaceId: ws.id } })) === 1);

    mark = calls.length;
    sendText("➕ Новая задача");
    await waitMessage(mark, (m) => m.text.includes("Напиши задачу"), "подсказка новой задачи");
    mark = calls.length;
    sendText("Задача из меню");
    await waitMessage(mark, (m) => m.text.startsWith("Создана задача «Задача из меню»"), "задача из меню");
    check("«➕ Новая задача» из меню создаёт задачу", (await prisma.task.count({ where: { workspaceId: ws.id } })) === 2);

    mark = calls.length;
    sendText("📋 Задачи");
    const tasksMsg = await waitMessage(mark, (m) => m.text.startsWith("АКТИВНЫХ"), "список задач");
    check("«📋 Задачи» = /tasks", tasksMsg.text.includes("АКТИВНЫХ: 2"), tasksMsg.text);

    // ===== поиск клиентов =====
    const s1 = await runWizard({ nicheButton: "Барбершопы", city: "Москва", count: "5", start: "✅ Начать поиск" });
    check("мастер: подтверждение с источниками", s1.confirmText.includes("Источник: Яндекс Карты + проверка по OpenStreetMap"), s1.confirmText);
    check("поиск в фоне: было сообщение о прогрессе", calls.slice(s1.mark).some((c) => String(c.body.text ?? "").includes("Ищу подходящие бизнесы")));
    check("итог поиска: 5 лидов", s1.summary.text.includes("<b>5 лидов</b>"), s1.summary.text);
    check("итог: разбивка по потенциалу", /🔥 Высокий потенциал: 2[\s\S]*🟡 Средний: 3/.test(s1.summary.text), s1.summary.text);
    // бизнес без контактов стоит в конце очереди — 5 лидов набираются раньше, лишних проверок нет
    check("итог: проверено 5, без лишних проверок", s1.summary.text.includes("Проверено: 5 · Отфильтровано: 0"), s1.summary.text);

    const leads1 = await prisma.lead.findMany({ where: { workspaceId: ws.id } });
    check("в БД 5 лидов", leads1.length === 5, String(leads1.length));
    const black = leads1.find((l) => l.name === "Black Barber");
    check("OSM дополнил лид: email и Instagram", !!black && black.emails.includes("hello@blackbarber.ru") && JSON.stringify(black.socials).includes("instagram.com/blackbarber"));
    check("лид без контактов не сохранён", !leads1.some((l) => l.name === "Ghost Barber"));
    check("сеть помечена", leads1.filter((l) => l.name === "Barber Chain").every((l) => JSON.stringify(l.scoreReasons).includes("похоже на сеть")));

    const card1 = await waitMessage(s1.mark, (m) => m.text.includes("ЛИД #1"), "первая карточка");
    check("карточка #1 — лучший лид (Black Barber, 95/100)", card1.text.includes("Black Barber") && card1.text.includes("95/100"), card1.text.slice(0, 200));
    check("карточка: кнопки из ТЗ", ["🌐 Сайт", "📱 Соцсети", "📞 Контакты", "✨ Создать предложение", "➕ Создать задачу", "❤️ Сохранить лид", "➡️ Следующий"].every((t) => buttons(card1.message_id).some((b) => b.text === t)));

    mark = calls.length;
    press(card1.message_id, "➡️ Следующий");
    const card2 = await waitMessage(mark, (m) => m.message_id === card1.message_id && m.text.includes("ЛИД #2"), "следующий лид");
    check("«Следующий» листает подборку в том же сообщении", !!card2);
    check("нет email — «Не найден», а не выдуманный", card2.text.includes("📧 <b>Email:</b>\nНе найден"), card2.text);

    // сохранить
    mark = calls.length;
    press(card1.message_id, "❤️ Сохранить лид");
    await waitMessage(mark, (m) => m.message_id === card1.message_id && buttons(m.message_id).some((b) => b.text === "💔 Убрать из сохранённых"), "сохранение");
    const savedLead = await prisma.lead.findFirst({ where: { workspaceId: ws.id, saved: true } });
    check("❤️ Сохранить лид", !!savedLead);
    const card2Lead = savedLead!;

    // статус
    mark = calls.length;
    press(card1.message_id, /^📌 Статус/);
    await waitMessage(mark, (m) => m.message_id === card1.message_id && buttons(m.message_id).some((b) => b.text.includes("Переговоры")), "выбор статуса");
    mark = calls.length;
    press(card1.message_id, /Переговоры$/);
    const afterStatus = await waitMessage(mark, (m) => m.message_id === card1.message_id && m.text.includes("📌 Статус: 🤝 Переговоры"), "статус в карточке");
    check("статус меняется из Telegram", (await prisma.lead.findUnique({ where: { id: card2Lead.id } }))?.status === "NEGOTIATION");
    check("после смены статуса «Следующий» сохранился", buttons(afterStatus.message_id).some((b) => b.text === "➡️ Следующий"));

    // предложение
    mark = calls.length;
    press(card1.message_id, "✨ Создать предложение");
    const proposal = await waitMessage(mark, (m) => m.text.startsWith("Здравствуйте!"), "текст предложения");
    check("✨ предложение по фактам лида", proposal.text.includes("Обратил внимание на ваш барбершоп") && !proposal.text.includes("@"), proposal.text);
    check("предложение сохранено в лиде", !!(await prisma.lead.findUnique({ where: { id: card2Lead.id } }))?.proposal);
    check("пометка «шаблон, AI не подключён»", calls.slice(mark).some((c) => String(c.body.text ?? "").includes("AI не подключён")));

    // задача из лида
    mark = calls.length;
    press(card1.message_id, "➕ Создать задачу");
    await waitMessage(mark, (m) => m.text.includes("Задача создана"), "задача создана");
    const leadTasks = await prisma.leadTask.findMany({ where: { leadId: card2Lead.id }, include: { task: true } });
    check("➕ задача создана и связана с лидом", leadTasks.length === 1 && leadTasks[0]!.task.title === `Связаться с ${card2Lead.name} — предложить сайт`);
    check("в задаче все данные лида", !!leadTasks[0]?.task.description?.includes("Тип: Продажа сайта") && !!leadTasks[0]?.task.description?.includes("Статус лида: Переговоры"));
    check("задача видна в общем списке задач", (await prisma.task.count({ where: { workspaceId: ws.id } })) === 3);
    check("в ленте активности есть запись", (await prisma.taskActivity.count({ where: { workspaceId: ws.id, type: "task_created" } })) === 1);

    mark = calls.length;
    press(card1.message_id, "✅ Задача есть");
    const again = await waitMessage(mark, (m) => m.text.includes("уже есть задача"), "повторная задача");
    check("повторно задачу без подтверждения не создаёт", (await prisma.leadTask.count({ where: { leadId: card2Lead.id } })) === 1);
    mark = calls.length;
    press(again.message_id, "➕ Да, создать ещё одну");
    await waitMessage(mark, (m) => m.text.includes("Задача создана"), "вторая задача");
    check("по явному подтверждению — вторая задача", (await prisma.leadTask.count({ where: { leadId: card2Lead.id } })) === 2);

    // контакты / соцсети
    mark = calls.length;
    press(card1.message_id, "📞 Контакты");
    const contacts = await waitMessage(mark, (m) => m.text.includes("Контакты «"), "контакты");
    check("📞 Контакты", contacts.text.includes("Телефон:") && contacts.text.includes("Email:"));

    // ===== дубли =====
    const s2 = await runWizard({ nicheButton: "Барбершопы", city: "Москва", count: "5", start: "✅ Начать поиск" });
    check("повторный поиск: дубли не создаются", (await prisma.lead.count({ where: { workspaceId: ws.id } })) === 5);
    check("повторный поиск: «Уже были в базе: 5»", s2.summary.text.includes("Уже были в базе: 5"), s2.summary.text);
    check("статус и «сохранён» у дубля не сброшены", (await prisma.lead.findUnique({ where: { id: card2Lead.id } }))?.status === "NEGOTIATION");

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
    const s4 = await runWizard({ nicheButton: "Барбершопы", city: "Казань", count: "5", start: "✅ Начать поиск" });
    check("OSM недоступен: предупреждение и поиск продолжился", s4.summary.text.includes("Не удалось получить данные из OpenStreetMap") && s4.summary.text.includes("<b>2 лида</b>"), s4.summary.text);
    check("во время поиска было предупреждение", calls.slice(mark).some((c) => String(c.body.text ?? "").includes("Продолжаю поиск")));
    state.osmMode = "ok";

    state.yandexMode = "403";
    const s5 = await runWizard({ nicheButton: "Барбершопы", city: "Москва", count: "5", start: "✅ Начать поиск" });
    check("Яндекс вернул ошибку: переход на OSM с предупреждением", s5.summary.text.includes("Не удалось получить данные из Яндекса") && s5.summary.text.includes("Источник: OpenStreetMap"), s5.summary.text);
    state.yandexMode = "ok";

    // ===== «Дополнительно» как фильтр =====
    const s6 = await runWizard({ nicheButton: "Барбершопы", city: "Москва", count: "5", extra: "только без сайта", start: "✅ Начать поиск" });
    check("«Дополнительно: без сайта» распознано", s6.confirmText.includes("Учту: только бизнесы без собственного сайта"), s6.confirmText);
    const s6search = await prisma.leadSearch.findFirst({ where: { workspaceId: ws.id, extra: "только без сайта" }, include: { results: { include: { lead: true } } } });
    check("фильтр «без сайта» соблюдён", !!s6search && s6search.results.every((r) => r.lead.websiteKind !== "own"));

    // ===== мои лиды / история / статистика / настройки =====
    mark = calls.length;
    sendText("❤️ Мои лиды");
    const list = await waitMessage(mark, (m) => m.text.includes("МОИ ЛИДЫ"), "мои лиды");
    const total = await prisma.lead.count({ where: { workspaceId: ws.id } });
    check("❤️ Мои лиды: все лиды", list.text.includes(`Всего: ${total}`), list.text.slice(0, 120));
    mark = calls.length;
    press(list.message_id, "🤝");
    const neg = await waitMessage(mark, (m) => m.message_id === list.message_id && m.text.includes("Переговоры"), "фильтр переговоры");
    check("фильтр «Переговоры»", neg.text.includes("Всего: 1") && neg.text.includes(card2Lead.name), neg.text);
    mark = calls.length;
    press(list.message_id, "🔍 Поиск");
    await waitMessage(mark, (m) => m.text.includes("часть названия"), "запрос поиска");
    mark = calls.length;
    sendText("insta");
    const found = await waitMessage(mark, (m) => m.text.includes("МОИ ЛИДЫ") && m.text.includes("«insta»"), "поиск по названию");
    check("поиск по названию", found.text.includes("Insta Cuts") && found.text.includes("Всего: 1"), found.text);
    mark = calls.length;
    press(found.message_id, /Insta Cuts/);
    const opened = await waitMessage(mark, (m) => m.text.includes("🏢 <b>Название:</b>\nInsta Cuts"), "открыть лид из списка");
    check("открытие лида из списка", !!opened);

    mark = calls.length;
    sendText("🕘 История поиска");
    const hist = await waitMessage(mark, (m) => m.text.includes("ИСТОРИЯ ПОИСКА"), "история");
    check("🕘 История: записи поисков", hist.text.includes("Барбершопы — Москва — 5 лидов") && hist.text.includes("Барбершопы — Казань — 2 лида"), hist.text);
    mark = calls.length;
    press(hist.message_id, /Казань/);
    const histOpen = await waitMessage(mark, (m) => m.text.includes("Поиск от"), "открыть поиск из истории");
    check("открытие поиска из истории", buttons(histOpen.message_id).some((b) => b.text === "👀 Смотреть лиды"));

    mark = calls.length;
    sendText("📊 Статистика");
    const stats = await waitMessage(mark, (m) => m.text.includes("📊 <b>ЛИДЫ</b>"), "статистика");
    check("📊 Статистика", stats.text.includes(`Всего: ${total}`) && stats.text.includes("🤝 Переговоры: 1") && stats.text.includes("не гарантированный доход"), stats.text);
    mark = calls.length;
    press(stats.message_id, "✏️ Изменить средний чек");
    await waitMessage(mark, (m) => m.text.includes("средний чек"), "запрос среднего чека");
    mark = calls.length;
    sendText("75 000");
    await waitMessage(mark, (m) => m.text.includes("Средний чек:"), "средний чек сохранён");
    check("⚙️ средний чек сохраняется", (await prisma.leadSettings.findUnique({ where: { workspaceId: ws.id } }))?.avgCheck === 75000);

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
    const nc = await waitMessage(mark, (m) => m.text.includes("пока не настроен"), "не настроено");
    check("без ключа Яндекса — «⚠️ Поиск клиентов пока не настроен»", !buttons(nc.message_id).some((b) => b.text === "✅ Начать поиск"));
    // OSM лежит → понятная ошибка и кнопка «Повторить»; OSM ожил → повтор проходит
    state.osmMode = "500";
    let m2 = calls.length;
    press(nc.message_id, "🗺 Искать только по OpenStreetMap");
    const failed = await waitMessage(m2, (m) => m.text.includes("Поиск не выполнен"), "OSM недоступен", 30000);
    check("OSM недоступен — понятная ошибка без технического мусора", failed.text.includes("OpenStreetMap сейчас не отвечает") && !failed.text.includes("&lt;?xml"), failed.text);
    check("у неудачного поиска кнопка «🔁 Повторить поиск»", buttons(failed.message_id).some((b) => b.text === "🔁 Повторить поиск"));
    state.osmMode = "ok";
    m2 = calls.length;
    press(failed.message_id, "🔁 Повторить поиск");
    const osmOnly = await waitMessage(m2, (m) => m.text.includes("Поиск завершён"), "повтор поиска только по OSM", 30000);
    check("поиск только по OSM работает без ключа (после повтора)", osmOnly.text.includes("Источник: OpenStreetMap"), osmOnly.text);

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
    check("всплывающие подсказки на кнопках", toasts.includes("❤️ Лид сохранён") && toasts.some((t) => t.startsWith("Статус:")), toasts.join(" | "));
  } catch (err) {
    check("сценарий выполнен без исключений", false, (err as Error).message);
  } finally {
    await stopBot();
    server.close();
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
