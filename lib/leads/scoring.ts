// Lead Score 0–100 — насколько бизнес подходит как клиент на разработку
// сайта. Это НЕ рейтинг компании. Баллы начисляются только за проверенные
// факты (данные источника или результат проверки сайта); если что-то
// проверить не удалось, это не засчитывается ни в плюс, ни в минус.

import type { SearchRequirements } from "./requirements";
import type { LeadDraft, Potential, ScoreReason, ScoreResult, SocialType } from "./types";

const SOCIAL_LABELS: Record<SocialType, string> = {
  instagram: "Instagram",
  vk: "VK",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  ok: "Одноклассники",
  facebook: "Facebook",
  youtube: "YouTube",
  tiktok: "TikTok",
  dzen: "Дзен",
  taplink: "Taplink",
};

export function socialLabel(type: SocialType): string {
  return SOCIAL_LABELS[type];
}

export function potentialFor(score: number): Potential {
  if (score >= 65) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

/** Сайт выглядит современным: адаптив, HTTPS, форма/запись, призыв к действию, свежий год. */
export function isModernSite(draft: LeadDraft, now = new Date()): boolean {
  const a = draft.audit;
  if (draft.websiteKind !== "own" || !a || a.status !== "ok") return false;
  const staleYear = a.copyrightYear != null && a.copyrightYear <= now.getFullYear() - 3;
  return !!(a.hasViewport && a.https && (a.hasForm || a.bookingWidget) && a.hasCta && !staleYear && !a.outdated?.length);
}

function notFoundWhere(draft: LeadDraft): string {
  const providers = new Set(draft.sources.map((s) => s.provider));
  if (providers.has("yandex") && providers.has("osm")) return "сайт не найден ни в Яндексе, ни в OSM";
  if (providers.has("yandex")) return "сайт не указан в Яндекс Картах";
  return "сайт не указан в OpenStreetMap";
}

export function scoreLead(draft: LeadDraft, requirements: SearchRequirements, now = new Date()): ScoreResult {
  const reasons: ScoreReason[] = [];
  const add = (points: number, label: string) => reasons.push({ points, label });
  const a = draft.audit;
  const modern = isModernSite(draft, now);
  let weakOwnSite = false;

  // --- сайт ---
  if (draft.websiteKind === "none") {
    add(40, notFoundWhere(draft));
  } else if (draft.websiteKind === "social") {
    const s = draft.socials[0];
    add(32, `вместо сайта указана страница ${s ? socialLabel(s.type) : "в соцсети"}`);
  } else if (draft.websiteKind === "booking") {
    add(28, `вместо сайта — страница онлайн-записи ${draft.bookingPage?.name ?? ""}`.trim());
  } else if (a) {
    if (a.status === "unreachable" || a.status === "error_status") {
      weakOwnSite = true;
      const why = a.status === "error_status" ? `ошибка ${a.httpStatus}` : a.error ?? "не открылся";
      add(24, `сайт ${draft.domain} не открывается (${why})`);
    } else if (a.status === "ok") {
      if (!a.hasViewport) {
        weakOwnSite = true;
        add(22, "нет адаптации под телефон (нет meta viewport)");
      }
      if (!a.hasForm && !a.bookingWidget) add(8, "на сайте нет формы заявки или онлайн-записи");
      if (!a.https) add(6, "сайт без HTTPS");
      if (!a.hasCta) add(4, "нет явного призыва: записаться / заказать / позвонить");
      if (a.copyrightYear != null && a.copyrightYear <= now.getFullYear() - 3) {
        weakOwnSite = true;
        add(10, `в подвале сайта © ${a.copyrightYear} — похоже, давно не обновлялся`);
      }
      if (a.outdated?.length) {
        weakOwnSite = true;
        add(10, `устаревшая вёрстка: ${a.outdated.join(", ")}`);
      }
      if (modern) add(-30, "современный сайт: адаптив, HTTPS, форма заявки");
    }
    // status "blocked" — сайт не проверяли, в скоринг не идёт
  }

  // --- контакты и признаки активности ---
  if (draft.phones.length) add(10, "есть публичный телефон");
  if (draft.emails.length) add(5, "есть публичный email");
  const socialTypes = draft.socials.map((s) => socialLabel(s.type));
  if (socialTypes.length) add(10, `есть соцсети: ${socialTypes.join(", ")}`);
  if (draft.hours) add(4, "указан режим работы — бизнес действующий");
  if (draft.confirmedByOsm) add(6, "бизнес подтверждён в двух источниках");

  // --- соответствие поиску ---
  if (draft.nicheMatch) add(8, "подходит под выбранную нишу");
  else add(-5, `категория не совпадает с нишей${draft.category ? ` (${draft.category})` : ""}`);
  if (draft.chainSize >= 3) add(-20, `похоже на сеть: ${draft.chainSize} точек с таким названием`);
  else add(7, "локальный бизнес");
  if (draft.websiteKind !== "own" || weakOwnSite) add(5, "подходит под быстрый лендинг");

  const score = Math.max(0, Math.min(100, reasons.reduce((s, r) => s + r.points, 0)));
  const hasContact = draft.phones.length > 0 || draft.emails.length > 0 || draft.socials.length > 0;

  let reject: string | null = null;
  if (!hasContact) reject = "контакт невозможно подтвердить";
  else if (requirements.noOwnSite && draft.websiteKind === "own") reject = "есть собственный сайт";
  else if ((requirements.excludeModern || requirements.noOwnSite) && modern) reject = "современный сайт";
  else if (requirements.requirePhone && !draft.phones.length) reject = "нет публичного телефона";
  else if (requirements.requireEmail && !draft.emails.length) reject = "нет публичного email";
  else if (requirements.requireSocials && !draft.socials.length) reject = "нет соцсетей";
  else if (score < 20) reject = modern ? "современный сайт" : "низкое соответствие критериям";

  return { score, potential: potentialFor(score), reasons, reject };
}
