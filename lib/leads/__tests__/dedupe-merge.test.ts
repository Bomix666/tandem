import { describe, expect, it } from "vitest";
import { isSameBusiness, LeadIndex, rejectKey } from "../dedupe";
import { applyAudit, candidateToDraft, enrichWithOsm, findOsmMatch, mergeDraftInto } from "../merge";
import { resolveNiche } from "../niches";
import { makeAudit, makeCandidate, makeDraft } from "./helpers";

const ctx = { city: "Москва", niche: resolveNiche("Барбершопы") };

describe("защита от дублей", () => {
  const base = { normPhones: [] as string[], normName: "black barber" };

  it("узнаёт бизнес по id источника, домену и телефону", () => {
    expect(isSameBusiness({ ...base, yandexId: "1" }, { ...base, normName: "другое", yandexId: "1" })).toBe(true);
    expect(isSameBusiness({ ...base, domain: "bb.ru" }, { ...base, normName: "другое", domain: "bb.ru" })).toBe(true);
    expect(isSameBusiness({ ...base, normPhones: ["74951112233"] }, { ...base, normName: "другое", normPhones: ["74951112233"] })).toBe(true);
  });

  it("по названию — только вместе с адресом или координатами рядом", () => {
    expect(isSameBusiness({ ...base, normAddress: "7 тверская ул" }, { ...base, normAddress: "7 тверская ул" })).toBe(true);
    expect(isSameBusiness({ ...base, lat: 55.76, lon: 37.61 }, { ...base, lat: 55.7601, lon: 37.6101 })).toBe(true);
    // та же вывеска в другом районе — другой бизнес
    expect(isSameBusiness({ ...base, lat: 55.76, lon: 37.61 }, { ...base, lat: 55.6, lon: 37.5 })).toBe(false);
  });

  it("LeadIndex находит существующий лид", () => {
    const index = new LeadIndex([{ id: "L1", yandexId: "1001", normPhones: [], normName: "x" }]);
    expect(index.find(makeDraft({ yandexId: "1001" }))?.id).toBe("L1");
    expect(index.find(makeDraft({ yandexId: "999", lat: undefined, lon: undefined, normAddress: undefined }))).toBeNull();
  });

  it("ключ отклонённого кандидата стабилен", () => {
    expect(rejectKey(makeDraft({ yandexId: "5" }))).toBe("y:5");
    expect(rejectKey(makeDraft({ osmId: "node/1" }))).toBe("o:node/1");
  });
});

describe("candidateToDraft", () => {
  it("соцсеть в поле «сайт» — это не собственный сайт", () => {
    const d = candidateToDraft(makeCandidate({ websiteRaw: "https://instagram.com/blackbarber" }), ctx);
    expect(d.websiteKind).toBe("social");
    expect(d.website).toBeUndefined();
    expect(d.socials[0]).toEqual({ type: "instagram", url: "https://instagram.com/blackbarber" });
  });
  it("страница YCLIENTS — «запись вместо сайта»", () => {
    const d = candidateToDraft(makeCandidate({ websiteRaw: "https://n1.yclients.com/company/7" }), ctx);
    expect(d.websiteKind).toBe("booking");
    expect(d.bookingPage?.name).toBe("YCLIENTS");
  });
  it("нормализует телефоны и проверяет нишу", () => {
    const d = candidateToDraft(makeCandidate(), ctx);
    expect(d.normPhones).toEqual(["74951112233"]);
    expect(d.phones).toEqual(["+7 495 111-22-33"]);
    expect(d.nicheMatch).toBe(true);
  });
});

describe("сверка с OSM", () => {
  const osm = [
    makeCandidate({ provider: "osm", externalId: "node/1", name: "Барбершоп Black Barber", lat: 55.7601, lon: 37.6102, phones: [], emails: ["hi@blackbarber.ru"], socials: [{ type: "vk", url: "https://vk.com/bb" }], sourceUrl: "https://www.openstreetmap.org/node/1" }),
    makeCandidate({ provider: "osm", externalId: "node/2", name: "Black Barber", lat: 55.9, lon: 37.9, phones: [] }),
  ];

  it("находит тот же бизнес рядом и дополняет недостающее", () => {
    const d = candidateToDraft(makeCandidate(), ctx);
    const match = findOsmMatch(d, osm, new Set());
    expect(match?.externalId).toBe("node/1");
    enrichWithOsm(d, match!, "Москва");
    expect(d.confirmedByOsm).toBe(true);
    expect(d.emails).toEqual(["hi@blackbarber.ru"]);
    expect(d.socials).toEqual([{ type: "vk", url: "https://vk.com/bb" }]);
    expect(d.phones).toEqual(["+7 495 111-22-33"]); // своё не перезаписано
    expect(d.sources.map((s) => s.provider)).toEqual(["yandex", "osm"]);
  });

  it("одноимённая точка далеко — не совпадение", () => {
    const d = candidateToDraft(makeCandidate({ lat: 55.9005, lon: 37.9005, name: "Совсем другое" }), ctx);
    expect(findOsmMatch(d, [osm[0]!], new Set())).toBeNull();
  });
});

describe("applyAudit / mergeDraftInto", () => {
  it("контакты с сайта компании добавляются к лиду", () => {
    const d = makeDraft({ websiteKind: "own", domain: "bb.ru" });
    applyAudit(d, makeAudit({ emails: ["info@bb.ru"], socials: [{ type: "telegram", url: "https://t.me/bb" }], phones: ["74951112233"] }));
    expect(d.emails).toEqual(["info@bb.ru"]);
    expect(d.socials).toEqual([{ type: "telegram", url: "https://t.me/bb" }]);
    expect(d.normPhones).toEqual(["74951112233"]);
  });

  it("не открывшийся сайт контактов не добавляет", () => {
    const d = makeDraft();
    applyAudit(d, makeAudit({ status: "unreachable", emails: ["x@y.ru"] }));
    expect(d.emails).toEqual([]);
  });

  it("дубль дополняет существующий лид, не перезаписывая заполненное", () => {
    const base = makeDraft({ phones: ["+7 495 111-22-33"], normPhones: ["74951112233"], emails: [], hours: "старый режим" });
    const fresh = makeDraft({
      phones: ["+7 495 999-88-77"],
      normPhones: ["74959998877"],
      emails: ["new@bb.ru"],
      hours: "новый режим",
      websiteKind: "own",
      website: "https://bb.ru/",
      domain: "bb.ru",
      sources: [{ provider: "osm", url: "o" }],
    });
    const m = mergeDraftInto(base, fresh);
    expect(m.normPhones).toEqual(["74951112233", "74959998877"]);
    expect(m.emails).toEqual(["new@bb.ru"]);
    expect(m.hours).toBe("старый режим");
    expect(m.websiteKind).toBe("own");
    expect(m.sources.map((s) => s.provider)).toEqual(["yandex", "osm"]);
  });
});
