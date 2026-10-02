import { describe, expect, it } from "vitest";
import { addEmailContacts, bestCheck, enrichContacts, usableEmails, type EmailContact } from "../contacts";
import { decodeCfEmail, extractEmails, findContactPages } from "../contacts/extract";
import { brandTokens, classifyEmail, looksPersonal } from "../contacts/policy";
import { verifyEmail, type MxStatus } from "../contacts/verify";
import { makeAudit, makeDraft } from "./helpers";

const accept = (email: string, name: string, siteDomain?: string) => classifyEmail(email, { name, siteDomain }).accept;

describe("извлечение email", () => {
  it("mailto, текст, маскировка [at]/(dot), без дублей и картинок", () => {
    const html = `<a href="mailto:Info@Salon.ru?subject=Запись">написать</a>
      <p>Почта: sales@salon.ru, заказы: zakaz [at] salon [dot] ru</p>
      <img src="/logo@2x.png"><script>var x = "tracker@sentry.io"</script>`;
    expect(extractEmails(html).sort()).toEqual(["info@salon.ru", "sales@salon.ru", "tracker@sentry.io", "zakaz@salon.ru"]);
  });

  it("защита email от Cloudflare раскодируется", () => {
    // ключ 0x12, адрес a@b.ru
    const hex = "12" + [..."a@b.ru"].map((c) => (c.charCodeAt(0) ^ 0x12).toString(16).padStart(2, "0")).join("");
    expect(decodeCfEmail(hex)).toBe("a@b.ru");
    expect(extractEmails(`<a href="/cdn-cgi/l/email-protection#${hex}">[email protected]</a>`)).toEqual(["a@b.ru"]);
  });

  it("закодированный пробел в mailto (%20info@) не превращается в «20info@»", () => {
    expect(extractEmails('<a href="mailto:%20info@clinic.ru">x</a>')).toEqual(["info@clinic.ru"]);
  });

  it("страницы контактов — только того же сайта, по пути и по тексту ссылки", () => {
    const html = `<a href="/kontakty">Где мы</a><a href="https://vk.com/contacts">VK</a><a href="/about-us/">О нас</a><a href="/price">Цены</a>`;
    expect(findContactPages(html, "https://site.ru/")).toEqual(["https://site.ru/kontakty", "https://site.ru/about-us/"]);
  });
});

describe("правила: только публичные адреса бизнеса", () => {
  it("домен сайта компании — общие ящики и любые не личные адреса", () => {
    expect(classifyEmail("info@salon.ru", { name: "Салон Лилия", siteDomain: "salon.ru" })).toMatchObject({ accept: true, role: "info", companyDomain: true });
    expect(classifyEmail("request@salon.ru", { name: "Салон Лилия", siteDomain: "www.salon.ru" })).toMatchObject({ accept: true, role: "company" });
    expect(accept("admin@salon.ru", "Салон", "salon.ru")).toBe(true); // не «фамилия» на -in
  });

  it("личные адреса не сохраняем — даже на домене компании", () => {
    for (const e of ["anna.smirnova@salon.ru", "i.ivanov@salon.ru", "smirnova@salon.ru", "ivan_petrov@gmail.com", "olga@salon.ru"]) {
      expect(accept(e, "Салон Лилия", "salon.ru"), e).toBe(false);
    }
    expect(looksPersonal("marketing")).toBe(false);
  });

  it("бесплатная почта — только с названием бизнеса", () => {
    expect(classifyEmail("blackbarber@gmail.com", { name: "Black Barber" })).toMatchObject({ accept: true, role: "brand", freeMail: true });
    expect(accept("stomflagman@mail.ru", "ФлагманСтом")).toBe(true); // части названия переставлены
    expect(accept("smilestomatolog@mail.ru", "Улыбнись", "smilestomatology.ru")).toBe(true); // совпадает с доменом сайта
    expect(accept("barber777@gmail.com", "Black Barber")).toBe(false); // «barber» — общее слово, не название
    expect(accept("super.master@mail.ru", "Салон Лилия")).toBe(false);
  });

  it("чужой домен — только если это домен с названием бизнеса", () => {
    expect(accept("info@webstudio-site.ru", "Old Barber", "oldbarber.ru")).toBe(false); // почта разработчика сайта
    expect(accept("info@lavka-barber.ru", "Lavka Barber")).toBe(true);
    expect(accept("noreply@lavka-barber.ru", "Lavka Barber")).toBe(false);
  });

  it("служебные и шаблонные адреса", () => {
    for (const e of ["example@example.com", "noreply@salon.ru", "user@domain.com", "abuse@salon.ru"]) {
      expect(accept(e, "Салон", "salon.ru"), e).toBe(false);
    }
  });

  it("отличительные слова названия без общих («барбершоп», «салон»)", () => {
    expect(brandTokens("Барбершоп Woodoo")).toEqual(["voodoo", "barbershopvoodoo"]); // «скелет»: w → v, как в транслите
  });
});

describe("проверка email без отправки писем", () => {
  const dns = (map: Record<string, MxStatus>) => async (d: string) => map[d] ?? "dns_error";

  it("🟢 домен сайта с MX, 🟡 бесплатная почта / другой домен / DNS молчит, 🔴 домена нет", async () => {
    const r = dns({ "salon.ru": "mx", "gmail.com": "mx", "other.ru": "mx", "dead.ru": "nxdomain", "nomail.ru": "no_mail" });
    expect((await verifyEmail("info@salon.ru", "salon.ru", r)).check).toBe("VALID");
    expect((await verifyEmail("salon@gmail.com", "salon.ru", r)).check).toBe("UNVERIFIED");
    expect((await verifyEmail("info@other.ru", "salon.ru", r)).check).toBe("UNVERIFIED");
    expect((await verifyEmail("info@slow.ru", undefined, r)).note).toContain("DNS не ответил");
    expect((await verifyEmail("info@dead.ru", undefined, r)).check).toBe("INVALID");
    expect((await verifyEmail("info@nomail.ru", undefined, r)).check).toBe("INVALID");
    expect((await verifyEmail("bad@@x", undefined, r)).check).toBe("INVALID");
  });
});

describe("email лида: от источника до проверки", () => {
  it("адреса из OSM проходят правила; Lead.emails — лучшие пригодные", () => {
    const d = makeDraft({ name: "Black Barber" });
    const skipped = addEmailContacts(d, ["Hello@BlackBarber.ru", "ivan.petrov@mail.ru"], "osm", "https://osm.org/node/1");
    expect(skipped).toBe(1);
    expect(d.contacts).toEqual([{ value: "hello@blackbarber.ru", source: "osm", sourceUrl: "https://osm.org/node/1", role: "hello" }]);
    expect(d.emails).toEqual(["hello@blackbarber.ru"]);
  });

  it("на главной нет — ищет на странице контактов; 🟢 при совпадении домена", async () => {
    const d = makeDraft({ name: "Салон Лилия", websiteKind: "own", website: "https://salon.ru/", domain: "salon.ru" });
    d.audit = makeAudit({ url: "https://salon.ru/", finalUrl: "https://salon.ru/", contactPages: ["https://salon.ru/kontakty"] });
    const fetched: string[] = [];
    await enrichContacts(d, {
      fetchPage: async (url) => {
        fetched.push(url);
        return { html: '<p>Пишите: <a href="mailto:info@salon.ru">info@salon.ru</a>, директор: a.petrova@salon.ru</p>', finalUrl: url };
      },
      resolveMx: async () => "mx",
    });
    expect(fetched).toEqual(["https://salon.ru/kontakty"]);
    expect(d.contacts).toMatchObject([{ value: "info@salon.ru", source: "site", sourceUrl: "https://salon.ru/kontakty", check: "VALID" }]);
    expect(bestCheck(d.contacts)).toBe("VALID");
  });

  it("сайт не открылся — страницы не ищем, но адреса из источника проверяем", async () => {
    const d = makeDraft({ name: "Black Barber", websiteKind: "own", website: "https://bb.ru/", domain: "bb.ru" });
    d.audit = makeAudit({ status: "blocked" });
    addEmailContacts(d, ["blackbarber@gmail.com"], "osm");
    let fetched = 0;
    await enrichContacts(d, { fetchPage: async () => (fetched++, null), resolveMx: async () => "mx" });
    expect(fetched).toBe(0);
    expect(d.contacts?.[0]?.check).toBe("UNVERIFIED");
  });

  it("🔴 не попадает в Lead.emails, 🟢 идёт первым", () => {
    const c = (value: string, check: EmailContact["check"]): EmailContact => ({ value, source: "site", role: "info", check });
    expect(usableEmails([c("a@x.ru", "UNVERIFIED"), c("b@x.ru", "INVALID"), c("c@x.ru", "VALID")])).toEqual(["c@x.ru", "a@x.ru"]);
  });
});
