// Обращения к лидам. Сейчас: черновик (Outreach DRAFT) по кнопке
// «✨ Создать предложение» + ручная передача пользователю. Редактор, статусы
// отправки и follow-up — этап 2; ничего не отправляется автоматически.
//
// Как подключить Claude позже: добавить OutreachGenerator с id "claude" в
// GENERATORS и выставить LEADS_PROPOSAL_ENGINE=claude — бот, Mini App и
// хранение черновиков не меняются.

import type { Lead, LeadContact, OutreachChannel } from "@prisma/client";
import { prisma } from "../../prisma";
import { leadsConfig } from "../config";
import { recordLeadEvent } from "../events";
import { buildLeadFacts } from "../proposal";
import { getLeadSettings } from "../repository";
import type { SocialLink } from "../types";
import { manualSenders } from "./senders";
import { templateOutreachGenerator } from "./template";
import type { OutreachGenerator, OutreachText } from "./types";

const GENERATORS: Record<string, OutreachGenerator> = {
  template: templateOutreachGenerator,
};

export function getOutreachGenerator(): { generator: OutreachGenerator; note: string | null } {
  const id = leadsConfig.proposalEngine;
  const generator = GENERATORS[id];
  if (generator) return { generator, note: null };
  return { generator: templateOutreachGenerator, note: `Движок «${id}» не подключён — использую шаблон.` };
}

type LeadForOutreach = Lead & { contacts?: LeadContact[] };

/** Кому писать в выбранном канале: лучший проверенный email, Telegram, WhatsApp или соцсеть. */
export function pickRecipient(lead: LeadForOutreach, channel: OutreachChannel): { recipient: string | null; contactId: string | null } {
  const socials = (lead.socials as unknown as SocialLink[] | null) ?? [];
  switch (channel) {
    case "EMAIL": {
      const usable = (lead.contacts ?? []).filter((c) => c.kind === "EMAIL" && c.verification !== "INVALID");
      const best = usable.find((c) => c.isPrimary) ?? usable[0];
      if (best) return { recipient: best.value, contactId: best.id };
      return { recipient: lead.emails[0] ?? null, contactId: null };
    }
    case "TELEGRAM":
      return { recipient: socials.find((s) => s.type === "telegram")?.url ?? null, contactId: null };
    case "WHATSAPP":
      return { recipient: socials.find((s) => s.type === "whatsapp")?.url ?? lead.phones[0] ?? null, contactId: null };
    case "SOCIAL":
      return { recipient: socials.find((s) => s.type === "vk" || s.type === "instagram")?.url ?? socials[0]?.url ?? null, contactId: null };
  }
}

export interface DraftResult {
  outreachId: string;
  channel: OutreachChannel;
  recipient: string | null;
  text: OutreachText;
  engine: string;
  note: string | null;
  handoff: ReturnType<(typeof manualSenders)[OutreachChannel]["prepare"]>;
}

export async function createOutreachDraft(params: {
  lead: LeadForOutreach;
  channel: OutreachChannel;
  actorId?: string | null;
  variant?: number;
}): Promise<DraftResult> {
  const { lead, channel } = params;
  const variant = params.variant ?? 0;
  const settings = await getLeadSettings(lead.workspaceId);
  const { generator, note } = getOutreachGenerator();
  const text = await generator.generate({
    channel,
    variant,
    facts: buildLeadFacts(lead),
    sender: { name: settings.senderName, company: settings.companyName, portfolioUrl: settings.portfolioUrl, contact: settings.senderContact },
  });
  const { recipient, contactId } = pickRecipient(lead, channel);

  const outreach = await prisma.outreach.create({
    data: {
      workspaceId: lead.workspaceId,
      leadId: lead.id,
      createdById: params.actorId ?? null,
      channel,
      status: "DRAFT",
      recipient,
      contactId,
      subject: text.subject ?? null,
      body: text.body,
      generator: generator.id,
      variant,
    },
  });
  await recordLeadEvent({
    workspaceId: lead.workspaceId,
    leadId: lead.id,
    type: "OUTREACH_DRAFTED",
    actorId: params.actorId,
    meta: { outreachId: outreach.id, channel, generator: generator.id },
  });
  // совместимость: «✨ предложение» в карточке и Mini App читается из Lead.proposal
  if (channel === "EMAIL") await prisma.lead.update({ where: { id: lead.id }, data: { proposal: text.body } });

  return {
    outreachId: outreach.id,
    channel,
    recipient,
    text,
    engine: generator.label,
    note,
    handoff: manualSenders[channel].prepare({ recipient, subject: text.subject, body: text.body }),
  };
}

export { manualSenders } from "./senders";
export type { ManualHandoff, OutreachGenerator, OutreachSender, OutreachText, SenderProfile } from "./types";
