// Лид из БД → LeadFacts: единственный вход для любого генератора предложений.

import type { Lead } from "@prisma/client";
import { formatScoreReasons } from "../labels";
import { resolveNiche } from "../niches";
import { buildOfferPlan } from "../offer";
import type { ScoreReason, SiteAudit, SocialLink, SourceRef, WebsiteKind } from "../types";
import type { LeadFacts } from "./types";

export function buildLeadFacts(lead: Lead): LeadFacts {
  const niche = resolveNiche(lead.niche);
  const audit = (lead.siteAudit as unknown as SiteAudit | null) ?? undefined;
  const socials = (lead.socials as unknown as SocialLink[] | null) ?? [];
  const sources = (lead.sources as unknown as SourceRef[] | null) ?? [];
  const booking = lead.bookingPage as { name?: string } | null;
  const websiteKind = lead.websiteKind as WebsiteKind;

  return {
    name: lead.name,
    city: lead.city,
    nicheLabel: niche.singular,
    nicheAccusative: niche.accusative,
    category: lead.category ?? undefined,
    websiteKind,
    domain: lead.domain ?? undefined,
    bookingName: booking?.name,
    socialTypes: socials.map((s) => s.type),
    sourceProviders: [...new Set(sources.map((s) => s.provider))],
    site:
      websiteKind === "own" && audit && audit.status !== "blocked"
        ? {
            reachable: audit.status === "ok",
            hasViewport: audit.hasViewport,
            hasForm: audit.hasForm || !!audit.bookingWidget,
            https: audit.https,
            hasCta: audit.hasCta,
            copyrightYear: audit.copyrightYear,
            outdated: audit.outdated,
          }
        : undefined,
    offer: buildOfferPlan({ websiteKind, audit }, niche),
    reasons: formatScoreReasons((lead.scoreReasons as unknown as ScoreReason[] | null) ?? [], { positiveOnly: true }),
  };
}
