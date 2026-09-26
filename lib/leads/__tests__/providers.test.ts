import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveNiche } from "../niches";
import { buildOverpassQuery, parseOverpass } from "../providers/osm";
import { parseYandexResponse, ProviderError, searchYandex } from "../providers/yandex";

describe("parseYandexResponse", () => {
  it("разбирает организации по документированному формату", () => {
    const { items, found } = parseYandexResponse({
      properties: { ResponseMetaData: { SearchResponse: { found: 120 } } },
      features: [
        {
          geometry: { coordinates: [37.61, 55.76] },
          properties: {
            name: "Black Barber",
            CompanyMetaData: {
              id: "1001",
              name: "Black Barber",
              address: "Россия, Москва, Тверская улица, 7",
              url: "https://instagram.com/blackbarber",
              Phones: [
                { type: "phone", formatted: "+7 (495) 111-22-33" },
                { type: "fax", formatted: "+7 (495) 000-00-00" },
              ],
              Categories: [{ class: "beauty", name: "Барбершоп" }],
              Hours: { text: "ежедневно, 10:00–22:00" },
            },
          },
        },
        { properties: { name: "Без id", CompanyMetaData: { name: "Без id" } } },
      ],
    });
    expect(found).toBe(120);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      provider: "yandex",
      externalId: "1001",
      lat: 55.76, // coordinates в ответе — [долгота, широта]
      lon: 37.61,
      websiteRaw: "https://instagram.com/blackbarber",
      phones: ["+7 (495) 111-22-33"], // факс — не телефон для связи
      emails: [], // API не отдаёт email — не придумываем
      categories: ["Барбершоп"],
      sourceUrl: "https://yandex.ru/maps/org/1001/",
    });
  });
});

describe("parseOverpass", () => {
  it("разбирает теги OSM: контакты, соцсети, адрес, центр полигона", () => {
    const items = parseOverpass({
      elements: [
        {
          type: "way",
          id: 20,
          center: { lat: 55.7, lon: 37.6 },
          tags: {
            name: "Old Barber",
            shop: "hairdresser",
            "contact:phone": "+7 495 222-33-44; +7 495 222-33-55",
            "contact:email": "INFO@OLDBARBER.RU",
            "contact:instagram": "oldbarber",
            website: "http://oldbarber.ru",
            "addr:street": "Арбат",
            "addr:housenumber": "10",
            opening_hours: "Mo-Su 10:00-21:00",
          },
        },
        { type: "node", id: 5, lat: 55.1, lon: 37.1, tags: { shop: "hairdresser" } }, // без названия — пропускаем
        { type: "node", id: 3, lat: 55.2, lon: 37.2, tags: { name: "A", amenity: "dentist" } },
      ],
    });
    expect(items.map((i) => i.externalId)).toEqual(["node/3", "way/20"]); // стабильный порядок
    expect(items[1]).toMatchObject({
      name: "Old Barber",
      lat: 55.7,
      lon: 37.6,
      address: "Арбат, 10",
      categories: ["Парикмахерская"],
      phones: ["+7 495 222-33-44", "+7 495 222-33-55"],
      emails: ["info@oldbarber.ru"],
      socials: [{ type: "instagram", url: "https://instagram.com/oldbarber" }],
      sourceUrl: "https://www.openstreetmap.org/way/20",
    });
  });
});

describe("барбершоп ≠ любая парикмахерская", () => {
  it("OSM-теги hairdresser=barber / male=yes → категория «Барбершоп»", () => {
    const items = parseOverpass({
      elements: [
        { type: "node", id: 1, tags: { name: "Мужской зал", shop: "hairdresser", hairdresser: "barber" } },
        { type: "node", id: 2, tags: { name: "Салон Анна", shop: "hairdresser" } },
      ],
    });
    expect(items.map((i) => i.categories[0])).toEqual(["Барбершоп", "Парикмахерская"]);
  });
  it("обычная парикмахерская не засчитывается как совпадение с нишей «Барбершопы»", async () => {
    const { matchesNiche } = await import("../niches");
    const n = resolveNiche("Барбершопы");
    expect(matchesNiche(n, ["Парикмахерская"], "Салон Анна")).toBe(false);
    expect(matchesNiche(n, ["Парикмахерская"], "Barber Club")).toBe(true);
    expect(matchesNiche(n, ["Барбершоп"], "Топор")).toBe(true);
  });
});

describe("buildOverpassQuery", () => {
  it("готовая ниша — быстрый поиск по тегам внутри границ города", () => {
    const q = buildOverpassQuery(resolveNiche("Стоматологии"), [55.1, 36.8, 56.0, 37.9]);
    expect(q).toBe(
      '[out:json][timeout:60];(nwr["amenity"="dentist"]["name"](55.1,36.8,56,37.9);nwr["healthcare"="dentist"]["name"](55.1,36.8,56,37.9););out center tags 1500;'
    );
  });
  it("барбершопы — только мужские парикмахерские, а не все подряд", () => {
    const q = buildOverpassQuery(resolveNiche("барбершоп"), [1, 2, 3, 4]);
    expect(q).toContain('nwr["shop"="hairdresser"]["hairdresser"="barber"]["name"](1,2,3,4);');
    expect(q).toContain('nwr["shop"="hairdresser"]["male"="yes"]["name"](1,2,3,4);');
    expect(q).toContain('nwr["shop"="hairdresser"]["name"~"барбер|barber",i]["name"](1,2,3,4);');
    expect(q).not.toContain('nwr["shop"="hairdresser"]["name"](1,2,3,4);');
  });
  it("своя ниша — основа слова в названии, но только среди заведений", () => {
    const q = buildOverpassQuery(resolveNiche("Автомойки"), [1, 2, 3, 4]);
    expect(q).toContain('nwr["shop"]["name"~"автомой",i](1,2,3,4);');
    expect(q).toContain('nwr["amenity"]["name"~"автомой",i](1,2,3,4);');
    expect(q).not.toMatch(/nwr\["name"~/); // без перебора всех именованных объектов города
  });
});

describe("resolveNiche", () => {
  it("узнаёт пресеты по разным формам", () => {
    expect(resolveNiche("Барбершопы").key).toBe("barbershop");
    expect(resolveNiche("стоматологии").key).toBe("dentistry");
    expect(resolveNiche("Автомойки").key).toBe("custom");
  });
});

describe("searchYandex: повторы при сбоях", () => {
  const ok = { features: [{ geometry: { coordinates: [37.6, 55.7] }, properties: { CompanyMetaData: { id: "1", name: "Бизнес" } } }] };
  const reply = (status: number, body: unknown) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });

  beforeEach(() => {
    process.env.YANDEX_PLACES_API_KEY = "test-key";
    process.env.YANDEX_RETRY_DELAY_MS = "0";
    vi.spyOn(console, "error").mockImplementation(() => void 0);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.YANDEX_PLACES_API_KEY;
    delete process.env.YANDEX_RETRY_DELAY_MS;
  });

  it("разовый 403 не роняет поиск: второй запрос проходит", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(403, "Invalid api key")).mockResolvedValueOnce(reply(200, ok));
    vi.stubGlobal("fetch", fetchMock);
    const res = await searchYandex({ text: "кафе Москва", skip: 0 });
    expect(res.items.map((i) => i.name)).toEqual(["Бизнес"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("постоянный 403 → ошибка с ответом Яндекса (после 3 попыток)", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply(403, "Invalid api key"));
    vi.stubGlobal("fetch", fetchMock);
    const err = (await searchYandex({ text: "x", skip: 0 }).then(
      () => null,
      (e: unknown) => e
    )) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toContain("Яндекс отклонил ключ");
    expect(err.message).toContain("Invalid api key");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("ошибка клиента (400) не повторяется", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => reply(400, "Bad request"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchYandex({ text: "x", skip: 0 })).rejects.toBeInstanceOf(ProviderError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ключ не задан — сразу понятная ошибка, без запросов", async () => {
    delete process.env.YANDEX_PLACES_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(searchYandex({ text: "x", skip: 0 })).rejects.toThrow("не настроен");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
