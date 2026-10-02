// Шаблонные тексты обращений по каналам. Как и предложение (proposal/template),
// говорят только то, что следует из фактов о лиде; подпись — только из того,
// что пользователь заполнил в настройках.

import type { OutreachChannel } from "@prisma/client";
import { observation, renderTemplateProposal } from "../proposal/template";
import type { LeadFacts } from "../proposal/types";
import type { OutreachGenerator, OutreachRequest, OutreachText, SenderProfile } from "./types";

const pick = <T>(list: T[], variant: number): T => list[((variant % list.length) + list.length) % list.length]!;

function subjects(f: LeadFacts): string[] {
  if (f.websiteKind === "own") {
    const site = f.domain ?? `«${f.name}»`;
    return [`Сайт ${site}: что можно улучшить`, `Предложение по сайту «${f.name}»`, `Обновление сайта ${site}`];
  }
  return [`Сайт для «${f.name}»`, `Предложение для «${f.name}»`, `Идея для «${f.name}»`];
}

function signature(s: SenderProfile): string[] {
  const who = [s.name, s.company].filter(Boolean).join(", ");
  return [who || null, s.portfolioUrl ? `Портфолио: ${s.portfolioUrl}` : null, s.contact || null].filter((l): l is string => !!l);
}

function shortOffer(f: LeadFacts): string {
  const items = f.offer.items.slice(0, 3).map((i) => (f.offer.kind === "new_site" ? i.instr : i.nom));
  return f.offer.kind === "new_site"
    ? `Можем быстро сделать компактный сайт с ${items.join(", ")}.`
    : `Можем обновить сайт: ${items.join(", ")}.`;
}

const GREETINGS = ["Здравствуйте!", "Добрый день!", "Здравствуйте."];
const CLOSINGS = [
  "Могу показать пример концепции именно под ваш бизнес — интересно?",
  "Если интересно, пришлю пример, как это может выглядеть у вас.",
  "Могу бесплатно набросать концепцию — показать?",
];

const intro = (s: SenderProfile) => (s.name ? `Меня зовут ${s.name}${s.company ? `, ${s.company}` : ""}. ` : "");

/** Telegram — коротко: кто, о чём, что видим, что предлагаем. */
function telegram(f: LeadFacts, s: SenderProfile, variant: number): string {
  return [
    `${pick(GREETINGS, variant)} ${intro(s)}Пишу по поводу ${f.nicheAccusative} «${f.name}».`,
    observation(f),
    shortOffer(f),
    pick(CLOSINGS, variant),
  ].join("\n\n");
}

/** WhatsApp — коротко и по-разговорному, одним-двумя абзацами. */
function whatsapp(f: LeadFacts, s: SenderProfile, variant: number): string {
  const hello = pick(["Здравствуйте! 👋", "Добрый день!", "Здравствуйте!"], variant);
  return [`${hello} ${intro(s)}${observation(f)}`, `${shortOffer(f)} ${pick(["Показать пример?", "Интересно посмотреть пример?", "Прислать пример?"], variant)}`].join("\n\n");
}

/** Соцсети — очень коротко: одно сообщение в пару предложений. */
function social(f: LeadFacts, s: SenderProfile, variant: number): string {
  const items = f.offer.items.slice(0, 2).map((i) => i.instr).join(" и ");
  const offer = f.offer.kind === "new_site" ? `Могу сделать для «${f.name}» сайт с ${items}.` : `Могу обновить сайт «${f.name}».`;
  return `${pick(GREETINGS, variant)} ${intro(s)}${offer} ${pick(["Показать пример?", "Интересно?", "Прислать пример?"], variant)}`;
}

function email(f: LeadFacts, s: SenderProfile, variant: number): string {
  const body = renderTemplateProposal(f).replace(/^Здравствуйте!/, pick(GREETINGS, variant));
  const sign = signature(s);
  return sign.length ? `${body}\n\n—\n${sign.join("\n")}` : body;
}

function render(channel: OutreachChannel, req: OutreachRequest): OutreachText {
  const { facts: f, sender: s, variant } = req;
  const warnings: string[] = [];
  if (!s.name) warnings.push("В подписи нет имени — заполни «Настройки → Подпись», чтобы письмо не было анонимным.");
  switch (channel) {
    case "EMAIL":
      return { subject: pick(subjects(f), variant), body: email(f, s, variant), warnings };
    case "TELEGRAM":
      return { body: telegram(f, s, variant), warnings };
    case "WHATSAPP":
      return { body: whatsapp(f, s, variant), warnings };
    case "SOCIAL":
      return { body: social(f, s, variant), warnings };
  }
}

export const templateOutreachGenerator: OutreachGenerator = {
  id: "template",
  label: "шаблон по фактам (AI не подключён)",
  async generate(req) {
    return render(req.channel, req);
  },
};
