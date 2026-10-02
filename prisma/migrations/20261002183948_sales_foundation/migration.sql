-- pg_trgm: поиск бизнесов по названию в локальной копии OSM («своя ниша»)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "LeadTaskKind" AS ENUM ('CONTACT', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('EMAIL', 'PHONE', 'SOCIAL');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('OSM', 'YANDEX', 'SITE', 'MANUAL');

-- CreateEnum
CREATE TYPE "EmailCheck" AS ENUM ('VALID', 'UNVERIFIED', 'INVALID');

-- CreateEnum
CREATE TYPE "LeadEventType" AS ENUM ('FOUND', 'SAVED', 'STATUS_CHANGED', 'CONTACT_FOUND', 'TASK_CREATED', 'OUTREACH_DRAFTED', 'OUTREACH_SENT', 'REPLY_RECEIVED', 'FOLLOWUP_SET', 'FOLLOWUP_DONE');

-- CreateEnum
CREATE TYPE "OutreachChannel" AS ENUM ('EMAIL', 'TELEGRAM', 'WHATSAPP', 'SOCIAL');

-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('DRAFT', 'READY', 'SENT', 'WAITING', 'REPLIED', 'FOLLOW_UP', 'REJECTED', 'CLIENT');

-- AlterEnum
ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'FOUND' BEFORE 'NEW';

-- AlterTable
ALTER TABLE "LeadSearch" ADD COLUMN     "candidates" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "needsReview" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'osm',
ADD COLUMN     "withEmail" INTEGER NOT NULL DEFAULT 0;

-- Прошлые поиски не «только OSM» шли через Яндекс: «Найти ещё» должно продолжать там же
UPDATE "LeadSearch" SET "source" = 'yandex' WHERE "osmOnly" = false;

-- AlterTable
ALTER TABLE "LeadSettings" ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "portfolioUrl" TEXT,
ADD COLUMN     "senderContact" TEXT,
ADD COLUMN     "senderName" TEXT;

-- AlterTable
ALTER TABLE "LeadTask" ADD COLUMN     "kind" "LeadTaskKind" NOT NULL DEFAULT 'CONTACT',
ADD COLUMN     "outreachId" TEXT;

-- CreateTable
CREATE TABLE "LeadContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "value" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "role" TEXT,
    "sourceType" "ContactSource" NOT NULL,
    "sourceUrl" TEXT,
    "verification" "EmailCheck",
    "checkNote" TEXT,
    "checkedAt" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "LeadEventType" NOT NULL,
    "fromStatus" "LeadStatus",
    "toStatus" "LeadStatus",
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outreach" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "createdById" TEXT,
    "channel" "OutreachChannel" NOT NULL,
    "status" "OutreachStatus" NOT NULL DEFAULT 'DRAFT',
    "recipient" TEXT,
    "contactId" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "generator" TEXT NOT NULL,
    "variant" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "followUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Outreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OsmPlace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "kinds" TEXT[],
    "tags" JSONB NOT NULL,
    "phone" TEXT,
    "website" TEXT,
    "email" TEXT,
    "hasContact" BOOLEAN NOT NULL,
    "importId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsmPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OsmImport" (
    "id" TEXT NOT NULL,
    "regions" TEXT[],
    "status" TEXT NOT NULL,
    "sourceDate" TIMESTAMP(3),
    "places" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "OsmImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OsmArea" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "south" DOUBLE PRECISION NOT NULL,
    "west" DOUBLE PRECISION NOT NULL,
    "north" DOUBLE PRECISION NOT NULL,
    "east" DOUBLE PRECISION NOT NULL,
    "geometry" JSONB,
    "source" TEXT NOT NULL DEFAULT 'nominatim',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OsmArea_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "LeadContact_workspaceId_kind_idx" ON "LeadContact"("workspaceId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "LeadContact_leadId_kind_normalized_key" ON "LeadContact"("leadId", "kind", "normalized");

-- CreateIndex
CREATE INDEX "LeadEvent_workspaceId_createdAt_idx" ON "LeadEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadEvent_leadId_createdAt_idx" ON "LeadEvent"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadEvent_workspaceId_type_createdAt_idx" ON "LeadEvent"("workspaceId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "Outreach_workspaceId_status_idx" ON "Outreach"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Outreach_leadId_createdAt_idx" ON "Outreach"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "OsmPlace_kinds_idx" ON "OsmPlace" USING GIN ("kinds");

-- CreateIndex
CREATE INDEX "OsmPlace_lat_lon_idx" ON "OsmPlace"("lat", "lon");

-- CreateIndex
CREATE INDEX "OsmPlace_importId_idx" ON "OsmPlace"("importId");

-- CreateIndex
CREATE INDEX "OsmPlace_name_trgm_idx" ON "OsmPlace" USING GIN ("name" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "LeadContact" ADD CONSTRAINT "LeadContact_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "LeadContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
