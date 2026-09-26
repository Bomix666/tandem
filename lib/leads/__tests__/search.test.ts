import { describe, expect, it, vi } from "vitest";
import { LeadIndex } from "../dedupe";
import { resolveNiche } from "../niches";
import { NO_REQUIREMENTS, parseRequirements } from "../requirements";
import { runLeadSearch, SearchFailedError, SearchNotConfiguredError, type SearchDeps, type SearchInput } from "../search";
import type { BusinessCandidate, SiteAudit } from "../types";
import { makeAudit, makeCandidate, NOW } from "./helpers";

// Выдача «Яндекса»: разные ситуации с сайтом.
const YANDEX: BusinessCandidate[] = [
  makeCandidate({ externalId: "1", name: "Без сайта", phones: ["+7 495 000-00-01"], lat: 55.70, lon: 37.60 }),
  makeCandidate({ externalId: "2", name: "Инста Барбер", websiteRaw: "instagram.com/insta", phones: ["+7 495 000-00-02"], lat: 55.71, lon: 37.61 }),
  makeCandidate({ externalId: "3", name: "Старый Сайт", websiteRaw: "http://old.ru", phones: ["+7 495 000-00-03"], lat: 55.72, lon: 37.62 }),
  makeCandidate({ externalId: "4", name: "Модный Барбер", websiteRaw: "https://modern.ru", phones: ["+7 495 000-00-04"], lat: 55.73, lon: 37.63 }),
  makeCandidate({ externalId: "5", name: "Без контактов", phones: [], hours: undefined, lat: 55.74, lon: 37.64 }),
  makeCandidate({ externalId: "6", name: "Химки Барбер", address: "Россия, Московская область, Химки", phones: ["+7 495 000-00-06"] }),
];
const OSM: BusinessCandidate[] = [
  makeCandidate({ provider: "osm", externalId: "node/1", name: "Без сайта", lat: 55.7001, lon: 37.6001, phones: [], emails: ["hello@gmail.com"], sourceUrl: "osm1" }),
];
const AUDITS: Record<string, SiteAudit> = {
  "http://old.ru/": makeAudit({ url: "http://old.ru/", https: false, hasViewport: false, hasForm: false, copyrightYear: 2014 }),
  "https://modern.ru/": makeAudit({ url: "https://modern.ru/" }),
};

function input(overrides: Partial<SearchInput> = {}): SearchInput {
  return {
    niche: resolveNiche("Барбершопы"),
    city: "Москва",
    requested: 10,
    requirements: NO_REQUIREMENTS,
    osmOnly: false,
    offset: 0,
    excludeExisting: false,
    excludeKeys: new Set(),
    ...overrides,
  };
}

function deps(overrides: Partial<SearchDeps> = {}): SearchDeps {
  return {
    yandexConfigured: true,
    osmEnabled: true,
    yandex: async () => ({ items: YANDEX }),
    osm: async () => OSM,
    audit: async (url) => AUDITS[url] ?? makeAudit({ url, status: "unreachable", error: "timeout" }),
    index: new LeadIndex(),
    now: NOW,
    concurrency: 2,
    ...overrides,
  };
}

describe("runLeadSearch", () => {
  it("отбирает подходящие бизнесы и отсеивает неподходящие", async () => {
    const progress = vi.fn();
    const out = await runLeadSearch(input(), deps({ onProgress: progress }));
    const names = out.accepted.map((a) => a.draft.name);

    expect(names).toEqual(expect.arrayContaining(["Без сайта", "Инста Барбер", "Старый Сайт"]));
    expect(names).not.toContain("Модный Барбер"); // современный сайт
    expect(names).not.toContain("Без контактов"); // контакт не подтверждается
    expect(names).not.toContain("Химки Барбер"); // другой город
    expect(out.filtered).toBe(2);
    expect(out.sourceLabel).toBe("Яндекс Карты + OpenStreetMap");
    // по убыванию оценки
    const scores = out.accepted.map((a) => a.result.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    // прогресс для сообщения «Найдено / Проверено / Отфильтровано»
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ found: 3, checked: 5, filtered: 2 }));
  });

  it("дополняет лид данными OSM и не выдумывает email", async () => {
    const out = await runLeadSearch(input(), deps());
    const noSite = out.accepted.find((a) => a.draft.name === "Без сайта")!;
    expect(noSite.draft.confirmedByOsm).toBe(true);
    expect(noSite.draft.emails).toEqual(["hello@gmail.com"]);
    const insta = out.accepted.find((a) => a.draft.name === "Инста Барбер")!;
    expect(insta.draft.emails).toEqual([]);
  });

  it("не больше запрошенного количества", async () => {
    const out = await runLeadSearch(input({ requested: 2 }), deps());
    expect(out.accepted).toHaveLength(2);
  });

  it("OSM недоступен — предупреждение, поиск продолжается", async () => {
    const out = await runLeadSearch(input(), deps({ osm: async () => Promise.reject(new Error("503")) }));
    expect(out.warnings.join("\n")).toContain("Не удалось получить данные из OpenStreetMap");
    expect(out.accepted.length).toBeGreaterThan(0);
    expect(out.sourceLabel).toBe("Яндекс Карты");
  });

  it("Яндекс недоступен — продолжаем по OSM", async () => {
    const out = await runLeadSearch(input(), deps({ yandex: async () => Promise.reject(new Error("403")) }));
    expect(out.warnings[0]).toContain("Не удалось получить данные из Яндекса");
    expect(out.sourceLabel).toBe("OpenStreetMap");
    expect(out.accepted.map((a) => a.draft.name)).toEqual(["Без сайта"]);
  });

  it("оба источника недоступны — понятная ошибка, а не пустой результат", async () => {
    await expect(
      runLeadSearch(input(), deps({ yandex: async () => Promise.reject(new Error("x")), osm: async () => Promise.reject(new Error("y")) }))
    ).rejects.toBeInstanceOf(SearchFailedError);
  });

  it("Яндекс не настроен — ошибка «не настроено» (без симуляции)", async () => {
    await expect(runLeadSearch(input(), deps({ yandexConfigured: false }))).rejects.toBeInstanceOf(SearchNotConfiguredError);
  });

  it("режим «только OSM» работает без ключа Яндекса", async () => {
    const yandex = vi.fn();
    const out = await runLeadSearch(input({ osmOnly: true }), deps({ yandexConfigured: false, yandex }));
    expect(yandex).not.toHaveBeenCalled();
    expect(out.sourceLabel).toBe("OpenStreetMap");
  });

  it("«Найти ещё» пропускает бизнесы, которые уже есть в базе", async () => {
    const index = new LeadIndex([{ id: "L1", yandexId: "1", normPhones: [], normName: "без сайта" }]);
    const out = await runLeadSearch(input({ excludeExisting: true }), deps({ index }));
    expect(out.accepted.map((a) => a.draft.name)).not.toContain("Без сайта");
    expect(out.skippedKnown).toBe(1);
  });

  it("обычный поиск помечает дубль существующего лида, а не создаёт новый", async () => {
    const index = new LeadIndex([{ id: "L1", yandexId: "1", normPhones: [], normName: "без сайта" }]);
    const out = await runLeadSearch(input(), deps({ index }));
    expect(out.accepted.find((a) => a.draft.name === "Без сайта")?.existingId).toBe("L1");
  });

  it("«только без сайта» — сайты даже не проверяются", async () => {
    const audit = vi.fn();
    const out = await runLeadSearch(input({ requirements: parseRequirements("без сайта") }), deps({ audit }));
    expect(audit).not.toHaveBeenCalled();
    expect(out.accepted.every((a) => a.draft.websiteKind !== "own")).toBe(true);
  });

  it("отклонённые кандидаты попадают в список, чтобы «Найти ещё» их не перепроверял", async () => {
    const out = await runLeadSearch(input(), deps());
    expect(out.rejectedKeys).toEqual(expect.arrayContaining(["y:4", "y:5"]));
    const again = await runLeadSearch(input({ excludeKeys: new Set(out.rejectedKeys) }), deps());
    expect(again.filtered).toBe(0);
  });
});
