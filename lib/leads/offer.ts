// «Что можно предложить» — строится из ниши и проверенных проблем сайта.

import type { NicheSpec, OfferItem } from "./niches";
import type { LeadDraft } from "./types";

export interface OfferPlan {
  kind: "new_site" | "redesign";
  items: OfferItem[];
}

export function buildOfferPlan(draft: Pick<LeadDraft, "websiteKind" | "audit">, niche: NicheSpec): OfferPlan {
  const a = draft.audit;
  if (draft.websiteKind !== "own" || !a || a.status !== "ok") {
    return {
      kind: "new_site",
      items: [...niche.offer, { nom: "адаптация под телефон", instr: "адаптацией под телефон" }],
    };
  }
  const fixes: OfferItem[] = [];
  if (!a.hasViewport) fixes.push({ nom: "мобильная версия", instr: "мобильной версией" });
  if (!a.hasForm && !a.bookingWidget) fixes.push({ nom: "форма заявки / онлайн-запись", instr: "формой заявки" });
  if (!a.hasCta) fixes.push({ nom: "понятные кнопки записи и звонка", instr: "понятными кнопками записи и звонка" });
  if (!a.https) fixes.push({ nom: "HTTPS", instr: "HTTPS" });
  const extra = niche.offer.filter((o) => !fixes.some((f) => f.nom === o.nom)).slice(0, 3);
  return { kind: "redesign", items: [...fixes, ...extra] };
}

export function offerSummary(plan: OfferPlan): string {
  const list = plan.items.map((i) => i.nom).join(", ");
  return plan.kind === "new_site" ? `Одностраничный сайт: ${list}.` : `Обновление сайта: ${list}.`;
}
