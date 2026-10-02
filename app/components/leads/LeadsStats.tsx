"use client";

import { useState } from "react";
import { LEAD_STATUS_EMOJI, LEAD_STATUS_LABELS, LEAD_STATUS_ORDER } from "@/lib/leads/labels";
import * as leadsApi from "@/lib/leads-api";
import { useWorkspace } from "@/lib/workspace-context";
import type { LeadsMetaDTO } from "@/types/leads";
import { formatMoney, parseMoney } from "./format";

export function LeadsStats({ meta, onMeta }: { meta: LeadsMetaDTO; onMeta: (m: LeadsMetaDTO) => void }) {
  const { showToast } = useWorkspace();
  const s = meta.stats;
  const clients = s.byStatus.CLIENT ?? 0;
  const [avgInput, setAvgInput] = useState(String(s.avgCheck));

  async function saveAvg() {
    const value = parseMoney(avgInput);
    if (!value) return showToast("Не понял сумму — например, 50000");
    const fresh = await leadsApi.setAvgCheck(value).catch(() => null);
    if (!fresh) return showToast("Не удалось сохранить");
    onMeta(fresh);
    setAvgInput(String(value));
    showToast("Средний чек сохранён");
  }

  const pct = s.total ? ((clients / s.total) * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) : "0";
  return (
    <>
      <div className="stat-grid">
        {LEAD_STATUS_ORDER.map((st) => (
          <div key={st} className="stat-cell">
            <div className="n">{s.byStatus[st] ?? 0}</div>
            <div className="cap">
              {LEAD_STATUS_EMOJI[st]} {LEAD_STATUS_LABELS[st]}
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="kv">
          <div className="k">Конверсия в клиента</div>
          <div className="v">
            <b>
              {clients} / {s.total}
            </b>{" "}
            <span style={{ color: "var(--ink-dim)" }}>({pct}%)</span>
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
            <b style={{ fontFamily: "Fraunces, serif", fontSize: 22, fontWeight: 460 }}>{formatMoney(clients * s.avgCheck)}</b>
            <div style={{ color: "var(--ink-faint)", fontSize: 11.5, marginTop: 4 }}>
              {clients} {clients === 1 ? "клиент" : "клиентов"} × {formatMoney(s.avgCheck)}. Это расчёт по введённому среднему чеку, а не гарантированный доход.
            </div>
          </div>
        </div>
        <div className="kv">
          <div className="k">Всего</div>
          <div className="v">
            Лидов: {s.total} · сохранённых: {s.saved} · поисков: {s.searches}
          </div>
        </div>
      </div>

      <div className="note info">
        Источник: OpenStreetMap — {meta.osm ? meta.osmStatus : "выключен"}
        {meta.yandex ? "; 🧪 Яндекс Карты — подключены для теста" : ""}. Тексты предложений: {meta.proposalLabel}.
        {"\n"}Данные карт © участники OpenStreetMap (ODbL).
      </div>
    </>
  );
}
