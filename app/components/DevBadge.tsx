"use client";

import { useEffect, useState } from "react";
import { isDevMode, getDevUserId } from "@/lib/telegram-client";

export function DevBadge() {
  // Рендерим только после монтирования: id пользователя берётся из URL /
  // sessionStorage, которых на сервере нет, иначе будет hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !isDevMode()) return null;
  const uid = getDevUserId();
  const otherUid = uid === "1" ? "2" : "1";

  return (
    <div
      style={{
        position: "absolute",
        top: "calc(var(--safe-top) + 8px)",
        right: 10,
        zIndex: 50,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: ".03em",
        color: "var(--ink-faint)",
        background: "var(--bg-2)",
        border: "1px solid var(--line)",
        borderRadius: 100,
        padding: "4px 9px",
        pointerEvents: "none",
      }}
    >
      DEV · пользователь {uid} · вторая вкладка: ?devUser={otherUid}
    </div>
  );
}
