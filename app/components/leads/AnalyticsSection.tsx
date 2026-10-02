"use client";

// Раздел «📊 Аналитика»: воронка и коэффициенты по реальным данным за всё
// время / 7 / 30 дней, средний чек и потенциальный оборот, источники.

import { useEffect, useState } from "react";
import * as leadsApi from "@/lib/leads-api";
import { useWorkspace } from "@/lib/workspace-context";
import type { AnalyticsDTO, LeadsMetaDTO } from "@/types/leads";
import { formatMoney, parseMoney, pct } from "./format";
import { SenderForm } from "./SenderForm";

interface Props {
  meta: LeadsMetaDTO | null;
  onMeta: (m: LeadsMetaDTO) => void;
  reloadKey: number;
}

export function AnalyticsSection({ meta, onMeta, reloadKey }: Props) {
  const { showToast } = useWorkspace();
  const [period, setPeriod] = useState<0 | 7 | 30>(0);
  const [a, setA] = useState<AnalyticsDTO | null>(null);
  const [avgInput, setAvgInput] = useState("");

  useEffect(() => {
    let cancelled = false;
    leadsApi
      .getAnalytics(period)
      .then((r) => {
        if (cancelled) return;
        setA(r.analytics);
        setAvgInput((v) => v || String(r.analytics.avgCheck));
      })
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, [period, reloadKey]);

  async function saveAvg() {
    const value = parseMoney(avgInput);
    if (!value) return showToast("Не понял сумму — например, 50000");
    const fresh = await leadsApi.setAvgCheck(value).catch(() => null);
    if (!fresh) return showToast("Не удалось сохранить");
    onMeta(fresh);
    setA((cur) => (cur ? { ...cur, avgCheck: value } : cur));
    setAvgInput(String(value));
    showToast("Средний чек сохранён");
  }

  const cells: [string, number | undefined][] = [
    ["Всего лидов", a?.total],
    ["🔎 Найдено", a?.found],
    ["❤️ Сохранено", a?.saved],
    ["📨 Связались", a?.contacted],
    ["👀 Ответили", a?.replied],
    ["💬 Переговоры", a?.negotiation],
    ["🤝 Клиенты", a?.clients],
    ["❌ Отказы", a?.rejected],
  ];
  const rates: [string, number | null | undefined, string][] = [
    ["Contact rate", a?.rates.contact, "связались из всех лидов"],
    ["Reply rate", a?.rates.reply, "ответили из связавшихся"],
    ["Conversion", a?.rates.conversion, "клиенты из связавшихся"],
  ];

  return (
    <>
      <div className="seg" style={{ marginTop: 12 }}>
        {([0, 7, 30] as const).map((p) => (
          <button key={p} className={period === p ? "active" : ""} onClick={() => setPeriod(p)}>
            {p === 0 ? "Всё время" : `${p} дней`}
          </button>
        ))}
      </div>

      <div className="rate-grid">
        {rates.map(([label, value, sub]) => (
          <div key={label} className="rate">
            <div className={`n${value === null ? " none" : ""}`}>{value === undefined ? "…" : pct(value)}</div>
            <div className="cap">{label}</div>
            <div className="sub">{sub}</div>
          </div>
        ))}
      </div>

      <div className="stat-grid">
        {cells.map(([label, n]) => (
          <div key={label} className="stat-cell">
            <div className="n">{n ?? "—"}</div>
            <div className="cap">{label}</div>
          </div>
        ))}
      </div>

      {a && (
        <div className="panel">
          <div className="kv">
            <div className="k">📨 Outreach {a.period ? `за ${a.period} дней` : "за всё время"}</div>
            <div className="v">
              Подготовлено <b>{a.outreach.drafted}</b> · отправлено <b>{a.outreach.sent}</b> · ответов <b>{a.outreach.replies}</b>
            </div>
          </div>
          <div className="kv">
            <div className="k">Средний чек</div>
            <div className="money-row field" style={{ marginBottom: 0 }}>
              <input type="text" inputMode="numeric" value={avgInput} onChange={(e) => setAvgInput(e.target.value)} />
              <button className="secondary-btn" onClick={saveAvg}>
                Сохранить
              </button>
            </div>
          </div>
          <div className="kv">
            <div className="k">💰 Потенциальный оборот</div>
            <div className="v">
              <b style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 460 }}>{formatMoney(a.clients * a.avgCheck)}</b>
              <div style={{ color: "var(--ink-faint)", fontSize: 11.5, marginTop: 4 }}>
                {a.clients} × {formatMoney(a.avgCheck)}. Это расчёт по введённому среднему чеку, а не гарантированный доход.
              </div>
            </div>
          </div>
        </div>
      )}

      <SenderForm sender={meta?.sender ?? null} onSaved={onMeta} />

      {meta && (
        <div className="note info">
          «—» — пока не из чего считать. Источник: OpenStreetMap — {meta.osm ? meta.osmStatus : "выключен"}
          {meta.yandex ? "; 🧪 Яндекс Карты — подключены для теста" : ""}. Тексты: {meta.proposalLabel}.
          {"\n"}Данные карт © участники OpenStreetMap (ODbL).
        </div>
      )}
    </>
  );
}
