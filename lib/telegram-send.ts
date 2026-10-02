// TELEGRAM_API_ROOT — свой Bot API (или тестовый стенд), как у бота.
const apiBase = () => (process.env.TELEGRAM_API_ROOT?.trim() || "https://api.telegram.org").replace(/\/$/, "");

/**
 * `openAppButton` — кнопка «Open Tandem» (по умолчанию) или свои inline-кнопки
 * (`{ inlineKeyboard }`, например у напоминания ⏰ FOLLOW-UP).
 */
export async function sendTelegramMessage(
  telegramId: bigint | number,
  text: string,
  openAppButton: boolean | { inlineKeyboard: unknown[][] } = true
) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const body: Record<string, unknown> = {
    chat_id: telegramId.toString(),
    text,
    parse_mode: "HTML",
  };

  if (typeof openAppButton === "object") {
    body.reply_markup = { inline_keyboard: openAppButton.inlineKeyboard };
  } else if (openAppButton && process.env.TELEGRAM_WEBAPP_URL) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "Open Tandem", web_app: { url: process.env.TELEGRAM_WEBAPP_URL } }]],
    };
  }

  const res = await fetch(`${apiBase()}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Telegram sendMessage failed: ${res.status} ${errText}`);
  }

  return res.json();
}
