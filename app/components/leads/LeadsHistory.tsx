"use client";

import { useEffect, useState } from "react";
import * as leadsApi from "@/lib/leads-api";
import type { LeadSearchDTO } from "@/types/leads";
import { formatDate, leadsWord } from "./format";

export function LeadsHistory({ reloadKey, onOpen }: { reloadKey: number; onOpen: (searchId: string) => void }) {
  const [searches, setSearches] = useState<LeadSearchDTO[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    leadsApi
      .listSearches()
      .then((r) => !cancelled && setSearches(r.searches))
      .catch(() => !cancelled && setSearches([]));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (searches === null) return <div className="label" style={{ marginTop: 20 }}>Загрузка…</div>;
  if (searches.length === 0) {
    return (
      <div className="empty">
        <div className="headline serif">Поисков пока не было</div>
        <div className="sub">История появится после первого поиска клиентов.</div>
      </div>
    );
  }

  return (
    <div className="task-list stagger" style={{ marginTop: 16 }}>
      {searches.map((s) => (
        <div key={s.id} className="history-item" onClick={() => onOpen(s.id)}>
          <div className="hdate">{formatDate(s.createdAt)}</div>
          <div className="hmain">
            <div className="htitle">
              {s.niche} — {s.city}
            </div>
            <div className="hsub">
              {s.status === "RUNNING" ? "⏳ идёт поиск…" : s.status === "FAILED" ? "⚠️ не выполнен" : leadsWord(s.found)}
              {s.parentId ? " · найти ещё" : ""}
              {s.osmOnly ? " · только OSM" : ""}
            </div>
          </div>
          <div className="hcount">{s.status === "DONE" ? s.found : ""}</div>
        </div>
      ))}
    </div>
  );
}
