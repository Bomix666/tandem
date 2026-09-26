"use client";

import { getInitData, getDevUserId } from "./telegram-client";

/**
 * Подключается к /api/stream и вызывает onEvent при любом realtime-событии
 * рабочего пространства. EventSource сам переподключается при обрыве —
 * логику ретраев писать не нужно, достаточно вернуть cleanup-функцию.
 */
export function subscribeRealtime(onEvent: () => void): () => void {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return () => void 0;
  }

  const initData = encodeURIComponent(getInitData());
  const devUserId = encodeURIComponent(getDevUserId());
  const es = new EventSource(`/api/stream?initData=${initData}&devUserId=${devUserId}`);

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === "connected") return;
      onEvent();
    } catch {
      /* игнорируем некорректные события */
    }
  };

  return () => es.close();
}
