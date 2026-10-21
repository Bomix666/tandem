// Сквозная проверка API раздела «Клиенты» в Mini App (/api/leads/*).
//
// Вызывает настоящие обработчики маршрутов Next.js на отдельной тестовой БД
// с поддельными источниками (scripts/lib/fake-sources.ts). Пользователи —
// dev-режим авторизации (X-Dev-User-Id), двое в одном пространстве.
//   E2E_DATABASE_URL=postgresql://postgres:tandem@localhost:5432/tandem_e2e npx tsx scripts/leads-api-e2e.ts

import { execSync } from "node:child_process";
import { fakeSourcesEnv, seedLocalOsm, startFakeSourcesServer } from "./lib/fake-sources";

const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:tandem@localhost:5432/tandem_e2e?schema=public";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: Request, ctx: { params: any }) => Promise<Response>;
interface Res {
  status: number;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const results: { name: string; ok: boolean; detail?: string }[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok });
  const d = detail === undefined ? "" : typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 400);
  console.log(`${ok ? "✅" : "❌"} ${name}${!ok && d ? `\n     ${d}` : ""}`);
}

async function main() {
  const dbName = new URL(E2E_DB).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_e2e")) throw new Error(`Тестовая БД должна оканчиваться на _e2e (сейчас «${dbName}»)`);
  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", { env: { ...process.env, DATABASE_URL: E2E_DB }, stdio: "ignore" });

  const sources = await startFakeSourcesServer();
  Object.assign(process.env, {
    DATABASE_URL: E2E_DB,
    NODE_ENV: "test",
    ALLOW_DEV_AUTH: "true",
    TELEGRAM_BOT_TOKEN: "123456:E2E-TEST-TOKEN",
    LEADS_PROPOSAL_ENGINE: "template", // не из .env: тексты в проверках — шаблоном, без настоящего Claude
    ...fakeSourcesEnv(sources.port),
  });

  const { prisma } = await import("../lib/prisma");
  const auth = await import("../app/api/auth/route");
  const leads = await import("../app/api/leads/route");
  const lead = await import("../app/api/leads/[id]/route");
  const proposal = await import("../app/api/leads/[id]/proposal/route");
  const task = await import("../app/api/leads/[id]/task/route");
  const searches = await import("../app/api/leads/searches/route");
  const search = await import("../app/api/leads/searches/[id]/route");
  const meta = await import("../app/api/leads/meta/route");
  const mail = await import("../app/go/mail/[id]/route");
  const dashboardRoute = await import("../app/api/leads/dashboard/route");
  const analyticsRoute = await import("../app/api/leads/analytics/route");
  const leadOutreach = await import("../app/api/leads/[id]/outreach/route");
  const outreachList = await import("../app/api/leads/outreach/route");
  const outreachOne = await import("../app/api/leads/outreach/[oid]/route");
  const leadFollowUp = await import("../app/api/leads/[id]/followup/route");
  const followUps = await import("../app/api/leads/followups/route");
  const followUpOne = await import("../app/api/leads/followups/[taskId]/route");
  const { outreachMailUrl } = await import("../lib/leads/outreach/links");

  async function call(handler: Handler, method: string, path: string, user: number, body?: unknown, params: Record<string, string> = {}): Promise<Res> {
    const req = new Request(`http://localhost${path}`, {
      method,
      headers: { "x-dev-user-id": String(user), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await handler(req, { params });
    return { status: res.status, json: await res.json().catch(() => null) };
  }
  async function waitDone(id: string, user = 1): Promise<Res> {
    for (let i = 0; i < 200; i++) {
      const r = await call(search.GET as Handler, "GET", `/api/leads/searches/${id}`, user, undefined, { id });
      if (r.json?.search?.status !== "RUNNING") return r;
      await new Promise((res) => setTimeout(res, 100));
    }
    throw new Error(`поиск ${id} не завершился`);
  }

  try {
    // ===== пространство на двоих =====
    const u1 = await call(auth.GET as Handler, "GET", "/api/auth", 1);
    const token = u1.json.workspace.inviteToken;
    await call(auth.POST as Handler, "POST", "/api/auth", 2, { token });
    const ws = await prisma.workspace.findFirstOrThrow({ include: { members: true } });
    check("подготовка: два участника в пространстве", ws.members.length === 2);

    // ===== meta =====
    let m = await call(meta.GET as Handler, "GET", "/api/leads/meta", 1);
    check("meta: источники, пресеты, пустая статистика", m.status === 200 && m.json.yandex === true && m.json.niches.includes("Барбершопы") && m.json.stats.total === 0 && m.json.activeSearch === null, m.json);

    // ===== запуск поиска =====
    const bad = await call(searches.POST as Handler, "POST", "/api/leads/searches", 1, { niche: "", city: "Москва", requested: 5 });
    check("валидация: пустая ниша → 400", bad.status === 400);

    // Яндекс — тестовая интеграция (source: "yandex"); по умолчанию поиск идёт по OSM
    const s1 = await call(searches.POST as Handler, "POST", "/api/leads/searches", 1, { niche: "Барбершопы", city: "Москва", requested: 5, source: "yandex" });
    check("POST /searches → 201, поиск идёт в фоне", s1.status === 201 && s1.json.search.status === "RUNNING" && s1.json.search.source === "yandex", s1.json);
    const busy = await call(searches.POST as Handler, "POST", "/api/leads/searches", 2, { niche: "Барбершопы", city: "Казань", requested: 5 });
    check("второй поиск в пространстве, пока идёт первый → 409 busy", busy.status === 409 && busy.json.error === "busy", busy);
    m = await call(meta.GET as Handler, "GET", "/api/leads/meta", 2);
    check("партнёр видит идущий поиск (activeSearch)", m.json.activeSearch?.id === s1.json.search.id, m.json.activeSearch);

    const d1 = await waitDone(s1.json.search.id);
    check("поиск завершён: 5 лидов, разбивка 2/3/0", d1.json.search.status === "DONE" && d1.json.leads.length === 5 && d1.json.search.breakdown.high === 2 && d1.json.search.breakdown.medium === 3, d1.json.search);
    check("счётчики поиска: бизнесов, с email", d1.json.search.candidates >= 5 && d1.json.search.withEmail === 1 && d1.json.search.needsReview === 1, d1.json.search);
    const first = d1.json.leads[0];
    check("лиды отсортированы: первый — Black Barber 95/100", first.name === "Black Barber" && first.score === 95, first);
    check("DTO лида: сайт, контакты, соцсети, причины, источники", first.site.kind === "none" && first.emails[0] === "hello@blackbarber.ru" && first.socials[0].label === "Instagram" && first.reasons.length > 3 && first.sources.length === 2, first);
    check(
      "DTO: email с проверкой и источником",
      first.contacts.length === 1 && first.contacts[0].check === "UNVERIFIED" && first.contacts[0].checkLabel === "Найден, не подтверждён" && first.contacts[0].sourceLabel === "OpenStreetMap" && first.contacts[0].primary,
      first.contacts
    );
    check("новые лиды — статус FOUND", d1.json.leads.every((l: { status: string }) => l.status === "FOUND"));
    const insta = d1.json.leads.find((l: { name: string }) => l.name === "Insta Cuts");
    check("нет email → пустой список (в интерфейсе «Не найден»)", insta && insta.emails.length === 0 && insta.site.kind === "social");

    // ===== «Мои лиды» =====
    let list = await call(leads.GET as Handler, "GET", "/api/leads?filter=a", 1);
    check("GET /leads: все 5", list.json.total === 5);
    list = await call(leads.GET as Handler, "GET", `/api/leads?filter=a&q=${encodeURIComponent("insta")}`, 1);
    check("поиск по названию", list.json.total === 1 && list.json.leads[0].name === "Insta Cuts");

    // ===== статус, сохранение =====
    const p1 = await call(lead.PATCH as Handler, "PATCH", `/api/leads/${insta.id}`, 1, { status: "NEGOTIATION", saved: true }, { id: insta.id });
    check("PATCH статус + сохранение", p1.status === 200 && p1.json.lead.status === "NEGOTIATION" && p1.json.lead.saved === true);
    check(
      "история: смена статуса и сохранение записаны с автором",
      (await prisma.leadEvent.count({ where: { leadId: insta.id, type: "STATUS_CHANGED", fromStatus: "FOUND", toStatus: "NEGOTIATION", actorId: { not: null } } })) === 1 &&
        (await prisma.leadEvent.count({ where: { leadId: insta.id, type: "SAVED" } })) === 1
    );
    const badStatus = await call(lead.PATCH as Handler, "PATCH", `/api/leads/${insta.id}`, 1, { status: "WHATEVER" }, { id: insta.id });
    check("неизвестный статус → 400", badStatus.status === 400);
    list = await call(leads.GET as Handler, "GET", "/api/leads?filter=g&q=inst", 1);
    check("фильтр «Переговоры» вместе с поиском по названию", list.json.total === 1);
    list = await call(leads.GET as Handler, "GET", "/api/leads?filter=f", 1);
    check("фильтр «Сохранённые»", list.json.total === 1);
    const seen = await call(lead.GET as Handler, "GET", `/api/leads/${insta.id}`, 2, undefined, { id: insta.id });
    check("партнёр видит те же лиды и статусы", seen.json.lead.status === "NEGOTIATION");

    // ===== предложение =====
    const pr = await call(proposal.POST as Handler, "POST", `/api/leads/${insta.id}/proposal`, 1, undefined, { id: insta.id });
    check("✨ предложение по фактам", pr.status === 200 && pr.json.text.startsWith("Здравствуйте!") && pr.json.text.includes("Instagram") && !pr.json.text.includes("@"), pr.json);
    check("предложение сохранено в лиде", (await prisma.lead.findUnique({ where: { id: insta.id } }))?.proposal === pr.json.text);
    check("предложение: тема письма; адресата нет — email не найден", !!pr.json.subject && pr.json.recipient === null, pr.json);
    check("черновик обращения (Outreach DRAFT)", (await prisma.outreach.count({ where: { leadId: insta.id, status: "DRAFT", channel: "EMAIL" } })) === 1);
    const pr2 = await call(proposal.POST as Handler, "POST", `/api/leads/${insta.id}/proposal`, 1, undefined, { id: insta.id });
    check("повторное «✨ предложение» не плодит черновики", pr2.json.text === pr.json.text && (await prisma.outreach.count({ where: { leadId: insta.id } })) === 1);

    // ===== задача из лида =====
    const t1 = await call(task.POST as Handler, "POST", `/api/leads/${insta.id}/task`, 1, {}, { id: insta.id });
    check("➕ задача создана", t1.status === 201 && t1.json.task.title === "Связаться с Insta Cuts — предложить сайт", t1.json);
    const t2 = await call(task.POST as Handler, "POST", `/api/leads/${insta.id}/task`, 1, {}, { id: insta.id });
    check("повторно — «уже есть», без новой задачи", t2.json.status === "exists" && (await prisma.leadTask.count({ where: { leadId: insta.id } })) === 1);
    const t3 = await call(task.POST as Handler, "POST", `/api/leads/${insta.id}/task`, 1, { force: true }, { id: insta.id });
    check("с подтверждением — вторая задача", t3.status === 201 && (await prisma.leadTask.count({ where: { leadId: insta.id } })) === 2);
    const taskRow = await prisma.task.findUniqueOrThrow({ where: { id: t1.json.task.id } });
    check("задача в общем списке задач, с данными лида", taskRow.workspaceId === ws.id && !!taskRow.description?.includes("Тип: Продажа сайта"));
    check("партнёру ушло уведомление о новой задаче", (await prisma.notification.count({ where: { type: "friend_created_task" } })) === 2);

    // ===== найти ещё / дубли =====
    const more = await call(searches.POST as Handler, "POST", "/api/leads/searches", 1, { fromSearchId: s1.json.search.id, mode: "more" });
    const d2 = await waitDone(more.json.search.id);
    const firstNames = new Set(d1.json.leads.map((l: { name: string }) => l.name));
    check(
      "«Найти ещё»: только новые бизнесы",
      d2.json.leads.length === 4 && d2.json.leads.every((l: { name: string }) => !firstNames.has(l.name)),
      d2.json.leads.map((l: { name: string }) => l.name)
    );
    const again = await call(searches.POST as Handler, "POST", "/api/leads/searches", 1, { niche: "Барбершопы", city: "Москва", requested: 5, source: "yandex" });
    const d3 = await waitDone(again.json.search.id);
    check("повторный поиск: дубли не создаются", (await prisma.lead.count()) === 9 && d3.json.search.breakdown.existing === 5, d3.json.search);

    // ===== отказы источников =====
    sources.state.osmMode = "500";
    const s4 = await call(searches.POST as Handler, "POST", "/api/leads/searches", 1, { niche: "Барбершопы", city: "Казань", requested: 5, source: "yandex" });
    const d4 = await waitDone(s4.json.search.id);
    check("OSM недоступен → предупреждение, поиск продолжился", d4.json.search.status === "DONE" && d4.json.search.warnings.join().includes("OpenStreetMap") && d4.json.leads.length === 2, d4.json.search);
    sources.state.osmMode = "ok";

    process.env.YANDEX_PLACES_API_KEY = "";
    const nc = await call(searches.POST as Handler, "POST", "/api/leads/searches", 1, { niche: "Барбершопы", city: "Москва", requested: 5, source: "yandex" });
    check("Яндекс без ключа → 400 not_configured", nc.status === 400 && nc.json.error === "not_configured");
    m = await call(meta.GET as Handler, "GET", "/api/leads/meta", 1);
    check("meta сообщает, что Яндекс не подключён", m.json.yandex === false);

    sources.state.osmMode = "500";
    const s5 = await call(searches.POST as Handler, "POST", "/api/leads/searches", 1, { niche: "Барбершопы", city: "Москва", requested: 5 });
    const d5 = await waitDone(s5.json.search.id);
    check("по умолчанию — OSM; Overpass лежит, локальной копии нет → понятная ошибка", d5.json.search.source === "osm" && d5.json.search.status === "FAILED" && d5.json.search.error.includes("Не удалось выполнить поиск по OpenStreetMap"), d5.json.search);
    sources.state.osmMode = "ok";
    const retry = await call(searches.POST as Handler, "POST", "/api/leads/searches", 1, { fromSearchId: s5.json.search.id, mode: "retry" });
    const d6 = await waitDone(retry.json.search.id);
    check("«Повторить» после восстановления OSM → поиск прошёл", d6.json.search.status === "DONE" && d6.json.search.parentId === null, d6.json.search);
    process.env.YANDEX_PLACES_API_KEY = fakeSourcesEnv(sources.port).YANDEX_PLACES_API_KEY!;

    // ===== история, статистика =====
    const hist = await call(searches.GET as Handler, "GET", "/api/leads/searches", 2);
    check("история поиска", hist.json.total === 6 && hist.json.searches[0].id === retry.json.search.id, hist.json.total);
    const avg = await call(meta.PATCH as Handler, "PATCH", "/api/leads/meta", 1, { avgCheck: 75000 });
    check("средний чек сохраняется", avg.json.stats.avgCheck === 75000);
    check("статистика по статусам", avg.json.stats.total === 11 /* 5 + 4 «ещё» + 2 Казань */ && avg.json.stats.byStatus.NEGOTIATION === 1 && avg.json.stats.saved === 1, avg.json.stats);

    // ===== доступ =====
    const stranger = await call(leads.GET as Handler, "GET", "/api/leads", 3);
    check("пользователь без пространства → 404", stranger.status === 404);
    const noAuth = await leads.GET(new Request("http://localhost/api/leads"));
    process.env.ALLOW_DEV_AUTH = "false";
    const noAuth2 = await leads.GET(new Request("http://localhost/api/leads"));
    process.env.ALLOW_DEV_AUTH = "true";
    check("без авторизации Telegram → 401", noAuth2.status === 401, noAuth.status);

    // ===== локальная копия OSM =====
    await seedLocalOsm(prisma);
    sources.state.osmMode = "500"; // Overpass не нужен
    const s7 = await call(searches.POST as Handler, "POST", "/api/leads/searches", 2, { niche: "Барбершопы", city: "Москва", requested: 5 });
    const d7 = await waitDone(s7.json.search.id, 2);
    sources.state.osmMode = "ok";
    const lv = d7.json.leads?.[0];
    check(
      "локальный OSM: в границах города, email со страницы «Контакты»",
      d7.json.search.status === "DONE" && d7.json.search.candidates === 2 && d7.json.leads.length === 1 && lv?.name === "Lavka Barber" && d7.json.search.withEmail === 1 && d7.json.search.needsReview === 1,
      d7.json.search
    );
    check(
      "DTO: 🟡 info@ с сайта и 🔴 мёртвый домен; личный адрес не сохранён",
      lv?.contacts.length === 2 &&
        lv.contacts[0].value === "info@lavka-barber.ru" && lv.contacts[0].check === "UNVERIFIED" && lv.contacts[0].source === "SITE" && lv.contacts[0].primary &&
        lv.contacts[1].check === "INVALID" && lv.emails.join() === "info@lavka-barber.ru",
      lv?.contacts
    );
    const lt = await call(task.POST as Handler, "POST", `/api/leads/${lv.id}/task`, 2, {}, { id: lv.id });
    const lvAfter = await call(lead.GET as Handler, "GET", `/api/leads/${lv.id}`, 1, undefined, { id: lv.id });
    check("задача из найденного лида → статус «Связаться»", lt.status === 201 && lvAfter.json.lead.status === "TO_CONTACT", lvAfter.json.lead.status);
    m = await call(meta.GET as Handler, "GET", "/api/leads/meta", 1);
    check("meta: состояние локальной копии OSM", m.json.osmStatus.startsWith("локальная копия от"), m.json.osmStatus);

    // «📨 Открыть почту» из бота: страница приложения с mailto, только по подписанной ссылке
    const lvDraft = await call(proposal.POST as Handler, "POST", `/api/leads/${lv.id}/proposal`, 2, undefined, { id: lv.id });
    const lvOutreach = await prisma.outreach.findFirstOrThrow({ where: { leadId: lv.id, channel: "EMAIL" } });
    process.env.APP_URL = "https://app.example";
    const link = outreachMailUrl(lvOutreach.id)!;
    const page = await mail.GET(new Request(link), { params: { id: lvOutreach.id } });
    const html = await page.text();
    check(
      "/go/mail: письмо, кнопка mailto с адресом и темой, отметка «Готово к отправке»",
      page.status === 200 && html.includes(`href="mailto:info@lavka-barber.ru?subject=`) && html.includes("Бот ничего не отправляет сам") && (await prisma.outreach.findUniqueOrThrow({ where: { id: lvOutreach.id } })).status === "READY",
      `${page.status} ${lvDraft.json.recipient}`
    );
    check(
      "/go/mail: «Открыть в Outlook» — письмо в веб-Outlook, личном и рабочем",
      html.includes('href="https://outlook.live.com/mail/0/deeplink/compose?to=info%40lavka-barber.ru&amp;subject=') &&
        html.includes('href="https://outlook.office.com/mail/deeplink/compose?to=info%40lavka-barber.ru&amp;subject=')
    );
    const forged = await mail.GET(new Request(`https://app.example/go/mail/${lvOutreach.id}?t=000000000000000000000000`), { params: { id: lvOutreach.id } });
    check("/go/mail: без верной подписи — 404", forged.status === 404);
    list = await call(leads.GET as Handler, "GET", "/api/leads?filter=w", 1);
    check("фильтр «⏳ Ждут ответа» принимается API", list.status === 200);

    // ===== Sales OS в Mini App: дашборд → письмо → отправил → follow-up → ответ =====
    const dash = await call(dashboardRoute.GET as Handler, "GET", "/api/leads/dashboard", 2);
    check("дашборд: реальные счётчики и ближайшее действие", dash.status === 200 && dash.json.dashboard.pipeline.toContact === 1 && !!dash.json.dashboard.next, dash.json.dashboard);
    const prep = await call(leadOutreach.POST as Handler, "POST", `/api/leads/${lv.id}/outreach`, 1, { channel: "EMAIL" }, { id: lv.id });
    const oid = prep.json.outreach.id;
    check(
      "письмо: открыт существующий черновик, ссылка «Открыть почту», проверка адреса",
      prep.status === 200 && prep.json.reused && oid === lvOutreach.id && prep.json.outreach.openUrl?.startsWith("https://app.example/go/mail/") && prep.json.outreach.recipientCheck === "UNVERIFIED",
      prep.json
    );
    let r = await call(outreachOne.PATCH as Handler, "PATCH", `/api/leads/outreach/${oid}`, 1, { subject: "Сайт для Lavka", body: "Добрый день! Свой текст письма для Lavka Barber." }, { oid });
    check("✏️ свой текст и тема", r.status === 200 && r.json.outreach.subject === "Сайт для Lavka" && r.json.outreach.edited, r.json);
    r = await call(outreachOne.PATCH as Handler, "PATCH", `/api/leads/outreach/${oid}`, 1, { action: "regenerate" }, { oid });
    check("🔄 другой вариант — та же запись, шаблонный текст", r.json.outreach.id === oid && r.json.outreach.variant === 1 && !r.json.outreach.edited);
    r = await call(outreachOne.PATCH as Handler, "PATCH", `/api/leads/outreach/${oid}`, 1, { action: "sent" }, { oid });
    check("✅ отправил: «Отправлено», лид «📨 Связались»", r.json.outreach.status === "SENT" && !r.json.outreach.editable && (await prisma.lead.findUniqueOrThrow({ where: { id: lv.id } })).status === "CONTACTED", r.json.outreach);
    const late = await call(outreachOne.PATCH as Handler, "PATCH", `/api/leads/outreach/${oid}`, 1, { subject: null, body: "Поздняя правка уже отправленного письма" }, { oid });
    check("отправленное письмо не правится → 409", late.status === 409);

    const fu1 = await call(leadFollowUp.POST as Handler, "POST", `/api/leads/${lv.id}/followup`, 1, { days: 2, outreachId: oid }, { id: lv.id });
    const fuAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const fu2 = await call(leadFollowUp.POST as Handler, "POST", `/api/leads/${lv.id}/followup`, 2, { at: fuAt }, { id: lv.id });
    check("⏰ follow-up: создан, повтор — перенос без дубля", fu1.status === 201 && fu2.status === 200 && fu2.json.followUp.taskId === fu1.json.followUp.taskId && fu2.json.followUp.at === fuAt, [fu1.json, fu2.json]);
    const past = await call(leadFollowUp.POST as Handler, "POST", `/api/leads/${lv.id}/followup`, 1, { at: new Date(Date.now() - 86_400_000).toISOString() }, { id: lv.id });
    check("дата в прошлом → 400", past.status === 400);
    let fl = await call(followUps.GET as Handler, "GET", "/api/leads/followups", 1);
    check("список follow-up: лид, срок, письмо", fl.json.total === 1 && fl.json.items[0].leadName === "Lavka Barber" && fl.json.items[0].outreach?.id === oid && fl.json.counts.later === 1, fl.json);
    const taskId = fu1.json.followUp.taskId;
    r = await call(followUpOne.POST as Handler, "POST", `/api/leads/followups/${taskId}`, 1, { action: "snooze", days: 1 }, { taskId });
    check("⏰ отложить на день", r.status === 200 && r.json.followUp.scope !== "overdue", r.json);
    r = await call(followUpOne.POST as Handler, "POST", `/api/leads/followups/${taskId}`, 1, { action: "close", how: "replied" }, { taskId });
    const replied = await call(outreachOne.GET as Handler, "GET", `/api/leads/outreach/${oid}`, 1, undefined, { oid });
    check("✅ закрыть «ответили»: письмо «Ответ получен», лид «💬 Переговоры»", r.json.followUp.done && replied.json.outreach.status === "REPLIED" && (await prisma.lead.findUniqueOrThrow({ where: { id: lv.id } })).status === "NEGOTIATION");
    const closedAgain = await call(followUpOne.POST as Handler, "POST", `/api/leads/followups/${taskId}`, 1, { action: "snooze", days: 1 }, { taskId });
    fl = await call(followUps.GET as Handler, "GET", "/api/leads/followups", 1);
    check("закрытый follow-up больше не трогается и не в списке", closedAgain.status === 409 && fl.json.total === 0);

    const outList = await call(outreachList.GET as Handler, "GET", "/api/leads/outreach?status=REPLIED", 2);
    check("📨 Outreach: список по статусу и счётчики", outList.json.items.length === 1 && outList.json.items[0].leadName === "Lavka Barber" && outList.json.counts.REPLIED === 1 && outList.json.counts.DRAFT >= 1, outList.json.counts);
    const wa = await call(leadOutreach.POST as Handler, "POST", `/api/leads/${lv.id}/outreach`, 1, { channel: "WHATSAPP" }, { id: lv.id });
    check("📱 WhatsApp: новый черновик и ссылка wa.me", wa.status === 201 && wa.json.outreach.openUrl?.startsWith("https://wa.me/") && wa.json.outreach.channel === "WHATSAPP", wa.json.outreach);
    const del = await call(outreachOne.DELETE as Handler, "DELETE", `/api/leads/outreach/${wa.json.outreach.id}`, 1, undefined, { oid: wa.json.outreach.id });
    const delSent = await call(outreachOne.DELETE as Handler, "DELETE", `/api/leads/outreach/${oid}`, 1, undefined, { oid });
    check("❌ удаляется только черновик", del.status === 200 && delSent.status === 409);

    const an = await call(analyticsRoute.GET as Handler, "GET", "/api/leads/analytics?period=7", 1);
    check("📊 аналитика: связались, ответили, коэффициенты", an.json.analytics.period === 7 && an.json.analytics.contacted >= 1 && an.json.analytics.replied >= 1 && typeof an.json.analytics.rates.reply === "number", an.json.analytics);
    const sender = await call(meta.PATCH as Handler, "PATCH", "/api/leads/meta", 1, { sender: { name: "Никита", portfolioUrl: "https://portfolio.example" } });
    const badSender = await call(meta.PATCH as Handler, "PATCH", "/api/leads/meta", 1, { sender: { portfolioUrl: "не ссылка" } });
    check("✍️ подпись из Mini App сохраняется (и проверяется ссылка)", sender.json.sender.name === "Никита" && sender.json.sender.portfolioUrl === "https://portfolio.example" && badSender.status === 400, sender.json.sender);
    list = await call(leads.GET as Handler, "GET", "/api/leads?filter=d", 1);
    check("фильтр «🔎 Найденные»", list.status === 200 && list.json.leads.every((l: { status: string }) => l.status === "FOUND"), list.json.total);

    // ===== удаление задач =====
    const taskRoute = await import("../app/api/tasks/[id]/route");
    const me = await prisma.user.findFirstOrThrow({ where: { telegramId: BigInt(1) } });
    const instaDraft = await prisma.outreach.findFirstOrThrow({ where: { leadId: insta.id, channel: "EMAIL" } });
    await call(outreachOne.PATCH as Handler, "PATCH", `/api/leads/outreach/${instaDraft.id}`, 1, { action: "sent" }, { oid: instaDraft.id });
    const fuDel = await call(leadFollowUp.POST as Handler, "POST", `/api/leads/${insta.id}/followup`, 1, { days: 3, outreachId: instaDraft.id }, { id: insta.id });
    const fuTaskId = fuDel.json.followUp.taskId;
    await prisma.presence.upsert({
      where: { userId: me.id },
      update: { status: "WORKING", workingTaskId: fuTaskId },
      create: { userId: me.id, status: "WORKING", workingTaskId: fuTaskId },
    });
    check(
      "перед удалением: у обращения стоит follow-up, есть напоминание",
      !!(await prisma.outreach.findUniqueOrThrow({ where: { id: instaDraft.id } })).followUpAt && (await prisma.notification.count({ where: { taskId: fuTaskId } })) === 1
    );
    const delFu = await call(taskRoute.DELETE as Handler, "DELETE", `/api/tasks/${fuTaskId}`, 2, undefined, { id: fuTaskId });
    check("партнёр удаляет задачу follow-up → 200", delFu.status === 200 && !(await prisma.task.findUnique({ where: { id: fuTaskId } })));
    check(
      "удаление follow-up: связь с лидом и напоминание ушли, у обращения нет даты, лид остался",
      !(await prisma.leadTask.count({ where: { taskId: fuTaskId } })) &&
        !(await prisma.notification.count({ where: { taskId: fuTaskId } })) &&
        (await prisma.outreach.findUniqueOrThrow({ where: { id: instaDraft.id } })).followUpAt === null &&
        !!(await prisma.lead.findUnique({ where: { id: insta.id } }))
    );
    const pres = await prisma.presence.findUniqueOrThrow({ where: { userId: me.id } });
    check("«работаю над задачей» сброшено, статус не завис", pres.workingTaskId === null && pres.status === "ONLINE", pres);
    check(
      "в ленте запись об удалении с названием",
      (await prisma.taskActivity.count({ where: { type: "task_deleted", workspaceId: ws.id } })) >= 1 &&
        JSON.stringify((await prisma.taskActivity.findFirstOrThrow({ where: { type: "task_deleted", workspaceId: ws.id }, orderBy: { createdAt: "desc" } })).meta).includes("Follow-up")
    );

    const tasksBefore = (await call(lead.GET as Handler, "GET", `/api/leads/${insta.id}`, 1, undefined, { id: insta.id })).json.lead.tasks.length;
    const delContact = await call(taskRoute.DELETE as Handler, "DELETE", `/api/tasks/${t1.json.task.id}`, 1, undefined, { id: t1.json.task.id });
    const tasksAfter = (await call(lead.GET as Handler, "GET", `/api/leads/${insta.id}`, 1, undefined, { id: insta.id })).json.lead.tasks.length;
    check("удаление задачи «Связаться»: лид остаётся, в карточке на одну задачу меньше", delContact.status === 200 && tasksAfter === tasksBefore - 1, `${tasksBefore} → ${tasksAfter}`);
    const deletedTwice = await call(taskRoute.DELETE as Handler, "DELETE", `/api/tasks/${t1.json.task.id}`, 1, undefined, { id: t1.json.task.id });
    check("повторное удаление → 404", deletedTwice.status === 404);

    const otherWs = await prisma.workspace.create({ data: {} });
    const foreignTask = await prisma.task.create({
      data: { workspaceId: otherWs.id, creatorId: me.id, assigneeId: me.id, title: "Чужая задача", deadlineAt: new Date(Date.now() + 86_400_000) },
    });
    const delForeign = await call(taskRoute.DELETE as Handler, "DELETE", `/api/tasks/${foreignTask.id}`, 1, undefined, { id: foreignTask.id });
    check("задачу из чужого пространства удалить нельзя → 404, задача на месте", delForeign.status === 404 && !!(await prisma.task.findUnique({ where: { id: foreignTask.id } })));

    // ===== Gmail: письмо по кнопке → ответ клиента находит переписку → наш ответ в ту же цепочку =====
    const { getMailAccount, saveMailAccount } = await import("../lib/leads/mail/account");
    const { sendOutreachEmail, sendReplyDraft } = await import("../lib/leads/mail/send");
    const { handleIncoming } = await import("../lib/leads/mail/inbox");
    const nodemailer = (await import("nodemailer")).default;
    const json = nodemailer.createTransport({ jsonTransport: true });
    const sentMail: Record<string, unknown>[] = [];
    // вместо SMTP Gmail: письмо собирается nodemailer'ом и остаётся у нас для проверки
    const spy = {
      sendMail: async (m: Parameters<typeof json.sendMail>[0]) => {
        const info = await json.sendMail(m);
        sentMail.push(JSON.parse(String(info.message)));
        return info;
      },
    } as unknown as import("nodemailer").Transporter;
    await saveMailAccount(ws.id, "studio.test@gmail.com", "abcdefghijklmnop", 0);
    const stored = await prisma.leadSettings.findUniqueOrThrow({ where: { workspaceId: ws.id } });
    check("Gmail: пароль приложения в базе зашифрован", stored.gmailPassword !== "abcdefghijklmnop" && (await getMailAccount(ws.id))?.pass === "abcdefghijklmnop");
    const gPrep = await call(leadOutreach.POST as Handler, "POST", `/api/leads/${lv.id}/outreach`, 1, { channel: "EMAIL" }, { id: lv.id });
    const gid: string = gPrep.json.outreach.id;
    check("Mini App: у черновика есть «📤 Отправить письмо» — с подключённой почты", gPrep.json.outreach.sendFrom === "studio.test@gmail.com", gPrep.json.outreach);
    process.env.MAIL_SMTP_HOST = "127.0.0.1"; // почта недоступна — соединение отклоняется
    const viaApp = await call(outreachOne.PATCH as Handler, "PATCH", `/api/leads/outreach/${gid}`, 1, { action: "send" }, { oid: gid });
    delete process.env.MAIL_SMTP_HOST;
    check(
      "Mini App: «Отправить» без связи с почтой — понятная ошибка, письмо остаётся черновиком",
      viaApp.status === 409 && String(viaApp.json.error).includes("Не достучался") && ["DRAFT", "READY"].includes((await prisma.outreach.findUniqueOrThrow({ where: { id: gid } })).status),
      viaApp.json
    );
    const sentFirst = await sendOutreachEmail(gid, ws.id, me.id, spy);
    const firstOut = await prisma.outreachMessage.findFirst({ where: { outreachId: gid, direction: "OUT" } });
    check(
      "📤 письмо ушло через Gmail: «Отправлено», Message-ID для поиска ответа сохранён",
      sentFirst.ok && (await prisma.outreach.findUniqueOrThrow({ where: { id: gid } })).status === "SENT" && !!firstOut?.messageId && JSON.stringify(sentMail[0]).includes("info@lavka-barber.ru"),
      [sentFirst, sentMail[0]]
    );
    const sentTwice = await sendOutreachEmail(gid, ws.id, me.id, spy);
    check("повторное нажатие не отправляет письмо второй раз", !sentTwice.ok && sentMail.length === 1);

    const base = { references: [] as string[], subject: "Re: Сайт", date: new Date(), auto: false, bounce: false, failedRecipients: [] as string[] };
    const ev1 = await handleIncoming(ws.id, {
      ...base,
      uid: 1,
      messageId: "<r1@lavka-barber.ru>",
      inReplyTo: firstOut!.messageId,
      from: "info@lavka-barber.ru",
      text: "Добрый день! Интересно, сколько стоит?\n\nпн, 20 окт. 2026 г. в 12:00, Studio <studio.test@gmail.com>:\n> Добрый день!",
    });
    check(
      "📩 ответ клиента: нашёл переписку, без цитаты, «Ответ получен», лид «Переговоры»",
      ev1?.kind === "reply" && ev1.message.body === "Добрый день! Интересно, сколько стоит?" && (await prisma.outreach.findUniqueOrThrow({ where: { id: gid } })).status === "REPLIED" && (await prisma.lead.findUniqueOrThrow({ where: { id: lv.id } })).status === "NEGOTIATION",
      ev1
    );
    const dupIn = await handleIncoming(ws.id, { ...base, uid: 1, messageId: "<r1@lavka-barber.ru>", inReplyTo: firstOut!.messageId, from: "info@lavka-barber.ru", text: "Добрый день!" });
    const byAddress = await handleIncoming(ws.id, { ...base, uid: 2, messageId: "<r2@lavka-barber.ru>", inReplyTo: null, from: "info@lavka-barber.ru", text: "И ещё: а сроки?" });
    const strangerMail = await handleIncoming(ws.id, { ...base, uid: 3, messageId: "<ad@spam.example>", inReplyTo: null, from: "promo@spam.example", text: "Скидки!" });
    check("то же письмо второй раз не разбирается; без заголовков — по адресу; чужое — мимо", dupIn === null && byAddress?.kind === "reply" && byAddress.outreach.id === gid && strangerMail === null);

    const draft = await prisma.outreachMessage.create({ data: { outreachId: gid, direction: "OUT", subject: "Re: Сайт", body: "Спасибо! Лендинг — от 30 000 ₽, 7–10 дней." } });
    const sentReply = await sendReplyDraft(draft.id, ws.id, me.id, spy);
    const replyMail = sentMail[1] ?? {};
    check(
      "📤 ответ ушёл в ту же переписку: In-Reply-To — последнее письмо клиента, References — вся цепочка",
      sentReply.ok && replyMail.inReplyTo === "<r2@lavka-barber.ru>" && JSON.stringify(replyMail.references).includes(firstOut!.messageId!) && !!(await prisma.outreachMessage.findUniqueOrThrow({ where: { id: draft.id } })).sentAt,
      replyMail
    );

    const bounced = await handleIncoming(ws.id, { ...base, uid: 4, messageId: "<dsn@googlemail.com>", inReplyTo: null, references: [firstOut!.messageId!], from: "mailer-daemon@googlemail.com", text: "Address not found", bounce: true, failedRecipients: ["info@lavka-barber.ru"] });
    check("недоставка: адрес отмечен 🔴", bounced?.kind === "bounce" && (await prisma.leadContact.findFirstOrThrow({ where: { leadId: lv.id, value: "info@lavka-barber.ru" } })).verification === "INVALID", bounced);

    const other = await prisma.workspace.create({ data: {} });
    const foreign = await prisma.lead.create({ data: { workspaceId: other.id, name: "Чужой", normName: "чужой", city: "Москва", niche: "x", sources: [] } });
    const f = await call(lead.GET as Handler, "GET", `/api/leads/${foreign.id}`, 1, undefined, { id: foreign.id });
    check("чужой лид из другого пространства → 404", f.status === 404);
  } catch (err) {
    check("сценарий выполнен без исключений", false, (err as Error).stack ?? String(err));
  } finally {
    await sources.close();
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
