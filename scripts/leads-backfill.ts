// Перевод лидов, найденных до «Sales OS» (этап 1), на новую модель данных.
// Можно запускать повторно — уже обработанные лиды пропускаются.
//
//   • email из Lead.emails проходят новые правила: личные адреса удаляются,
//     остальные становятся LeadContact с источником и проверкой DNS (🟢🟡🔴);
//   • в историю (LeadEvent) записываются «найден» и созданные задачи — с их датами.
// Статусы лидов не меняются.
//
//   docker compose exec bot npx tsx scripts/leads-backfill.ts

import type { LeadContact, LeadEventType } from "@prisma/client";
import { addEmailContacts, enrichContacts } from "../lib/leads/contacts";
import { prisma } from "../lib/prisma";
import { leadToDraft, refreshLeadEmails, saveEmailContacts } from "../lib/leads/repository";
import type { SiteAudit, SourceRef } from "../lib/leads/types";

async function main() {
  const leads = await prisma.lead.findMany({ include: { contacts: { select: { id: true } }, tasks: true } });
  let contacts = 0;
  let dropped = 0;
  let events = 0;

  for (const lead of leads) {
    // --- email → LeadContact ---
    if (!lead.contacts.length && lead.emails.length) {
      const draft = leadToDraft(lead);
      draft.emails = [];
      draft.contacts = [];
      const audit = lead.siteAudit as unknown as SiteAudit | null;
      const osm = ((lead.sources as unknown as SourceRef[] | null) ?? []).find((s) => s.provider === "osm");
      for (const email of lead.emails) {
        // откуда адрес: с сайта (есть в проверке сайта) или из карточки OSM
        const fromSite = !!audit?.emails?.includes(email) || !osm;
        dropped += addEmailContacts(draft, [email], fromSite ? "site" : "osm", fromSite ? audit?.finalUrl ?? lead.website ?? undefined : osm!.url);
      }
      // страницы контактов заново не обходим — только проверка DNS найденных раньше адресов
      draft.audit = undefined;
      await enrichContacts(draft, { fetchPage: async () => null });
      await saveEmailContacts(lead.workspaceId, lead.id, draft.contacts);
      contacts += draft.contacts.length;
      if (!draft.contacts.length) await prisma.lead.update({ where: { id: lead.id }, data: { emails: [] } });
      else await refreshLeadEmails(lead.id);
    }

    // --- история: найден + задачи (только если истории ещё нет) ---
    const hasHistory = await prisma.leadEvent.count({ where: { leadId: lead.id, type: { not: "CONTACT_FOUND" } } });
    if (!hasHistory) {
      const rows: { type: LeadEventType; createdAt: Date; meta: object }[] = [
        { type: "FOUND", createdAt: lead.createdAt, meta: { backfill: true } },
        ...lead.tasks.map((t) => ({ type: "TASK_CREATED" as const, createdAt: t.createdAt, meta: { backfill: true, taskId: t.taskId, kind: t.kind } })),
      ];
      if (lead.saved) rows.push({ type: "SAVED", createdAt: lead.statusChangedAt ?? lead.createdAt, meta: { backfill: true } });
      await prisma.leadEvent.createMany({
        data: rows.map((r) => ({ workspaceId: lead.workspaceId, leadId: lead.id, actorId: null, type: r.type, createdAt: r.createdAt, meta: r.meta })),
      });
      events += rows.length;
    }
  }

  const byCheck = await prisma.leadContact.groupBy({ by: ["verification"], _count: { _all: true } });
  const fmt = (c: LeadContact["verification"]) => byCheck.find((g) => g.verification === c)?._count._all ?? 0;
  console.log(
    `Лидов: ${leads.length}. Email-контактов создано: ${contacts} (🟢 ${fmt("VALID")} · 🟡 ${fmt("UNVERIFIED")} · 🔴 ${fmt("INVALID")}), ` +
      `отброшено по правилам: ${dropped}. Событий истории: ${events}.`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
