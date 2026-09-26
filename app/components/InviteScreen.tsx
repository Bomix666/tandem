"use client";

import { useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { openTelegramLink, haptic, isDevMode } from "@/lib/telegram-client";

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
// Короткое имя Mini App из BotFather (/newapp, ссылка t.me/<бот>/<app>).
// Ссылка t.me/<бот>?startapp=… открывает приложение только у бота с
// "главным" Mini App; для приложения, созданного через /newapp, нужна
// прямая ссылка t.me/<бот>/<app>?startapp=…, иначе Telegram откроет чат с
// ботом и start_param до приложения не дойдёт (друг не вступит в пространство).
const APP_SHORT_NAME = process.env.NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME;

export function InviteScreen() {
  const { workspace, showToast } = useWorkspace();
  const [copied, setCopied] = useState(false);

  const memberCount = workspace?.members.length ?? 1;
  const inviteToken = workspace?.inviteToken;

  const telegramLink =
    inviteToken && BOT_USERNAME
      ? `https://t.me/${BOT_USERNAME}${APP_SHORT_NAME ? `/${APP_SHORT_NAME}` : ""}?startapp=invite_${inviteToken}`
      : null;
  // Вне настоящего Telegram (или пока бот не настроен) даём прямую ссылку
  // на это же приложение с тем же параметром — второй человек (или вторая
  // вкладка браузера при локальном тестировании) открывает её и
  // присоединяется тем же путём, что и через реальный Telegram-диплинк.
  const localLink =
    !telegramLink && inviteToken && typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}?devUser=2&startapp=invite_${inviteToken}`
      : null;
  const link = telegramLink ?? localLink;

  async function handleInvite() {
    haptic("medium");
    if (!link) {
      showToast("Ссылка ещё не готова");
      return;
    }
    if (telegramLink) openTelegramLink(telegramLink);
    else await handleCopy();
  }

  async function handleCopy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      showToast("Ссылка скопирована");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Не удалось скопировать");
    }
  }

  return (
    <div className="section" style={{ paddingTop: 48, textAlign: "center" }}>
      <div className="wordmark" style={{ justifyContent: "center", marginBottom: 28 }}>
        <span className="dot" />
        <span className="name">Tandem</span>
      </div>

      <div className="serif" style={{ fontSize: 20, marginBottom: 6 }}>
        Ваше приватное пространство
      </div>
      <div className="label" style={{ marginBottom: 32 }}>
        {memberCount} / 2 участника
      </div>

      <div style={{ background: "var(--bg-1)", border: "1px solid var(--line)", borderRadius: "var(--radius-l)", padding: "28px 20px", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.6, marginBottom: 20 }}>
          Tandem рассчитан ровно на двоих. Пригласите человека, с которым будете
          делить задачи — как только он откроет ссылку, пространство станет общим.
        </div>

        {localLink && isDevMode() && (
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-faint)",
              lineHeight: 1.5,
              marginBottom: 14,
              padding: "10px 12px",
              background: "var(--bg-2)",
              borderRadius: "var(--radius-s)",
              textAlign: "left",
              wordBreak: "break-all",
            }}
          >
            Режим разработки — бот не настроен. Скопируйте ссылку и откройте
            её в новом окне браузера, чтобы протестировать как второй
            участник: {link}
          </div>
        )}

        <button className="primary-btn" onClick={handleInvite}>
          {telegramLink ? "Пригласить друга" : "Скопировать ссылку приглашения"}
        </button>
        {telegramLink && (
          <button className="ghost-btn" onClick={handleCopy}>
            {copied ? "Скопировано" : "Скопировать ссылку"}
          </button>
        )}
      </div>

      <div className="label" style={{ color: "var(--ink-faint)" }}>
        Ожидаем второго участника…
      </div>
    </div>
  );
}
