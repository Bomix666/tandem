// Сообщение ⏰ FOLLOW-UP — одно и то же в напоминании (cron приложения) и в
// разделе «⏰ Follow-up» бота. Кнопки обрабатывает бот (bot/leads/sales.ts).

import { CHANNEL_EMOJI, statusText } from "./labels";
import type { FollowUp } from "./followups";
import { dayDiff, formatDay, formatDayTime } from "./time";

const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

/** «сегодня», «завтра», «просрочено на 2 дн.», «через 5 дн.» */
export function relativeDay(at: Date, now = new Date()): string {
  const d = dayDiff(now, at);
  if (d === 0) return at < now ? "сегодня, время прошло" : "сегодня";
  if (d === 1) return "завтра";
  if (d < 0) return `просрочено на ${-d} дн.`;
  return `через ${d} дн.`;
}

export function followUpNotice(fu: FollowUp, now = new Date()): { text: string; inline_keyboard: InlineButton[][] } {
  const at = fu.task.deadlineAt;
  const o = fu.outreach;
  const lines = [
    "⏰ <b>FOLLOW-UP</b>",
    "━━━━━━━━━━━━━━",
    `🏢 <b>${e(fu.lead.name)}</b>`,
    "",
    `Написали: <b>${o?.sentAt ? formatDay(o.sentAt) : "—"}</b>${o?.sentAt ? ` · ${CHANNEL_EMOJI[o.channel]} ${e(o.recipient ?? "")}` : ""}`,
    `Следующее действие: <b>${formatDayTime(at)}</b> · ${relativeDay(at, now)}`,
    `Статус лида: ${statusText(fu.lead.status)}`,
  ];
  if (o?.subject) lines.push(`Тема: ${e(o.subject)}`);
  if (fu.task.status === "DONE") lines.push("", "✅ Закрыт");
  const keyboard: InlineButton[][] = [[{ text: "👀 Открыть лид", callback_data: `ld:ol:a:${fu.leadId}` }]];
  if (fu.task.status !== "DONE") {
    keyboard.push([
      { text: "⏰ Отложить", callback_data: `os:fz:${fu.taskId}` },
      { text: "✅ Закрыть", callback_data: `os:fc:${fu.taskId}` },
    ]);
  }
  return { text: lines.join("\n"), inline_keyboard: keyboard };
}
