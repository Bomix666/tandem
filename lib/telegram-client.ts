"use client";

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        ready: () => void;
        expand: () => void;
        initData: string;
        initDataUnsafe: { user?: { id: number; first_name: string; username?: string }; start_param?: string };
        colorScheme: "light" | "dark";
        themeParams: Record<string, string>;
        BackButton: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
        HapticFeedback: {
          impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
          notificationOccurred: (type: "error" | "success" | "warning") => void;
        };
        openTelegramLink?: (url: string) => void;
        close: () => void;
      };
    };
  }
}

export function initTelegramWebApp() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return null;
  tg.ready();
  tg.expand();
  return tg;
}

export function getInitData(): string {
  if (typeof window === "undefined") return "";
  return window.Telegram?.WebApp?.initData ?? "";
}

/**
 * Dev-only: возвращает id "виртуального" пользователя для локального
 * тестирования без Telegram. Читается из ?devUser=N в URL и запоминается
 * в sessionStorage (не localStorage — он общий между вкладками одного
 * браузера и вкладка B перезаписала бы значение вкладки A при перезагрузке;
 * sessionStorage у каждой вкладки свой). Открой приложение в одной вкладке
 * как обычно (пользователь "1"), а во второй — с адресом ?devUser=2, чтобы
 * протестировать двух участников одновременно. На бэкенде это работает
 * только при ALLOW_DEV_AUTH=true (см. lib/telegram-auth.ts) — внутри
 * настоящего Telegram эта функция не используется вовсе, потому что
 * getInitData() там не пустая.
 */
export function getDevUserId(): string {
  if (typeof window === "undefined") return "1";
  const fromQuery = new URLSearchParams(window.location.search).get("devUser");
  if (fromQuery) {
    try {
      sessionStorage.setItem("tandem_dev_user", fromQuery);
    } catch {
      /* sessionStorage может быть недоступен (приватный режим) — не критично */
    }
    return fromQuery;
  }
  try {
    return sessionStorage.getItem("tandem_dev_user") || "1";
  } catch {
    return "1";
  }
}

export function isDevMode(): boolean {
  return !getInitData();
}

export function getStartParam(): string | null {
  const fromTelegram = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
  if (fromTelegram) return fromTelegram;
  // Вне настоящего Telegram (локальная разработка) читаем тот же параметр
  // напрямую из URL, чтобы можно было протестировать флоу приглашения:
  // ?devUser=2&startapp=invite_<token>
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("startapp");
}

/**
 * Открывает t.me-ссылку через нативный обработчик Telegram, если он
 * доступен (внутри Mini App), иначе — обычным способом (для тестирования
 * в браузере вне Telegram).
 */
export function openTelegramLink(url: string) {
  const tg = window.Telegram?.WebApp;
  if (tg?.openTelegramLink) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}

export function haptic(style: "light" | "medium" | "heavy" = "light") {
  window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
}

export function hapticSuccess() {
  window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred("success");
}

/**
 * fetch() wrapper used by every API call: attaches the Telegram initData
 * header the backend validates in lib/telegram-auth.ts, and normalizes
 * error responses into thrown Errors with the server's message.
 */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": getInitData(),
      "X-Dev-User-Id": getDevUserId(), // backend only honors this when ALLOW_DEV_AUTH=true
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Request failed (${res.status})`);
  }

  return res.json();
}
