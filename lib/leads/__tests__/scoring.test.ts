import { describe, expect, it } from "vitest";
import { NO_REQUIREMENTS, parseRequirements, describeRequirements } from "../requirements";
import { isModernSite, scoreLead } from "../scoring";
import { makeAudit, makeDraft, NOW } from "./helpers";

const labels = (r: ReturnType<typeof scoreLead>) => r.reasons.map((x) => x.label);

describe("scoreLead", () => {
  it("активный бизнес без сайта — высокий потенциал", () => {
    const r = scoreLead(
      makeDraft({
        phones: ["+7 495 111-22-33"],
        normPhones: ["74951112233"],
        socials: [{ type: "instagram", url: "https://instagram.com/b" }],
        hours: "ежедневно",
        sources: [
          { provider: "yandex", url: "y" },
          { provider: "osm", url: "o" },
        ],
        confirmedByOsm: true,
      }),
      NO_REQUIREMENTS,
      NOW
    );
    expect(r.reject).toBeNull();
    expect(r.potential).toBe("HIGH");
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(labels(r)).toEqual(
      expect.arrayContaining(["сайт не найден ни в Яндексе, ни в OSM", "есть соцсети: Instagram", "бизнес подтверждён в двух источниках"])
    );
  });

  it("не придумывает плюсы: без email нет пункта про email", () => {
    const r = scoreLead(makeDraft({ phones: ["x"], normPhones: ["74951112233"] }), NO_REQUIREMENTS, NOW);
    expect(labels(r).some((l) => l.includes("email"))).toBe(false);
  });

  it("современный сайт — отфильтрован", () => {
    const d = makeDraft({ websiteKind: "own", website: "https://m.ru/", domain: "m.ru", phones: ["x"], normPhones: ["7"], audit: makeAudit() });
    expect(isModernSite(d, NOW)).toBe(true);
    const r = scoreLead(d, NO_REQUIREMENTS, NOW);
    expect(r.reject).toBe("современный сайт");
    expect(r.potential).toBe("LOW");
  });

  it("устаревший сайт без адаптива — причины конкретные", () => {
    const d = makeDraft({
      websiteKind: "own",
      website: "http://old.ru/",
      domain: "old.ru",
      phones: ["x"],
      normPhones: ["7"],
      audit: makeAudit({ https: false, hasViewport: false, hasForm: false, copyrightYear: 2016, outdated: ["платформа uCoz"] }),
    });
    const r = scoreLead(d, NO_REQUIREMENTS, NOW);
    expect(r.reject).toBeNull();
    expect(labels(r)).toEqual(
      expect.arrayContaining([
        "нет адаптации под телефон (нет meta viewport)",
        "в подвале сайта © 2016 — похоже, давно не обновлялся",
        "устаревшая вёрстка: платформа uCoz",
      ])
    );
  });

  it("сайт не открылся — это факт, а не «плохой сайт»", () => {
    const d = makeDraft({
      websiteKind: "own",
      website: "http://down.ru/",
      domain: "down.ru",
      phones: ["x"],
      normPhones: ["7"],
      audit: makeAudit({ status: "unreachable", error: "не ответил за 10 с" }),
    });
    expect(labels(scoreLead(d, NO_REQUIREMENTS, NOW))).toContain("сайт down.ru не открывается (не ответил за 10 с)");
  });

  it("непроверенный сайт (blocked) не влияет на оценку сайта", () => {
    const d = makeDraft({ websiteKind: "own", domain: "x.ru", phones: ["x"], normPhones: ["7"], audit: makeAudit({ status: "blocked" }) });
    expect(labels(scoreLead(d, NO_REQUIREMENTS, NOW)).some((l) => l.includes("сайт"))).toBe(false);
  });

  it("без контактов — не лид", () => {
    expect(scoreLead(makeDraft(), NO_REQUIREMENTS, NOW).reject).toBe("контакт невозможно подтвердить");
  });

  it("сеть снижает оценку", () => {
    const r = scoreLead(makeDraft({ phones: ["x"], normPhones: ["7"], chainSize: 5 }), NO_REQUIREMENTS, NOW);
    expect(labels(r)).toContain("похоже на сеть: 5 точек с таким названием");
  });

  it("требование «без сайта» отсекает бизнесы с собственным сайтом", () => {
    const d = makeDraft({ websiteKind: "own", domain: "x.ru", phones: ["x"], normPhones: ["7"] });
    expect(scoreLead(d, parseRequirements("только без сайта"), NOW).reject).toBe("есть собственный сайт");
  });

  it("оценка в пределах 0–100", () => {
    const r = scoreLead(makeDraft({ phones: ["x"], normPhones: ["7"], nicheMatch: false, chainSize: 9 }), NO_REQUIREMENTS, NOW);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

describe("parseRequirements", () => {
  it("распознаёт явные формулировки", () => {
    expect(parseRequirements("Нужны небольшие локальные бизнесы без современного сайта")).toMatchObject({
      excludeModern: true,
      noOwnSite: false,
    });
    expect(parseRequirements("без сайта, нужен телефон и инстаграм")).toMatchObject({
      noOwnSite: true,
      requirePhone: true,
      requireSocials: true,
      requireEmail: false,
    });
  });
  it("нераспознанный текст — без фильтров", () => {
    expect(describeRequirements(parseRequirements("хорошие ребята"))).toEqual([]);
    expect(parseRequirements(null)).toEqual(NO_REQUIREMENTS);
  });
});
