"use client";

import { useWorkspace } from "@/lib/workspace-context";

export function Toasts() {
  const { toasts } = useWorkspace();
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div className="toast show" key={t.id}>
          <span className="tdot" />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
