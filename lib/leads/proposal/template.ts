// Шаблонный генератор: собирает текст только из проверенных фактов.
// Каждое утверждение о бизнесе соответствует конкретному факту из LeadFacts;
// если факта нет — утверждения нет.

import { socialLabel } from "../scoring";
import type { LeadFacts, ProposalGenerator } from "./types";

function observation(f: LeadFacts): string {
  const socials = f.socialTypes.filter((t) => t !== "taplink").map(socialLabel);
  const socialsText = socials.length === 1 ? socials[0] : socials.slice(0, 2).join(" и ");

  switch (f.websiteKind) {
    case "none":
      return socials.length
        ? `У вас есть ${socialsText}, но отдельного сайта для клиентов я не нашёл.`
        : "Нашёл вас на картах, но сайта у вас не нашёл.";
    case "social": {
      const first = f.socialTypes[0]; // соцсеть, указанная вместо сайта, всегда первая
      return `Сейчас вместо сайта у вас указана страница ${first ? socialLabel(first) : "в соцсети"} — отдельного сайта для клиентов я не нашёл.`;
    }
    case "booking":
      return `Сейчас запись идёт через страницу ${f.bookingName ?? "онлайн-записи"}, а отдельного сайта с услугами и ценами я не нашёл.`;
    case "own": {
      const s = f.site;
      if (!s) return `Посмотрел ваш сайт ${f.domain} — его можно сделать удобнее для клиентов.`;
      if (!s.reachable) return `Попробовал открыть ваш сайт ${f.domain}, но сейчас он не открывается.`;
      if (s.hasViewport === false) return `Открыл ваш сайт ${f.domain} — на телефоне он показывается в компьютерной версии, без мобильной адаптации.`;
      const year = new Date().getFullYear();
      if (s.copyrightYear != null && s.copyrightYear <= year - 3) {
        return `На сайте ${f.domain} в подвале указан ${s.copyrightYear} год — похоже, сайт давно не обновлялся.`;
      }
      if (s.outdated?.length) return `Посмотрел ваш сайт ${f.domain} — он сделан на устаревших технологиях.`;
      if (s.hasForm === false) return `На сайте ${f.domain} не нашёл формы заявки или онлайн-записи.`;
      return `Посмотрел ваш сайт ${f.domain} — его можно сделать удобнее для клиентов.`;
    }
  }
}

export function renderTemplateProposal(f: LeadFacts): string {
  const items = f.offer.items;
  const list =
    f.offer.kind === "new_site"
      ? items.map((i, idx) => `— ${i.instr}${idx === items.length - 1 ? "." : ";"}`)
      : items.map((i, idx) => `— ${i.nom}${idx === items.length - 1 ? "." : ";"}`);
  const intro = f.offer.kind === "new_site" ? "Мы можем быстро сделать компактный сайт с:" : "Можем обновить сайт и добавить:";

  return [
    "Здравствуйте!",
    "",
    `Обратил внимание на ${f.nicheAccusative} «${f.name}».`,
    observation(f),
    "",
    intro,
    ...list,
    "",
    "Могу показать пример концепции именно под ваш бизнес.",
  ].join("\n");
}

export const templateGenerator: ProposalGenerator = {
  id: "template",
  label: "шаблон по фактам (AI не подключён)",
  async generate(facts) {
    return renderTemplateProposal(facts);
  },
};
