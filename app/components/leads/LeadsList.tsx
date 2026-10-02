"use client";

import { useEffect, useState } from "react";
import * as leadsApi from "@/lib/leads-api";
import type { LeadDTO, LeadFilterDTO, LeadsStatsDTO } from "@/types/leads";
import { LeadCard } from "./LeadCard";

const FILTERS: { key: LeadFilterDTO; label: string; count?: (s: LeadsStatsDTO) => number }[] = [
  { key: "a", label: "Все", count: (s) => s.total },
  { key: "h", label: "🔥 Горячие" },
  { key: "f", label: "❤️ Сохранённые", count: (s) => s.saved },
  { key: "d", label: "🔎 Найденные", count: (s) => s.byStatus.FOUND ?? 0 },
  { key: "n", label: "🆕 Новые", count: (s) => s.byStatus.NEW ?? 0 },
  { key: "t", label: "📩 Связаться", count: (s) => s.byStatus.TO_CONTACT ?? 0 },
  { key: "w", label: "⏳ Ждут ответа", count: (s) => (s.byStatus.CONTACTED ?? 0) + (s.byStatus.WAITING ?? 0) },
  { key: "g", label: "💬 Переговоры", count: (s) => s.byStatus.NEGOTIATION ?? 0 },
  { key: "c", label: "🤝 Клиенты", count: (s) => s.byStatus.CLIENT ?? 0 },
  { key: "r", label: "❌ Отказы", count: (s) => (s.byStatus.REJECTED ?? 0) + (s.byStatus.NOT_FIT ?? 0) },
];

interface Props {
  stats: LeadsStatsDTO | null;
  filter: LeadFilterDTO;
  onFilter: (f: LeadFilterDTO) => void;
  /** Меняется, когда лиды могли измениться (закончился поиск и т. п.) — список перезагружается. */
  reloadKey: number;
  view: (lead: LeadDTO) => LeadDTO;
  onOpen: (ids: string[], index: number) => void;
}

export function LeadsList({ stats, filter, onFilter: setFilter, reloadKey, view, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    leadsApi
      .listLeads(filter, debounced, 0)
      .then((r) => {
        if (cancelled) return;
        setLeads(r.leads);
        setTotal(r.total);
        setPage(0);
      })
      .catch(() => void 0)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filter, debounced, reloadKey]);

  async function loadMore() {
    const r = await leadsApi.listLeads(filter, debounced, page + 1).catch(() => null);
    if (!r) return;
    setLeads((prev) => [...prev, ...r.leads]);
    setPage(page + 1);
  }

  const shown = leads.map(view);
  return (
    <>
      <div className="searchbar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input type="text" placeholder="Поиск по названию" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="chiprow scroll">
        {FILTERS.map((f) => (
          <div key={f.key} className={`pickchip${filter === f.key ? " active" : ""}`} onClick={() => setFilter(f.key)}>
            {f.label}
            {stats && f.count && <span className="cnt">{f.count(stats)}</span>}
          </div>
        ))}
      </div>
      <div className="section-head" style={{ marginTop: 18 }}>
        <div className="title">{filter === "a" ? "Все лиды" : FILTERS.find((f) => f.key === filter)!.label}</div>
        <div className="count">{loading ? "…" : `${total} всего`}</div>
      </div>
      <div className="task-list stagger">
        {!loading && shown.length === 0 && (
          <div className="empty">
            <div className="headline serif">{debounced || filter !== "a" ? "Ничего не найдено" : "Лидов пока нет"}</div>
            <div className="sub">{debounced || filter !== "a" ? "Попробуйте другой фильтр или запрос." : "Запустите поиск клиентов — найденные бизнесы появятся здесь."}</div>
          </div>
        )}
        {shown.map((l, i) => (
          <LeadCard key={l.id} lead={l} onOpen={() => onOpen(shown.map((x) => x.id), i)} />
        ))}
      </div>
      {shown.length < total && (
        <button className="ghost-btn" onClick={loadMore}>
          Показать ещё
        </button>
      )}
    </>
  );
}
