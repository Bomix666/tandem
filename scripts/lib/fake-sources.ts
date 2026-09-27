// Подделки внешних источников для тестов и локальной разработки:
// Яндекс «API Поиска по организациям», OSM (Nominatim + Overpass) и сайты
// бизнесов. Используются в scripts/leads-e2e.ts (бот), scripts/leads-api-e2e.ts
// (API приложения) и scripts/dev-fake-sources.ts (ручная проверка интерфейса).

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_YANDEX_KEY = "e2e-yandex-key";

export interface FakeSourcesState {
  yandexMode: "ok" | "403";
  osmMode: "ok" | "500";
}

interface FakeOrg {
  id: string;
  name: string;
  addr: string;
  ll: [number, number];
  phones: string[];
  url?: string;
  hours?: string;
}

// Второй адрес для поддельных сайтов: разные хосты — как у настоящих разных
// бизнесов (иначе защита от дублей справедливо склеит их по домену).
let altSitePort = 0;

/** Сервер сайтов на 127.0.0.3 — вызвать один раз до поиска. */
export async function startAltSiteServer(state: FakeSourcesState) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.3");
    if (!handleFakeSource(url, res, 0, state)) res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.3", r));
  altSitePort = (server.address() as AddressInfo).port;
  return { close: () => new Promise<void>((r) => server.close(() => r())) };
}

function moscow(port: number): FakeOrg[] {
  const site = (p: string, alt = false) => (alt ? `http://127.0.0.3:${altSitePort}/site/${p}` : `http://127.0.0.1:${port}/site/${p}`);
  return [
    { id: "m1", name: "Black Barber", addr: "Россия, Москва, Тверская улица, 7", ll: [37.61, 55.76], phones: ["+7 (495) 111-11-01"], hours: "ежедневно, 10:00–22:00" },
    { id: "m2", name: "Barber Chain", addr: "Россия, Москва, улица Арбат, 1", ll: [37.59, 55.75], phones: ["+7 (495) 111-11-02"] },
    { id: "m3", name: "Barber Chain", addr: "Россия, Москва, улица Покровка, 2", ll: [37.64, 55.758], phones: ["+7 (495) 111-11-03"] },
    { id: "m4", name: "Barber Chain", addr: "Россия, Москва, Мясницкая улица, 3", ll: [37.635, 55.765], phones: ["+7 (495) 111-11-04"] },
    { id: "m5", name: "Ghost Barber", addr: "Россия, Москва, улица Сретенка, 5", ll: [37.63, 55.77], phones: [] },
    { id: "m6", name: "Insta Cuts", addr: "Россия, Москва, Пятницкая улица, 6", ll: [37.628, 55.74], phones: ["+7 (495) 111-11-06"], url: "https://instagram.com/instacuts" },
    { id: "m7", name: "Yclients Barber", addr: "Россия, Москва, Никольская улица, 7", ll: [37.622, 55.757], phones: ["+7 (495) 111-11-07"], url: "https://n1.yclients.com/company/7" },
    { id: "m8", name: "Old School Barber", addr: "Россия, Москва, Малая Бронная улица, 8", ll: [37.6, 55.762], phones: ["+7 (495) 111-11-08"], url: site("old") },
    { id: "m9", name: "Modern Barber", addr: "Россия, Москва, Садовая улица, 9", ll: [37.62, 55.77], phones: ["+7 (495) 111-11-09"], url: site("modern", true) },
    { id: "m10", name: "Down Barber", addr: "Россия, Москва, Лесная улица, 10", ll: [37.59, 55.78], phones: ["+7 (495) 111-11-10"], url: "http://127.0.0.2:1/" },
  ];
}

const KAZAN: FakeOrg[] = [
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

function yandexResponse(port: number, text: string, skip: number) {
  const orgs = text.includes("Казань") ? KAZAN : text.includes("Москва") ? moscow(port) : [];
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

/** Обрабатывает запрос к поддельному источнику; false — путь не наш. */
export function handleFakeSource(url: URL, res: ServerResponse, port: number, state: FakeSourcesState): boolean {
  const json = (status: number, data: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (url.pathname.startsWith("/yandex/")) {
    if (state.yandexMode === "403" || url.searchParams.get("apikey") !== FAKE_YANDEX_KEY) json(403, { message: "Invalid key" });
    else json(200, yandexResponse(port, url.searchParams.get("text") ?? "", Number(url.searchParams.get("skip") ?? 0)));
    return true;
  }
  if (url.pathname === "/nominatim/search") {
    json(200, [{ boundingbox: ["55.1", "56.1", "36.8", "49.5"] }]);
    return true;
  }
  if (url.pathname === "/overpass") {
    if (state.osmMode === "500") json(500, { error: "overloaded" });
    else json(200, OVERPASS);
    return true;
  }
  if (url.pathname === "/site/old" || url.pathname === "/site/modern") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(url.pathname === "/site/old" ? OLD_SITE : MODERN_SITE);
    return true;
  }
  return false;
}

/** Переменные окружения, направляющие модуль лидов на подделки. */
export function fakeSourcesEnv(port: number, withYandex = true): Record<string, string> {
  return {
    YANDEX_PLACES_API_KEY: withYandex ? FAKE_YANDEX_KEY : "",
    YANDEX_PLACES_API_URL: `http://127.0.0.1:${port}/yandex/v1/`,
    OVERPASS_API_URL: `http://127.0.0.1:${port}/overpass`,
    NOMINATIM_URL: `http://127.0.0.1:${port}/nominatim`,
    YANDEX_RETRY_DELAY_MS: "0", // в тестах повторы без пауз
    YANDEX_PAGE_CACHE_MS: "0", // в тестах кеш страниц выключен — каждый сценарий бьёт по фейковому серверу
    LEADS_ALLOW_PRIVATE_URLS: "true",
    LEADS_OSM_ENABLED: "true",
  };
}

/** Отдельный сервер только с источниками (для теста API и ручной проверки интерфейса). */
export async function startFakeSourcesServer(listenPort = 0) {
  const state: FakeSourcesState = { yandexMode: "ok", osmMode: "ok" };
  let port = 0;
  // FAKE_SOURCES_DELAY_MS — искусственная задержка ответов, чтобы увидеть прогресс поиска в интерфейсе
  const delay = Number(process.env.FAKE_SOURCES_DELAY_MS ?? 0);
  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    setTimeout(() => {
      if (!handleFakeSource(url, res, port, state)) res.writeHead(404).end();
    }, delay);
  });
  await new Promise<void>((r) => server.listen(listenPort, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  const alt = await startAltSiteServer(state);
  return {
    port,
    state,
    close: async () => {
      await alt.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
