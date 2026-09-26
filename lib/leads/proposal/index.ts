// Выбор генератора предложений по LEADS_PROPOSAL_ENGINE.
//
// Как подключить Claude позже, не трогая остальной модуль:
//   1. создать lib/leads/proposal/claude.ts, экспортирующий объект
//      ProposalGenerator (id: "claude"), который превращает LeadFacts в промпт
//      и возвращает текст ответа; ключ брать из process.env.ANTHROPIC_API_KEY;
//   2. добавить его в GENERATORS ниже;
//   3. в .env: LEADS_PROPOSAL_ENGINE=claude и ANTHROPIC_API_KEY=...
// Бот, кнопка «✨ Создать предложение» и сохранение текста не меняются.

import { leadsConfig } from "../config";
import { templateGenerator } from "./template";
import type { ProposalGenerator } from "./types";

const GENERATORS: Record<string, ProposalGenerator> = {
  template: templateGenerator,
};

export function getProposalGenerator(): { generator: ProposalGenerator; note: string | null } {
  const id = leadsConfig.proposalEngine;
  const generator = GENERATORS[id];
  if (generator) return { generator, note: null };
  return { generator: templateGenerator, note: `Движок «${id}» не подключён — использую шаблон.` };
}

export { buildLeadFacts } from "./facts";
export type { LeadFacts, ProposalGenerator } from "./types";
