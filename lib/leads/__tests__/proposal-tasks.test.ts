import { describe, expect, it } from "vitest";
import { buildTaskDescription, taskTitleForLead } from "../lead-tasks";
import { buildLeadFacts, getProposalGenerator } from "../proposal";
import { renderTemplateProposal } from "../proposal/template";
import { makeAudit, makeLeadRow } from "./helpers";

describe("шаблон предложения", () => {
  it("бизнес без сайта с Instagram — только реальные факты", () => {
    const text = renderTemplateProposal(buildLeadFacts(makeLeadRow()));
    expect(text).toContain("Обратил внимание на ваш барбершоп «Black Barber».");
    expect(text).toContain("У вас есть Instagram, но отдельного сайта для клиентов я не нашёл.");
    expect(text).toContain("Мы можем быстро сделать компактный сайт с:");
    expect(text).toContain("— кнопкой записи;");
    expect(text).toContain("— адаптацией под телефон.");
    expect(text).not.toMatch(/@|отзыв/i); // email и отзывов у лида нет — в тексте их нет
  });

  it("сайт без адаптива — конкретное наблюдение и доработки", () => {
    const lead = makeLeadRow({
      websiteKind: "own",
      website: "http://old.ru/",
      domain: "old.ru",
      siteAudit: makeAudit({ hasViewport: false, hasForm: false }) as never,
    });
    const text = renderTemplateProposal(buildLeadFacts(lead));
    expect(text).toContain("Открыл ваш сайт old.ru — на телефоне он показывается в компьютерной версии, без мобильной адаптации.");
    expect(text).toContain("Можем обновить сайт и добавить:");
    expect(text).toContain("— мобильная версия;");
  });

  it("страница записи и падеж ниши", () => {
    const lead = makeLeadRow({
      niche: "Стоматологии",
      websiteKind: "booking",
      bookingPage: { name: "YCLIENTS", url: "https://n1.yclients.com" } as never,
      socials: [] as never,
    });
    const text = renderTemplateProposal(buildLeadFacts(lead));
    expect(text).toContain("на вашу стоматологию");
    expect(text).toContain("через страницу YCLIENTS");
  });

  it("по умолчанию используется шаблон, его можно заменить движком по env", async () => {
    const saved = process.env.LEADS_PROPOSAL_ENGINE; // vitest подтягивает .env разработчика
    delete process.env.LEADS_PROPOSAL_ENGINE;
    try {
      const { generator, note } = getProposalGenerator();
      expect(generator.id).toBe("template");
      expect(note).toBeNull();
      process.env.LEADS_PROPOSAL_ENGINE = "claude";
      const fallback = getProposalGenerator();
      expect(fallback.generator.id).toBe("template"); // у предложений своего Claude нет — честный откат на шаблон
      expect(fallback.note).toContain("не подключён");
    } finally {
      if (saved === undefined) delete process.env.LEADS_PROPOSAL_ENGINE;
      else process.env.LEADS_PROPOSAL_ENGINE = saved;
    }
  });
});

describe("задача из лида", () => {
  it("заголовок и описание со всеми данными лида", () => {
    const lead = makeLeadRow();
    expect(taskTitleForLead(lead)).toBe("Связаться с Black Barber — предложить сайт");
    const d = buildTaskDescription(lead);
    expect(d).toContain("Тип: Продажа сайта");
    expect(d).toContain("Клиент: Black Barber");
    expect(d).toContain("Город: Москва");
    expect(d).toContain("Контакт: +7 495 111-22-33");
    expect(d).toContain("Соцсети: Instagram https://instagram.com/blackbarber");
    expect(d).toContain("Сайт: не найден");
    expect(d).toContain("Источник: https://yandex.ru/maps/org/1001/");
    expect(d).toContain("Причина обращения: сайт не указан в Яндекс Картах; есть публичный телефон");
    expect(d).toContain("Статус лида: Новый");
    expect(d).toContain("Lead Score: 84/100 (потенциал: высокий)");
  });

  it("нет контактов — так и пишем", () => {
    const d = buildTaskDescription(makeLeadRow({ phones: [], emails: [] }));
    expect(d).toContain("Контакт: не найден");
  });
});
