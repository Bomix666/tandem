// Подписи статусов и потенциала — общие для бота и описаний задач.

import type { LeadStatus } from "@prisma/client";
import type { Potential, ScoreReason } from "./types";

export const LEAD_STATUS_ORDER: LeadStatus[] = [
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

export const POTENTIAL_LABELS: Record<Potential, string> = { HIGH: "Высокий", MEDIUM: "Средний", LOW: "Низкий" };
export const POTENTIAL_EMOJI: Record<Potential, string> = { HIGH: "🔥", MEDIUM: "🟡", LOW: "⚪" };

/** «✓ нет сайта», «✗ похоже на сеть» — с плюсами в начале. */
export function formatScoreReasons(reasons: ScoreReason[], opts: { positiveOnly?: boolean; withMarks?: boolean } = {}): string[] {
  const sorted = [...reasons].sort((a, b) => b.points - a.points);
  return sorted
    .filter((r) => !opts.positiveOnly || r.points > 0)
    .map((r) => (opts.withMarks ? `${r.points > 0 ? "✓" : "✗"} ${r.label}` : r.label));
}
