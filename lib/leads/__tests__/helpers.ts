import type { Lead } from "@prisma/client";
import type { BusinessCandidate, LeadDraft, SiteAudit } from "../types";

export const NOW = new Date("2026-09-26T12:00:00Z");

export function makeDraft(overrides: Partial<LeadDraft> = {}): LeadDraft {
  return {
    name: "Black Barber",
    normName: "black barber",
    city: "Москва",
    niche: "Барбершопы",
    category: "Барбершоп",
    address: "Россия, Москва, Тверская улица, 7",
    normAddress: "7 тверская ул",
    lat: 55.76,
    lon: 37.61,
    websiteKind: "none",
    socials: [],
    phones: [],
    normPhones: [],
    emails: [],
    sources: [{ provider: "yandex", url: "https://yandex.ru/maps/org/1/" }],
    confirmedByOsm: false,
    chainSize: 1,
    nicheMatch: true,
    ...overrides,
  };
}

export function makeAudit(overrides: Partial<SiteAudit> = {}): SiteAudit {
  return {
    url: "https://example-barber.ru/",
    checkedAt: NOW.toISOString(),
    status: "ok",
    httpStatus: 200,
    finalUrl: "https://example-barber.ru/",
    https: true,
    hasViewport: true,
    hasForm: true,
    bookingWidget: null,
    hasCta: true,
    copyrightYear: 2026,
    platform: "Tilda",
    outdated: [],
    emails: [],
    socials: [],
    phones: [],
    ...overrides,
  };
}

export function makeCandidate(overrides: Partial<BusinessCandidate> = {}): BusinessCandidate {
  return {
    provider: "yandex",
    externalId: "1001",
    name: "Black Barber",
    categories: ["Барбершоп"],
    address: "Россия, Москва, Тверская улица, 7",
    lat: 55.76,
    lon: 37.61,
    phones: ["+7 (495) 111-22-33"],
    emails: [],
    socials: [],
    hours: "ежедневно, 10:00–22:00",
    sourceUrl: "https://yandex.ru/maps/org/1001/",
    ...overrides,
  };
}

/** Строка таблицы Lead для тестов функций, работающих с данными из БД. */
export function makeLeadRow(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead1",
    workspaceId: "ws1",
    name: "Black Barber",
    normName: "black barber",
    city: "Москва",
    niche: "Барбершопы",
    category: "Барбершоп",
    address: "Россия, Москва, Тверская улица, 7",
    normAddress: "7 тверская ул",
    lat: 55.76,
    lon: 37.61,
    websiteKind: "none",
    website: null,
    domain: null,
    bookingPage: null,
    phones: ["+7 495 111-22-33"],
    normPhones: ["74951112233"],
    emails: [],
    socials: [{ type: "instagram", url: "https://instagram.com/blackbarber" }],
    hours: "ежедневно, 10:00–22:00",
    yandexId: "1001",
    osmId: null,
    sources: [{ provider: "yandex", url: "https://yandex.ru/maps/org/1001/" }],
    chainSize: 1,
    nicheMatch: true,
    siteAudit: null,
    score: 84,
    scoreReasons: [
      { label: "сайт не указан в Яндекс Картах", points: 40 },
      { label: "есть публичный телефон", points: 10 },
    ],
    potential: "HIGH",
    offer: "Одностраничный сайт: услуги и цены, мастера, фото работ, карта, кнопка записи, адаптация под телефон.",
    status: "NEW",
    statusChangedAt: NOW,
    saved: false,
    proposal: null,
    createdById: "user1",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Lead;
}
