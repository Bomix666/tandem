const API_BASE = "https://api.telegram.org";

export async function sendTelegramMessage(telegramId: bigint | number, text: string, openAppButton = true) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const body: Record<string, unknown> = {
    chat_id: telegramId.toString(),
    text,
    parse_mode: "HTML",
  };

  if (openAppButton && process.env.TELEGRAM_WEBAPP_URL) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "Open Tandem", web_app: { url: process.env.TELEGRAM_WEBAPP_URL } }]],
    };
  }

  const res = await fetch(`${API_BASE}/bot${token}/sendMessage`, {
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
