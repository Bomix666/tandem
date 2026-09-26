"use client";

// Раздел «Клиенты» в Mini App: поиск потенциальных клиентов на разработку
// сайтов → лиды → предложение → задача → статусы. Данные общие с ботом и
// с партнёром по пространству; логика поиска — lib/leads, API — /api/leads/*.

import { useCallback, useEffect, useState } from "react";
import * as leadsApi from "@/lib/leads-api";
import type { LeadDTO, LeadSearchDTO, LeadsMetaDTO } from "@/types/leads";
import { formatMoneyShort } from "./format";
import { LeadCard } from "./LeadCard";
import { LeadDetailSheet } from "./LeadDetailSheet";
import { LeadsHistory } from "./LeadsHistory";
import { LeadsList } from "./LeadsList";
import { LeadsStats } from "./LeadsStats";
import { SearchPanel, useSearch } from "./SearchPanel";
import { SearchSheet } from "./SearchSheet";

type Tab = "leads" | "history" | "stats";

export function LeadsView({ searchOpen, onSearchOpenChange }: { searchOpen: boolean; onSearchOpenChange: (open: boolean) => void }) {
  const [meta, setMeta] = useState<LeadsMetaDTO | null>(null);
  const [tab, setTab] = useState<Tab>("leads");
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [resultsSearchId, setResultsSearchId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ ids: string[]; index: number } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, LeadDTO>>({});
  const [reloadKey, setReloadKey] = useState(0);

  const loadMeta = useCallback(async () => {
    const m = await leadsApi.getLeadsMeta().catch(() => null);
    if (!m) return;
    setMeta(m);
    // поиск, запущенный партнёром или из бота, тоже показываем
    if (m.activeSearch) setActiveSearchId((cur) => cur ?? m.activeSearch!.id);
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const onSearchFinished = useCallback(() => {
    void loadMeta();
    setReloadKey((k) => k + 1);
  }, [loadMeta]);

  const active = useSearch(activeSearchId, onSearchFinished);
  const results = useSearch(resultsSearchId, onSearchFinished);

  const view = (lead: LeadDTO) => overrides[lead.id] ?? lead;
  const openDetail = (ids: string[], index: number) => setDetail({ ids, index });
  const startedSearch = (s: LeadSearchDTO) => {
    setResultsSearchId(null);
    setActiveSearchId(s.id);
    setReloadKey((k) => k + 1);
  };

  const stats = meta?.stats ?? null;
  const clients = stats?.byStatus.CLIENT ?? 0;

  return (
    <div className="section">
      <div className="summary">
        <div className="cell">
          <div className="num">{stats?.total ?? "—"}</div>
          <div className="cap label">Лидов</div>
        </div>
        <div className="cell">
          <div className="num">{clients}</div>
          <div className="cap label">Клиентов</div>
        </div>
        <div className="cell prog">
          <div className="num" style={{ fontSize: 20, lineHeight: "26px" }}>
            {stats ? formatMoneyShort(clients * stats.avgCheck) : "—"}
          </div>
          <div className="cap label">Потенц. оборот</div>
        </div>
      </div>

      {resultsSearchId ? (
        <>
          <button className="backlink" onClick={() => setResultsSearchId(null)}>
            ← Назад
          </button>
          <SearchPanel search={results?.search ?? null} onRelaunched={startedSearch} fromHistory={results?.search.id !== activeSearchId} />
          <div className="task-list stagger" style={{ marginTop: 14 }}>
            {(results?.leads ?? []).map(view).map((l, i, all) => (
              <LeadCard key={l.id} lead={l} onOpen={() => openDetail(all.map((x) => x.id), i)} />
            ))}
          </div>
        </>
      ) : (
        <>
          {activeSearchId ? (
            <SearchPanel
              search={active?.search ?? null}
              onOpenResults={() => setResultsSearchId(activeSearchId)}
              onRelaunched={startedSearch}
              onDismiss={active?.search.status === "RUNNING" ? undefined : () => setActiveSearchId(null)}
            />
          ) : (
            <div className="cta-card">
              <div className="ctitle">Найти клиентов на сайты</div>
              <div className="csub">
                Небольшие бизнесы без сайта или с устаревшим сайтом — с контактами, оценкой и готовым текстом предложения.
                {meta && !meta.yandex && (
                  <>
                    <br />
                    <span style={{ color: "var(--amber)" }}>⚠️ Яндекс не подключён — пока доступен только поиск по OpenStreetMap.</span>
                  </>
                )}
              </div>
              <button className="primary-btn" onClick={() => onSearchOpenChange(true)}>
                🔎 Найти клиентов
              </button>
            </div>
          )}

          <div className="seg">
            <button className={tab === "leads" ? "active" : ""} onClick={() => setTab("leads")}>
              Мои лиды
            </button>
            <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
              История
            </button>
            <button className={tab === "stats" ? "active" : ""} onClick={() => setTab("stats")}>
              Статистика
            </button>
          </div>

          {tab === "leads" && <LeadsList stats={stats} reloadKey={reloadKey} view={view} onOpen={openDetail} />}
          {tab === "history" && <LeadsHistory reloadKey={reloadKey} onOpen={setResultsSearchId} />}
          {tab === "stats" && meta && <LeadsStats meta={meta} onMeta={setMeta} />}
        </>
      )}

      <SearchSheet open={searchOpen} meta={meta} onClose={() => onSearchOpenChange(false)} onStarted={startedSearch} />
      <LeadDetailSheet
        ids={detail?.ids ?? []}
        index={detail?.index ?? null}
        onNavigate={(index) => setDetail((d) => (d ? { ...d, index } : d))}
        onClose={() => setDetail(null)}
        onChanged={(lead) => {
          setOverrides((o) => ({ ...o, [lead.id]: lead }));
          void loadMeta();
        }}
      />
    </div>
  );
}
