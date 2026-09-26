import { describe, expect, it } from "vitest";
import { decodeHtml, isPrivateIp } from "../http";
import { analyzeHtml, findCopyrightYear, isBotProtection, unreachableReason } from "../site-audit";
import { NOW } from "./helpers";

const OLD_SITE = `<html><head><title>Барбершоп</title><script src="//s1.ucoz.net/x.js"></script></head>
<body><center><font size=3>Добро пожаловать</font><font>Услуги</font><font>Цены</font></center>
<a href="mailto:info@oldbarber.ru">info@oldbarber.ru</a>
<a href="mailto:dev@webstudio-site.ru">Разработка сайта</a>
<a href="https://vk.com/oldbarber">Мы ВКонтакте</a>
<a href="tel:+74951112233">+7 495 111-22-33</a>
<p>© 2015 Old Barber</p></body></html>`;

const MODERN_SITE = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://static.tildacdn.com/css/tilda.css"></head>
<body><a href="https://instagram.com/modernbarber">Instagram</a>
<a href="https://vk.com/share.php?url=https://modernbarber.ru">Поделиться</a>
<form><input type="tel" name="phone"><button>Записаться</button></form>
<footer>© 2020–2026 Modern Barber · hello@modernbarber.ru · support@tilda.cc</footer></body></html>`;

describe("analyzeHtml", () => {
  it("старый сайт: нет адаптива, старый год, устаревшая вёрстка", () => {
    const r = analyzeHtml(OLD_SITE, "http://oldbarber.ru/", NOW);
    expect(r.hasViewport).toBe(false);
    expect(r.https).toBe(false);
    expect(r.hasForm).toBe(false);
    expect(r.copyrightYear).toBe(2015);
    expect(r.platform).toBe("uCoz");
    expect(r.outdated).toEqual(expect.arrayContaining(["теги <font>", "платформа uCoz"]));
    expect(r.hasCta).toBe(true); // tel:-ссылка
  });

  it("берёт только email самой компании, соцсети и телефоны", () => {
    const r = analyzeHtml(OLD_SITE, "http://oldbarber.ru/", NOW);
    expect(r.emails).toEqual(["info@oldbarber.ru"]); // почта веб-студии не подходит
    expect(r.socials).toEqual([{ type: "vk", url: "https://vk.com/oldbarber" }]);
    expect(r.phones).toEqual(["74951112233"]);
  });

  it("современный сайт: адаптив, HTTPS, форма, призыв, свежий год", () => {
    const r = analyzeHtml(MODERN_SITE, "https://modernbarber.ru/", NOW);
    expect(r).toMatchObject({ hasViewport: true, https: true, hasForm: true, hasCta: true, copyrightYear: 2026, platform: "Tilda" });
    expect(r.outdated).toEqual([]);
    expect(r.socials).toEqual([{ type: "instagram", url: "https://instagram.com/modernbarber" }]); // share-ссылка не соцсеть
    expect(r.emails).toEqual(["hello@modernbarber.ru"]);
  });

  it("находит виджет онлайн-записи", () => {
    const r = analyzeHtml('<script src="https://w123.yclients.com/widgetJS"></script>', "https://a.ru/", NOW);
    expect(r.bookingWidget).toBe("YCLIENTS");
  });
});

describe("findCopyrightYear", () => {
  it("берёт последний год диапазона и игнорирует будущие годы", () => {
    expect(findCopyrightYear("© 2019–2023 Компания", NOW)).toBe(2023);
    expect(findCopyrightYear("&copy; 2018", NOW)).toBe(2018);
    expect(findCopyrightYear("© 2030", NOW)).toBeNull();
    expect(findCopyrightYear("без копирайта", NOW)).toBeNull();
  });
});

describe("защита от ботов ≠ «сайт не открывается»", () => {
  it("403/401/429 и заглушки Cloudflare/DDoS-Guard — «не удалось проверить»", () => {
    expect(isBotProtection(403, "cloudflare")).toBe(true);
    expect(isBotProtection(429, "")).toBe(true);
    expect(isBotProtection(503, "ddos-guard")).toBe(true);
  });
  it("настоящие ошибки сервера — факт, что сайт не работает", () => {
    expect(isBotProtection(500, "nginx")).toBe(false);
    expect(isBotProtection(503, "nginx")).toBe(false);
    expect(isBotProtection(404, "")).toBe(false);
  });
  it("понятные причины недоступности", () => {
    expect(unreachableReason("ENOTFOUND")).toBe("домен не найден");
    expect(unreachableReason("CERT_HAS_EXPIRED")).toBe("ошибка SSL-сертификата");
    expect(unreachableReason("timeout")).toBe("не ответил за 10 с");
  });
});

describe("decodeHtml", () => {
  it("читает сайты в windows-1251", () => {
    const body = Buffer.concat([
      Buffer.from('<meta charset="windows-1251"><p>'),
      Buffer.from([0xc7, 0xe0, 0xef, 0xe8, 0xf1, 0xfc]), // «Запись» в cp1251
      Buffer.from("</p>"),
    ]);
    expect(decodeHtml(body, "text/html")).toContain("Запись");
  });
});

describe("isPrivateIp (защита от запросов во внутреннюю сеть)", () => {
  it.each(["127.0.0.1", "10.0.0.5", "172.20.1.1", "192.168.1.1", "169.254.1.1", "::1", "::ffff:10.0.0.1"])("%s — внутренний", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "77.88.55.60"])("%s — публичный", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});
