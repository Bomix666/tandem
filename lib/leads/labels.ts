// Подписи статусов и потенциала — общие для бота и описаний задач.

import type { ContactSource, EmailCheck, LeadStatus } from "@prisma/client";
import type { Potential, ScoreReason, SiteAudit } from "./types";

/** Проблемы сайта, найденные проверкой, — короткими фразами для карточки. */
export function siteIssues(audit: SiteAudit | null | undefined, now = new Date()): string[] {
  if (!audit || audit.status !== "ok") return [];
  const issues: string[] = [];
  if (!audit.hasViewport) issues.push("нет адаптации под телефон");
  if (!audit.hasForm && !audit.bookingWidget) issues.push("на главной нет формы заявки");
  if (!audit.https) issues.push("без HTTPS");
  if (audit.copyrightYear && audit.copyrightYear <= now.getFullYear() - 3) issues.push(`© ${audit.copyrightYear}`);
  if (audit.outdated?.length) issues.push("устаревшая вёрстка");
  return issues;
}

export const SOURCE_LABELS: Record<string, string> = { yandex: "Яндекс Карты", osm: "OpenStreetMap" };

export const LEAD_STATUS_ORDER: LeadStatus[] = [
  "FOUND",
  "NEW",
  "TO_CONTACT",
  "CONTACTED",
  "WAITING",
  "NEGOTIATION",
  "CLIENT",
  "REJECTED",
  "NOT_FIT",
];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  FOUND: "Найден",
  NEW: "Новый",
  TO_CONTACT: "Связаться",
  CONTACTED: "Написали",
  WAITING: "Ждём ответа",
  NEGOTIATION: "Переговоры",
  CLIENT: "Клиент",
  REJECTED: "Отказ",
  NOT_FIT: "Не подходит",
};

export const LEAD_STATUS_EMOJI: Record<LeadStatus, string> = {
  FOUND: "🔎",
  NEW: "🆕",
  TO_CONTACT: "📩",
  CONTACTED: "💬",
  WAITING: "⏳",
  NEGOTIATION: "🤝",
  CLIENT: "💰",
  REJECTED: "❌",
  NOT_FIT: "🚫",
};

export const statusText = (s: LeadStatus) => `${LEAD_STATUS_EMOJI[s]} ${LEAD_STATUS_LABELS[s]}`;

export const EMAIL_CHECK_LABELS: Record<EmailCheck, string> = {
  VALID: "Подтверждён",
  UNVERIFIED: "Найден, не подтверждён",
  INVALID: "Некорректный",
};
export const EMAIL_CHECK_EMOJI: Record<EmailCheck, string> = { VALID: "🟢", UNVERIFIED: "🟡", INVALID: "🔴" };

export const CONTACT_SOURCE_LABELS: Record<ContactSource, string> = {
  OSM: "OpenStreetMap",
  YANDEX: "Яндекс Карты",
  SITE: "сайт компании",
  MANUAL: "добавлен вручную",
};

export const POTENTIAL_LABELS: Record<Potential, string> = { HIGH: "Высокий", MEDIUM: "Средний", LOW: "Низкий" };
export const POTENTIAL_EMOJI: Record<Potential, string> = { HIGH: "🔥", MEDIUM: "🟡", LOW: "⚪" };

/** «✓ нет сайта», «✗ похоже на сеть» — с плюсами в начале. */
export function formatScoreReasons(reasons: ScoreReason[], opts: { positiveOnly?: boolean; withMarks?: boolean } = {}): string[] {
  const sorted = [...reasons].sort((a, b) => b.points - a.points);
  return sorted
    .filter((r) => !opts.positiveOnly || r.points > 0)
    .map((r) => (opts.withMarks ? `${r.points > 0 ? "✓" : "✗"} ${r.label}` : r.label));
}
