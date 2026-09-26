import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export async function logActivity(
  workspaceId: string,
  actorId: string,
  type: string,
  meta?: Record<string, unknown>
) {
  return prisma.taskActivity.create({
    data: {
      workspaceId,
      actorId,
      type,
      taskId: (meta?.taskId as string) ?? undefined,
      meta: (meta as Prisma.InputJsonObject | undefined) ?? undefined,
    },
  });
}
