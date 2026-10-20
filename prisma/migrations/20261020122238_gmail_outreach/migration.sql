-- CreateEnum
CREATE TYPE "MailDirection" AS ENUM ('OUT', 'IN');

-- AlterTable
ALTER TABLE "LeadSettings" ADD COLUMN     "gmailLastUid" INTEGER,
ADD COLUMN     "gmailPassword" TEXT,
ADD COLUMN     "gmailUser" TEXT,
ADD COLUMN     "priceInfo" TEXT;

-- CreateTable
CREATE TABLE "OutreachMessage" (
    "id" TEXT NOT NULL,
    "outreachId" TEXT NOT NULL,
    "direction" "MailDirection" NOT NULL,
    "messageId" TEXT,
    "fromAddr" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutreachMessage_messageId_key" ON "OutreachMessage"("messageId");

-- CreateIndex
CREATE INDEX "OutreachMessage_outreachId_createdAt_idx" ON "OutreachMessage"("outreachId", "createdAt");

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "Outreach"("id") ON DELETE CASCADE ON UPDATE CASCADE;
