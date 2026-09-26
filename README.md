# Tandem

A private, two-person shared task workspace, built as a Telegram Mini App.
Dark-luxury, live-countdown, realtime — the design brief this repo
implements is fully described in the product spec you provided; this
README covers the engineering side.

**Where things stand:** this is a complete, working full-stack app — backend
(auth, database, tasks, comments, presence, notifications, recurring tasks,
attachments, bot) **and** a real Next.js/React frontend wired to that API,
using the same dark-luxury visual language as `tandem-demo.html`. The
standalone demo remains useful as a zero-backend way to show someone the
UI/UX; `app/page.tsx` and `app/components/*` are the real, data-connected
version of the same screens.

**Известное ограничение:** SSE-реализация realtime (`lib/pubsub.ts` + `app/api/stream/route.ts`) держит состояние подписчиков в памяти одного Node-процесса — на классическом serverless-хостинге (например, Vercel Functions) разные вызовы не разделяют эту память, и push не сработает. Для такого хостинга смотри §6 — там расписано, чем заменить `lib/pubsub.ts` (Pusher/Ably) без изменений в самих API-роутах.

## 0. Быстрый старт — попробовать прямо сейчас, без Telegram и без деплоя

Приложение можно полноценно погонять локально вдвоём, открыв два окна
браузера — не нужен ни бот, ни ngrok, ни настоящий Telegram-аккаунт.

```bash
cp .env.example .env
# обязательно: DATABASE_URL — адрес любого Postgres (см. ниже, если его ещё нет)
# уже стоит по умолчанию: ALLOW_DEV_AUTH="true"

npm install
npx prisma migrate dev --name init
npm run dev
```

Если под рукой нет Postgres — быстрее всего поднять его тоже локально:
```bash
docker run --name tandem-db -e POSTGRES_PASSWORD=tandem -p 5432:5432 -d postgres:16
# тогда DATABASE_URL в .env: postgresql://postgres:tandem@localhost:5432/tandem
```

Дальше:

1. Открой **`http://localhost:3000`** в одном окне браузера — это «Вы».
   Приложение автоматически создаст пользователя и рабочее пространство
   и покажет экран приглашения («1 / 2 участника»).
2. На этом экране в режиме разработки видна прямая ссылка вида
   `http://localhost:3000?devUser=2&startapp=invite_<токен>` — скопируй
   её и открой **в новом окне браузера** (важно: именно в новом окне, а
   не в новой вкладке той же сессии, если используешь режим инкогнито —
   иначе не принципиально, `sessionStorage` у вкладок и так раздельный).
3. Второе окно станет «Партнёром» — как только оно откроет ссылку,
   рабочее пространство в обоих окнах автоматически обновится (это уже
   настоящий SSE-realtime, не заглушка) и оба увидят полноценный
   интерфейс: создание задач, дедлайны с живым таймером, прогресс,
   presence («партнёр работает над …»), комментарии, повторяющиеся
   задачи.

В правом верхнем углу в dev-режиме виден маленький бейдж
`DEV · пользователь N · вторая вкладка: ?devUser=…` — он показывает,
за какого пользователя ты сейчас смотришь на приложение, и напоминает
параметр для второго окна.

Это работает благодаря `ALLOW_DEV_AUTH=true`: бэкенд принимает заголовок
`X-Dev-User-Id` вместо настоящей Telegram-подписи (см.
`lib/telegram-auth.ts`) — но **только** пока `NODE_ENV !== "production"`;
в проде этот путь жёстко заблокирован в коде, а не просто по
договорённости.

Когда захочешь подключить настоящий Telegram — это §8 ниже; локальный
флоу выше не требует для этого никаких изменений в коде.

## 1. What this is

- **Frontend:** Next.js 14 (App Router) + TypeScript, deployed as the
  Telegram Mini App's web view.
- **Backend:** Next.js API routes (same app, no separate server) +
  PostgreSQL via Prisma.
- **Bot:** a small standalone grammY process for `/start`, `/task`,
  `/tasks`, invite deep links, and the "Open App" button. Runs separately
  from the web app (see §8).
- **Realtime:** SSE поверх внутрипроцессного pub/sub — см. §6 для деталей и
  ограничений на serverless-хостинге.
- **Notifications:** scheduled DB rows, delivered by a cron-triggered route
  (§7), never sent synchronously from a request handler.

## 2. Architecture

```
tandem/
├── app/
│   ├── layout.tsx                     root layout, loads the Telegram WebApp SDK script
│   ├── page.tsx                       view switching (home/tasks/done/activity) + sheet state
│   ├── globals.css                    the full design system (tokens, task cards, sheets, nav — shared with tandem-demo.html)
│   ├── components/                    PresenceHeader, TaskCard, Countdown, ProgressRing, SummaryStrip,
│   │                                  BottomNav, NewTaskSheet, TaskDetailSheet, ActivityFeed, Toasts,
│   │                                  EmptyState, InviteScreen (экран ожидания второго участника)
│   └── api/
│       ├── auth/route.ts              GET resolve-or-create workspace, POST join via invite
│       ├── activity/route.ts          GET recent workspace activity
│       ├── stream/route.ts            SSE-поток realtime-событий (см. §6)
│       ├── recurring/route.ts         POST создать правило повторения задачи
│       ├── tasks/route.ts             GET list, POST create (принимает опциональный recurrenceId)
│       ├── tasks/[id]/route.ts        PATCH update, DELETE
│       ├── tasks/[id]/comments/route.ts   GET list, POST create
│       ├── tasks/[id]/attachments/route.ts  POST request upload URL, PATCH confirm, GET list+download URLs
│       ├── presence/route.ts          GET both members' presence, POST heartbeat
│       └── notifications/cron/route.ts
├── lib/
│   ├── prisma.ts                      Prisma client singleton
│   ├── telegram-auth.ts               initData validation + auth guard (READ THIS FIRST)
│   ├── telegram-client.ts             browser-side: Telegram WebApp bootstrap, haptics, authed fetch wrapper,
│   │                                  start_param / deep-link helpers
│   ├── realtime.ts                    клиентская подписка на /api/stream (EventSource)
│   ├── pubsub.ts                      внутрипроцессный pub/sub для realtime-событий (см. §6)
│   ├── workspace-context.tsx          React context: SSE + редкий поллинг-фолбэк, оптимистичные мутации, join-по-ссылке при старте
│   ├── api.ts                         typed client functions, one per API route
│   ├── activity.ts                    activity feed writer
│   ├── notifications.ts               scheduling + delivery + overdue sweep
│   ├── telegram-send.ts               Bot API sendMessage wrapper
│   ├── recurrence.ts                  next-occurrence generator (wired into tasks/[id] on completion)
│   ├── storage.ts                     S3-compatible presigned upload/download
│   ├── quick-add-parser.ts            "Finish X tomorrow 18:00" / "Закончить X завтра 18:00" → {title, deadline}
│   └── leads/                         поиск клиентов: источники, проверка сайтов, скоринг, дубли (см. §14)
├── bot/index.ts                       standalone Telegram bot process
├── bot/menu.ts, bot/state.ts          главное меню и пошаговый ввод
├── bot/leads/                         раздел «🔎 Найти клиентов» в боте (см. §14)
├── scripts/leads-e2e.ts               сквозной прогон бота на подделках внешних сервисов
├── prisma/schema.prisma                full data model
└── vercel.json                        cron config for notification delivery
```

## 3. Data model

See `prisma/schema.prisma`. Highlights:

- `Workspace` has no hard DB constraint capping membership at 2 (Postgres
  can't express "count of rows in a related table ≤ 2" declaratively) —
  it's enforced in `app/api/auth/route.ts`'s join handler instead. If you
  want belt-and-suspenders, add a Postgres trigger.
- `WorkspaceMember.userId` is `@unique`, so a user can only ever belong to
  one workspace — matches the "no third person, no multiple workspaces"
  brief exactly.
- `TaskActivity` is a flat append-only log (`type` + `meta` JSON) rather
  than one table per event type — simplest thing that supports the
  activity feed and is easy to extend.
- `RecurringTask` + `Task.recurrenceId`: completing a recurring task's
  instance should call `createNextOccurrence()` (see `lib/recurrence.ts`)
  from the `PATCH /api/tasks/[id]` handler when `status` transitions to
  `DONE` and the task has a `recurrenceId` — wire that one line in
  yourself (left out of the scaffold so you can decide exactly where it
  fits your completion flow, e.g. whether to skip regenerating an overdue
  recurring task that's completed very late).

## 4. Authentication (read this before anything else)

`lib/telegram-auth.ts` implements Telegram's documented `initData`
validation (HMAC-SHA256 over the sorted, `hash`-excluded key=value pairs,
keyed by `HMAC-SHA256("WebAppData", BOT_TOKEN)`). Every API route calls
`requireAuthedUser(request)` first, which:

1. Reads `initData` from the `X-Telegram-Init-Data` request header (your
   frontend sets this from `window.Telegram.WebApp.initData` on every
   fetch).
2. Validates the HMAC and a 24h max age.
3. Upserts the corresponding `User` row.
4. Never trusts a plain user ID sent from the client.

`ALLOW_DEV_AUTH=true` lets you run the app locally outside Telegram — and,
via `X-Dev-User-Id` / `?devUser=N`, as either of the two workspace members
in separate browser tabs (see §0). It is hard-blocked in
`NODE_ENV=production` in code, not just by convention — double-check this
survives your specific deploy target's env handling before going live.

## 5. Local development

Covered in §0 above — same `.env` + `npm install` + `npx prisma migrate dev`
+ `npm run dev` flow. The only thing to add here: `ALLOW_DEV_AUTH=true`
now supports more than one fixed user — each browser tab gets its own dev
identity via `?devUser=N` / `X-Dev-User-Id`, so you can develop against
real API routes as either workspace member without a Telegram client in
the loop. See `lib/telegram-auth.ts`'s `devFallbackUser` and
`lib/telegram-client.ts`'s `getDevUserId` for how it's wired.

## 6. Realtime

Реализовано: `lib/pubsub.ts` — внутрипроцессный pub/sub, `app/api/stream/route.ts` —
SSE-эндпоинт, `lib/realtime.ts` — клиентская подписка через `EventSource`.
Каждый мутирующий роут (`tasks`, `tasks/[id]`, `comments`, `presence`,
`auth` join) вызывает `publish()` после записи в БД; фронтенд при любом
событии делает `refreshAll()` (см. `lib/workspace-context.tsx`) — это
не самая гранулярная схема (перезагружаются все данные, а не только
изменившееся), но для двух пользователей и лёгкого API это не проблема
производительности, а нам важнее простота.

**Важно про деплой:** `lib/pubsub.ts` хранит подписчиков в памяти одного
Node-процесса. Это значит:
- **Подходит:** любой хостинг, где backend — один долгоживущий процесс
  (Railway, Fly.io, Render, обычная VM, `next start` за pm2/systemd).
- **Не подходит как есть:** классический Vercel serverless — разные
  вызовы функции не гарантированно попадают в один процесс, и SSE-клиент
  может подключиться к инстансу, который никогда не увидит `publish()` из
  другого. Если деплоишь именно так — замени `lib/pubsub.ts` на клиент
  [Pusher Channels](https://pusher.com) или [Ably](https://ably.com)
  (бесплатного тарифа достаточно): `publish()` → `pusher.trigger(...)`,
  а `app/api/stream/route.ts` можно удалить целиком — фронтенд подписывается
  на канал напрямую через их SDK вместо `lib/realtime.ts`. Сигнатура
  событий (`{type, workspaceId, payload}`) специально рассчитана на такую
  замену без переписывания роутов.

EventSource не умеет ставить кастомные заголовки, поэтому `/api/stream`
аутентифицируется через `?initData=...` в query-параметре, а не через
заголовок `X-Telegram-Init-Data`, как остальные роуты — это единственное
исключение, см. `requireAuthedUserFromQuery` в `lib/telegram-auth.ts`.

## 7. Notifications

- `lib/notifications.ts` schedules `Notification` rows (deadline offsets:
  24h/3h/1h/30m/10m, each gated by the recipient's
  `NotificationPreference`) whenever a task is created or its deadline
  changes, and cancels them when the task is completed or the deadline
  moves again.
- `app/api/notifications/cron/route.ts` is the only thing that actually
  sends: it's a plain HTTP GET, guarded by `?secret=CRON_SECRET`, meant to
  be hit once a minute by an external scheduler.
  - On **Vercel**: `vercel.json` already declares the cron (fill in your
    real `CRON_SECRET` in the URL — Vercel's `crons` config doesn't
    support env var interpolation, so this has to be the literal value).
  - Anywhere else: any scheduler that can hit a URL once a minute
    (cron-job.org, a GitHub Actions scheduled workflow, `crontab` on a
    small VM) works identically.
- `friend_created_task` / `assigned_new_task` / `friend_completed_task` /
  `friend_started_working` events described in the brief aren't fully
  wired into every mutation route in this scaffold — `comment_added` is
  (see `tasks/[id]/comments/route.ts` as the reference pattern); replicate
  `notifyEvent(...)` calls into the task create/complete/presence routes
  the same way once you've decided the exact copy for each.

## 8. Запуск в настоящем Telegram — по шагам

Это самый короткий путь от «работает у меня локально» до «работает в
Telegram у нас двоих». Понадобится любой VPS (или даже свой компьютер —
но тогда он должен быть постоянно включён) с установленным Docker.

### 8.1 Создай бота

В [@BotFather](https://t.me/BotFather):
1. `/newbot` → получишь `TELEGRAM_BOT_TOKEN`.
2. Пока не вызывай `/newapp` — сначала нужен HTTPS-адрес (шаг 8.3).

### 8.2 Настрой `.env`

```bash
cp .env.example .env
```
Заполни как минимум:
- `TELEGRAM_BOT_TOKEN` — из шага 8.1
- `SESSION_SECRET`, `CRON_SECRET` — любые случайные строки
  (`openssl rand -hex 32`)
- `ALLOW_DEV_AUTH="false"` — в проде это в любом случае жёстко
  заблокировано кодом (см. §4), но лучше выключить явно
- `TELEGRAM_WEBAPP_URL` и `APP_URL` пока оставь пустыми — впишешь после
  шага 8.3

`DATABASE_URL`, `STORAGE_*` можно не трогать для быстрого старта —
`docker-compose.yml` сам поднимает Postgres и подставляет свой
`DATABASE_URL`; вложения (`STORAGE_*`) не обязательны, пока не начнёшь
ими пользоваться.

### 8.3 Получи HTTPS-адрес

Telegram требует HTTPS для Mini App. Два варианта:

**Вариант А — быстро попробовать сегодня, без домена и без оплаты:**
```bash
docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
docker compose logs cloudflared | grep trycloudflare
```
В логе появится адрес вида `https://random-words.trycloudflare.com` —
это твой `TELEGRAM_WEBAPP_URL` и `APP_URL`. Ссылка временная (перезапуск
контейнера — новый адрес), но для проверки, что всё вообще работает в
настоящем Telegram, — самый быстрый способ.

**Вариант Б — постоянный адрес на своём домене:**
Направь A-запись домена на IP сервера, впиши домен в `Caddyfile` вместо
`example.com`, затем:
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```
Caddy сам получит сертификат Let's Encrypt. `TELEGRAM_WEBAPP_URL` и
`APP_URL` — `https://твой-домен`.
Без Docker (Вариант В): обычный `docker compose up -d --build` поднимет
`app` на порту 3000 без HTTPS — годится только за собственным
реверс-прокси, который ты настраиваешь сам.

### 8.4 Впиши адрес и перезапусти

Обнови `TELEGRAM_WEBAPP_URL` и `APP_URL` в `.env`, затем:
```bash
docker compose up -d --build app bot cron
```

### 8.5 Зарегистрируй Mini App

Снова в [@BotFather](https://t.me/BotFather): `/newapp`, выбери своего
бота, укажи `TELEGRAM_WEBAPP_URL` из шага 8.3 как адрес приложения.

### 8.6 Готово — открывай в Telegram

Найди своего бота в Telegram, `/start`, кнопка «Open Tandem». Дальше —
ровно тот же флоу приглашения, что и в локальном dev-режиме (§0), только
теперь по-настоящему: приглашаешь партнёра по ссылке
`t.me/<бот>?startapp=invite_<token>`, которую покажет экран приглашения.

### Что дальше

- `docker compose logs -f app bot cron` — если что-то не так, начни отсюда.
- Обновление после правок в коде: `docker compose up -d --build app bot`.
- `docker compose down` останавливает всё; данные в Postgres остаются в
  volume `tandem_db_data` между перезапусками.

### Если вместо Docker — Vercel/Railway/Fly напрямую

Тоже можно, но два нюанса:
- SSE-realtime (`lib/pubsub.ts`) требует один постоянно живущий
  Node-процесс — на Vercel serverless он не будет работать между
  разными вызовами функции (см. §6 про замену на Pusher/Ably, если
  выбираешь именно Vercel).
- `bot/index.ts` использует long polling — деплой отдельным
  воркер-процессом (Railway/Fly worker), не как serverless-функция; либо
  переписать на webhook-режим grammY (`webhookCallback`), это тоже
  упомянуто в коде.

Инвайт-диплинки (`t.me/<бот>?startapp=invite_<token>`) и
`inviteToken` из `GET /api/auth` работают одинаково независимо от
способа деплоя — эта часть менять не нужно.

## 9. Mini App integration checklist (frontend)

Already wired in `app/layout.tsx` and `lib/telegram-client.ts`:

- `window.Telegram.WebApp.ready()` / `.expand()` on mount (`initTelegramWebApp()`).
- `initData` attached as the `X-Telegram-Init-Data` header on every `fetch` via `apiFetch()`.
- `Telegram.WebApp.HapticFeedback` wired into button presses (`haptic()`, `hapticSuccess()` in `lib/telegram-client.ts`) — falls back to silently doing nothing outside the real Telegram client, so it's safe to test in a plain browser.

Still to wire yourself, since they depend on decisions the brief leaves to you:
- `Telegram.WebApp.BackButton` for the task-detail sheet (currently closes via the ✕ button / scrim tap only).
- `Telegram.WebApp.themeParams` if you want anything to track the user's Telegram theme — the product's own dark-luxury palette in `globals.css` otherwise takes precedence per the brief, which is why this was left out.

## 10. File storage (attachments)

`TaskAttachment` stores metadata only (`storageKey`, `mimeType`, `size`).
Wire an upload route (`app/api/tasks/[id]/attachments/route.ts`, not
included) against any S3-compatible bucket using the `STORAGE_*` env vars
— generate a pre-signed PUT URL server-side, have the client upload
directly to storage, then POST the resulting key to save the row. Enforce
a size limit and an allowed-mimetype list server-side before issuing the
signed URL, not just in the frontend.

## 11. Testing

Not included as files (kept the scaffold lean), but prioritize, in this
order: `validateInitData` against known-good/known-bad fixtures, the
two-member workspace cap in `POST /api/auth/join`, deadline reminder
scheduling math in `scheduleDeadlineReminders`, and `nextOccurrenceDate`
in `lib/recurrence.ts` across each `RecurrenceFrequency` — these are the
places a subtle bug silently breaks trust in the product (a missed
reminder, a duplicate recurring task, a third person joining).

## 12. Deployment shape

Проще всего — `docker compose up` (см. §8): один контейнер приложения,
один Postgres, один бот, один cron-контейнер, опционально Caddy или
Cloudflare Tunnel для HTTPS. Без Kubernetes, без очередей, без
микросервисов — соответствует явному требованию брифа не разводить
лишнюю инфраструктуру. Если предпочитаешь managed-хостинг вместо
Docker — тот же набор частей (frontend+backend на любом Node-хостинге,
Postgres от Supabase/Railway/Neon, бот отдельным воркером, хранилище
файлов) — см. конец §8.

## 13. Troubleshooting

- **"Invalid Telegram authentication" локально:** запускаешь не с
  `ALLOW_DEV_AUTH=true`, либо тестируешь из настоящего Telegram-клиента
  против нехэттпс `TELEGRAM_WEBAPP_URL` — Telegram требует HTTPS.
- **"Invalid Telegram authentication" в Docker/проде:** проверь, что
  `TELEGRAM_BOT_TOKEN` в `.env` совпадает с тем, что выдал @BotFather —
  подпись `initData` считается именно по нему.
- **Notifications never arrive:** `docker compose logs cron` — если там
  тишина или ошибки, `CRON_SECRET` в `.env` не совпадает с тем, что
  сервис `cron` подставляет в запрос; сама переменная общая на оба.
- **Bot doesn't respond:** `docker compose logs bot` — самая частая
  причина при self-host не через Docker: `bot/index.ts` задеплоен как
  часть Next.js-приложения вместо отдельного процесса — long polling не
  может работать внутри serverless-функции запрос/ответ.
- **Cloudflare-туннель выдаёт новый адрес после каждого перезапуска:**
  это ожидаемо для "quick tunnel" (Вариант А в §8.3) — он для быстрой
  проверки, не для постоянного использования. Для постоянного адреса —
  Вариант Б (свой домен + Caddy).

## 14. Поиск клиентов (модуль лидов)

Раздел бота для поиска небольших бизнесов, которым может пригодиться сайт:
**поиск → анализ → контакт → задача → переговоры → клиент**. Отдельный
модуль: `lib/leads/` (логика, без Telegram) и `bot/leads/` (интерфейс в
боте). Существующие команды и Mini App не менялись; в `bot/index.ts`
добавлены только меню и подключение модуля.

**Меню бота** (`/start` или `/menu`): 📋 Задачи · ➕ Новая задача ·
🔎 Найти клиентов · ❤️ Мои лиды · 🕘 История поиска · 📊 Статистика ·
⚙️ Настройки. Команды `/task`, `/tasks`, `/app` работают как раньше;
новые — `/find`, `/leads`.

**Как ищет.**
1. Яндекс «API Поиска по организациям» — основной источник: название,
   адрес, сайт, телефоны, категория, режим работы.
2. OpenStreetMap — проверка и дополнение: тот же бизнес рядом на карте даёт
   соцсети/email/сайт, если их нет в Яндексе. Публичные серверы Overpass
   бывают перегружены — тогда бот пишет «⚠️ Не удалось получить данные из
   OpenStreetMap. Продолжаю поиск…» и работает дальше по Яндексу.
3. Проверка сайта (главная страница): открывается ли, адаптив (meta
   viewport), HTTPS, форма заявки / онлайн-запись, призыв к действию, год в
   копирайте, платформа, устаревшая вёрстка. Сайты за защитой от ботов
   (Cloudflare и т. п.) помечаются «не удалось проверить» и в оценку не идут.
4. Lead Score 0–100 — соответствие критериям поиска клиента (не рейтинг
   компании), с объяснением по пунктам; только по проверенным фактам.
   Не подходят: нет ни одного публичного контакта, современный сайт.

Ничего не выдумывается: если email/телефон/сайт не найдены — в карточке
«Не найден». Контакты с сайта берутся только компании (почта на её домене
или на публичном почтовике, соцсети, tel:-ссылки).

**Дубли.** Бизнес узнаётся по id в Яндексе/OSM, домену сайта, телефону,
названию + адресу/координатам. Повторный поиск не создаёт копий, а
дополняет существующий лид недостающими данными; статус, «сохранён» и
текст предложения не трогает. «🔄 Найти ещё» пропускает уже найденные.

**Задача из лида** создаётся в обычной таблице `Task` тем же путём, что и в
Mini App (лента активности, напоминания, уведомление партнёру), со всеми
данными лида в описании. Повторная задача — только после подтверждения.

**Предложение** («✨ Создать предложение») сейчас — шаблон строго по
фактам лида. Архитектура готова к Claude: генератор получает `LeadFacts`
и реализует интерфейс `ProposalGenerator` — см. комментарий в
`lib/leads/proposal/index.ts`. Бот ничего не отправляет сам.

**Настройка** — переменные в `.env` (см. `.env.example`):

| Переменная | Нужна | Что это |
|---|---|---|
| `YANDEX_PLACES_API_KEY` | да, для полноценного поиска | ключ «API Поиска по организациям» из Кабинета разработчика Яндекса |
| `LEADS_OSM_ENABLED` | нет (`true`) | проверка/дополнение через OpenStreetMap |
| `OVERPASS_API_URL` | нет | свои серверы Overpass через запятую |
| `LEADS_PROPOSAL_ENGINE` | нет (`template`) | движок текстов предложений |
| `LEADS_TIMEZONE` | нет (`Europe/Moscow`) | часовой пояс дат в истории |

После изменения `.env`: `docker compose up -d --build app bot`. Новые
таблицы создаются миграцией `prisma/migrations/*_leads_module` при старте
контейнера `app` (существующие таблицы не меняются).

**Тесты.**
- `npx vitest run` — unit-тесты модуля (скоринг, дубли, разбор сайтов и
  ответов API, конвейер поиска с отказами источников, шаблон, карточка).
- `npm run test:e2e` — сквозной прогон настоящего процесса бота против
  локальных подделок Telegram API, Яндекса, OSM и сайтов. Нужна отдельная
  тестовая БД, имя которой оканчивается на `_e2e` (она пересоздаётся):
  `E2E_DATABASE_URL=postgresql://postgres:tandem@localhost:5432/tandem_e2e`.
