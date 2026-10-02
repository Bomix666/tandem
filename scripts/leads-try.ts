// Живой прогон поиска клиентов без бота и без сохранения в БД: настоящие
// источники (локальная копия OSM / Overpass, Яндекс по флагу), настоящая
// проверка сайтов и email. Для отладки качества выдачи.
//
//   npx tsx scripts/leads-try.ts "Барбершопы" "Москва" 10
//   npx tsx scripts/leads-try.ts "Стоматологии" "Казань" 5 --yandex
//   npx tsx scripts/leads-try.ts "Автомойки" "Тверская область" 10 --extra "нужен email"

import { isYandexConfigured, leadsConfig } from "../lib/leads/config";
import { enrichContacts } from "../lib/leads/contacts";
import { LeadIndex } from "../lib/leads/dedupe";
import { resolveNiche } from "../lib/leads/niches";
import { searchOsmBest } from "../lib/leads/providers/osm-local";
import { searchYandex } from "../lib/leads/providers/yandex";
import { parseRequirements } from "../lib/leads/requirements";
import { runLeadSearch } from "../lib/leads/search";
import { auditWebsite } from "../lib/leads/site-audit";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return null;
    const v = args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : "";
    args.splice(i, v ? 2 : 1);
    return v;
  };
  const yandex = flag("--yandex") !== null;
  const extra = flag("--extra");
  const [niche = "Барбершопы", city = "Москва", count = "10"] = args;

  const started = Date.now();
  let lastStage = "";
  const out = await runLeadSearch(
    {
      niche: resolveNiche(niche),
      city,
      requested: Number(count),
      requirements: parseRequirements(extra),
      osmOnly: !yandex,
      offset: 0,
      excludeExisting: false,
      excludeKeys: new Set(),
    },
    {
      yandexConfigured: isYandexConfigured(),
      osmEnabled: leadsConfig.osmEnabled,
      yandex: searchYandex,
      osm: async (n, c, o) => {
        const t = Date.now();
        const r = await searchOsmBest(n, c, o);
        console.log(`OSM: ${r.items.length} точек за ${Date.now() - t} мс${r.note ? ` (${r.note})` : ""}`);
        return r;
      },
      audit: (url) => auditWebsite(url),
      contacts: (d) => enrichContacts(d),
      index: new LeadIndex(),
      onProgress: (p) => {
        if (p.stage !== lastStage) console.log(`… ${p.stage}`);
        lastStage = p.stage;
      },
    }
  );

  console.log(
    `\n${out.sourceLabel}: ${out.candidates} бизнесов · ${out.accepted.length} подходят · ${out.withEmail} с email · ${out.needsReview} требуют проверки` +
      ` · проверено ${out.checked}, отсеяно ${out.filtered} · ${((Date.now() - started) / 1000).toFixed(1)} с`
  );
  for (const w of out.warnings) console.log(w);
  for (const [i, a] of out.accepted.entries()) {
    const d = a.draft;
    console.log(`\n${i + 1}. ${d.name} — ${a.result.score}/100 (${d.category ?? d.niche})`);
    console.log(`   ${d.address ?? "адрес не указан"} · ${d.phones[0] ?? "без телефона"}`);
    console.log(`   сайт: ${d.website ?? d.websiteKind}${d.audit ? ` [${d.audit.status}]` : ""}`);
    for (const c of d.contacts ?? []) console.log(`   ${c.check === "VALID" ? "🟢" : c.check === "INVALID" ? "🔴" : "🟡"} ${c.value} · ${c.source}${c.sourceUrl ? ` ${c.sourceUrl}` : ""} — ${c.checkNote ?? ""}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => (await import("../lib/prisma")).prisma.$disconnect());
