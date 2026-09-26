import { PrismaClient } from "@prisma/client";

// User.telegramId — BigInt, а JSON.stringify (NextResponse.json) BigInt не
// умеет и падает с "Do not know how to serialize a BigInt". Отдаём строкой.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (this: bigint) {
  return this.toString();
};

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
