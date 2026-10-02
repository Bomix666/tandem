"use client";

// Вкладка «Клиенты» — Sales OS в Mini App: дашборд (сегодня, ближайшее
// действие, воронка), поиск, разделы Лиды · Outreach · Follow-up · Аналитика ·
// История, карточка лида и редактор обращения. Данные общие с ботом и с
// партнёром по пространству; логика — lib/leads, API — /api/leads/*.

import { useCallback, useEffect, useState } from "react";
import * as leadsApi from "@/lib/leads-api";
import type { DashboardDTO, LeadDTO, LeadFilterDTO, LeadSearchDTO, LeadsMetaDTO, OutreachStatusDTO } from "@/types/leads";
import { AnalyticsSection } from "./AnalyticsSection";
import { FollowUpsSection } from "./FollowUpsSection";
import { LeadCard } from "./LeadCard";
import { LeadDetailSheet } from "./LeadDetailSheet";
import { LeadsHistory } from "./LeadsHistory";
import { LeadsList } from "./LeadsList";
import { OutreachSection } from "./OutreachSection";
import { OutreachSheet } from "./OutreachSheet";
import { SalesHome, type SalesTarget } from "./SalesHome";
import { SearchPanel, useSearch } from "./SearchPanel";
import { SearchSheet } from "./SearchSheet";

type Tab = "leads" | "outreach" | "followups" | "stats" | "history";

export function LeadsView({ searchOpen, onSearchOpenChange }: { searchOpen: boolean; onSearchOpenChange: (open: boolean) => void }) {
  const [meta, setMeta] = useState<LeadsMetaDTO | null>(null);
  const [dashboard, setDashboard] = useState<DashboardDTO | null>(null);
  const [tab, setTab] = useState<Tab>("leads");
  const [filter, setFilter] = useState<LeadFilterDTO>("a");
  const [outreachStatus, setOutreachStatus] = useState<OutreachStatusDTO>("DRAFT");
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const [resultsSearchId, setResultsSearchId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ ids: string[]; index: number } | null>(null);
  const [outreachId, setOutreachId] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, LeadDTO>>({});
  const [reloadKey, setReloadKey] = useState(0);

  const loadMeta = useCallback(async () => {
    const [m, d] = await Promise.all([leadsApi.getLeadsMeta().catch(() => null), leadsApi.getDashboard().catch(() => null)]);
    if (d) setDashboard(d.dashboard);
    if (!m) return;
    setMeta(m);
    // поиск, запущенный партнёром или из бота, тоже показываем
    if (m.activeSearch) setActiveSearchId((cur) => cur ?? m.activeSearch!.id);
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta, reloadKey]);

  /** Что-то изменилось (поиск, письмо, follow-up, статус) — обновить дашборд и списки. */
  const changed = useCallback(() => setReloadKey((k) => k + 1), []);

  const active = useSearch(activeSearchId, changed);
  const results = useSearch(resultsSearchId, changed);

  const view = (lead: LeadDTO) => overrides[lead.id] ?? lead;
  const openDetail = (ids: string[], index: number) => setDetail({ ids, index });
  const openLead = (leadId: string) => setDetail({ ids: [leadId], index: 0 });
  const startedSearch = (s: LeadSearchDTO) => {
    setResultsSearchId(null);
    setActiveSearchId(s.id);
    changed();
  };

  function go(t: SalesTarget) {
    switch (t.kind) {
      case "filter":
        setFilter(t.filter);
        setTab("leads");
        break;
      case "outreach":
        setOutreachStatus(t.status);
        setTab("outreach");
        break;
      case "followups":
        setTab("followups");
        break;
      case "lead":
        openLead(t.leadId);
        break;
      case "outreachItem":
        setOutreachId(t.outreachId);
        break;
      case "search":
        onSearchOpenChange(true);
        break;
    }
  }

  const fuBadge = dashboard ? dashboard.followUps.overdue + dashboard.followUps.today : 0;
  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "leads", label: "Лиды" },
    { key: "outreach", label: "Outreach" },
    { key: "followups", label: "Follow-up", badge: fuBadge },
    { key: "stats", label: "Аналитика" },
    { key: "history", label: "История" },
  ];

  return (
    <div className="section">
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
          <SalesHome dashboard={dashboard} onGo={go} />

          {activeSearchId ? (
            <SearchPanel
              search={active?.search ?? null}
              onOpenResults={() => setResultsSearchId(activeSearchId)}
              onRelaunched={startedSearch}
              onDismiss={active?.search.status === "RUNNING" ? undefined : () => setActiveSearchId(null)}
            />
          ) : (
            <button className="primary-btn" style={{ marginTop: 12 }} onClick={() => onSearchOpenChange(true)}>
              🔎 Найти клиентов
            </button>
          )}
          {meta && !meta.osm && <div className="note warn">⚠️ OpenStreetMap выключен (LEADS_OSM_ENABLED=false).</div>}

          <div className="seg scroll">
            {tabs.map((t) => (
              <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
                {t.label}
                {t.badge ? <span className="cnt">{t.badge}</span> : null}
              </button>
            ))}
          </div>

          {tab === "leads" && <LeadsList stats={meta?.stats ?? null} filter={filter} onFilter={setFilter} reloadKey={reloadKey} view={view} onOpen={openDetail} />}
          {tab === "outreach" && <OutreachSection status={outreachStatus} onStatus={setOutreachStatus} reloadKey={reloadKey} onOpen={setOutreachId} />}
          {tab === "followups" && <FollowUpsSection reloadKey={reloadKey} onOpenLead={openLead} onChanged={changed} />}
          {tab === "stats" && <AnalyticsSection meta={meta} onMeta={setMeta} reloadKey={reloadKey} />}
          {tab === "history" && <LeadsHistory reloadKey={reloadKey} onOpen={setResultsSearchId} />}
        </>
      )}

      <SearchSheet open={searchOpen} meta={meta} onClose={() => onSearchOpenChange(false)} onStarted={startedSearch} />
      <LeadDetailSheet
        ids={detail?.ids ?? []}
        index={detail?.index ?? null}
        refreshKey={reloadKey}
        onNavigate={(index) => setDetail((d) => (d ? { ...d, index } : d))}
        onClose={() => setDetail(null)}
        onChanged={(lead) => {
          setOverrides((o) => ({ ...o, [lead.id]: lead }));
          void loadMeta();
        }}
        onOpenOutreach={setOutreachId}
      />
      <OutreachSheet
        outreachId={outreachId}
        onClose={() => setOutreachId(null)}
        onChanged={changed}
        onOpenLead={(leadId) => {
          setOutreachId(null);
          openLead(leadId);
        }}
        sender={meta?.sender ?? null}
        onSenderSaved={setMeta}
      />
    </div>
  );
}
