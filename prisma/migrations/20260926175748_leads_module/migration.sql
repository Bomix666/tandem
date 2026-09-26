-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'TO_CONTACT', 'CONTACTED', 'WAITING', 'NEGOTIATION', 'CLIENT', 'REJECTED', 'NOT_FIT');

-- CreateEnum
CREATE TYPE "LeadPotential" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "LeadSearchStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "category" TEXT,
    "address" TEXT,
    "normAddress" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "websiteKind" TEXT NOT NULL DEFAULT 'none',
    "website" TEXT,
    "domain" TEXT,
    "bookingPage" JSONB,
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "normPhones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "socials" JSONB,
    "hours" TEXT,
    "yandexId" TEXT,
    "osmId" TEXT,
    "sources" JSONB NOT NULL,
    "chainSize" INTEGER NOT NULL DEFAULT 1,
    "nicheMatch" BOOLEAN NOT NULL DEFAULT true,
    "siteAudit" JSONB,
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreReasons" JSONB,
    "potential" "LeadPotential" NOT NULL DEFAULT 'MEDIUM',
    "offer" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "proposal" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSearch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" BIGINT,
    "niche" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "requested" INTEGER NOT NULL,
    "extra" TEXT,
    "osmOnly" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "status" "LeadSearchStatus" NOT NULL DEFAULT 'RUNNING',
    "found" INTEGER NOT NULL DEFAULT 0,
    "checked" INTEGER NOT NULL DEFAULT 0,
    "filtered" INTEGER NOT NULL DEFAULT 0,
    "nextOffset" INTEGER NOT NULL DEFAULT 0,
    "warnings" JSONB,
    "rejectedKeys" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "LeadSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSearchResult" (
    "id" TEXT NOT NULL,
    "searchId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "wasExisting" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LeadSearchResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTask" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSettings" (
    "workspaceId" TEXT NOT NULL,
    "avgCheck" INTEGER NOT NULL DEFAULT 50000,

    CONSTRAINT "LeadSettings_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateIndex
CREATE INDEX "Lead_workspaceId_status_idx" ON "Lead"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_createdAt_idx" ON "Lead"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_domain_idx" ON "Lead"("workspaceId", "domain");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_normName_idx" ON "Lead"("workspaceId", "normName");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_workspaceId_yandexId_key" ON "Lead"("workspaceId", "yandexId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_workspaceId_osmId_key" ON "Lead"("workspaceId", "osmId");

-- CreateIndex
CREATE INDEX "LeadSearch_workspaceId_createdAt_idx" ON "LeadSearch"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSearchResult_searchId_leadId_key" ON "LeadSearchResult"("searchId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSearchResult_searchId_position_key" ON "LeadSearchResult"("searchId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "LeadTask_taskId_key" ON "LeadTask"("taskId");

-- CreateIndex
CREATE INDEX "LeadTask_leadId_idx" ON "LeadTask"("leadId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearch" ADD CONSTRAINT "LeadSearch_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearchResult" ADD CONSTRAINT "LeadSearchResult_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "LeadSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSearchResult" ADD CONSTRAINT "LeadSearchResult_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTask" ADD CONSTRAINT "LeadTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSettings" ADD CONSTRAINT "LeadSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
