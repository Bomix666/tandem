// Выбор генератора предложений по LEADS_PROPOSAL_ENGINE. Здесь только шаблон:
// тексты через Claude пишет модуль обращений (lib/leads/outreach/claude.ts).

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
