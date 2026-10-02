// История лида (LeadEvent): найден → сохранён → задача → обращение → ответ…
// Из неё строятся аналитика воронки и «Сегодня» (этап 2), поэтому каждое
// действие с лидом пишет событие здесь, а не в разных местах по-своему.

import type { LeadEventType, LeadStatus, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";

type Db = PrismaClient | Prisma.TransactionClient;

export interface LeadEventInput {
  workspaceId: string;
  leadId: string;
  type: LeadEventType;
  actorId?: string | null;
  fromStatus?: LeadStatus | null;
  toStatus?: LeadStatus | null;
  meta?: Prisma.InputJsonObject;
}

export async function recordLeadEvent(e: LeadEventInput, db: Db = prisma) {
  await db.leadEvent.create({
    data: {
      workspaceId: e.workspaceId,
      leadId: e.leadId,
      type: e.type,
      actorId: e.actorId ?? null,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      meta: e.meta,
    },
  });
}

/**
 * Смена статуса с записью в историю. Возвращает false, если лида нет.
 * `onlyFrom` — менять, только если текущий статус из списка (автопереходы
 * не должны откатывать лид, который уже продвинулся дальше по воронке).
 */
export async function changeLeadStatus(params: {
  leadId: string;
  workspaceId: string;
  status: LeadStatus;
  actorId?: string | null;
  onlyFrom?: LeadStatus[];
  meta?: Prisma.InputJsonObject;
}): Promise<boolean> {
  const { leadId, workspaceId, status } = params;
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { id: leadId, workspaceId }, select: { status: true } });
    if (!lead) return false;
    if (lead.status === status || (params.onlyFrom && !params.onlyFrom.includes(lead.status))) return true;
    await tx.lead.update({ where: { id: leadId }, data: { status, statusChangedAt: new Date() } });
    await recordLeadEvent(
      { workspaceId, leadId, type: "STATUS_CHANGED", actorId: params.actorId, fromStatus: lead.status, toStatus: status, meta: params.meta },
      tx
    );
    return true;
  });
}
