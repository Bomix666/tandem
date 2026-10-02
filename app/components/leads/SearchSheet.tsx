"use client";

import { useState } from "react";
import { describeRequirements, parseRequirements } from "@/lib/leads/requirements";
import * as leadsApi from "@/lib/leads-api";
import { haptic } from "@/lib/telegram-client";
import { useWorkspace } from "@/lib/workspace-context";
import type { LeadSearchDTO, LeadsMetaDTO } from "@/types/leads";

const COUNTS = [5, 10, 20, 30];
const EXTRA_CHIPS = ["Только без сайта", "Без современного сайта", "Нужен телефон", "Нужны соцсети"];

interface Props {
  open: boolean;
  meta: LeadsMetaDTO | null;
  onClose: () => void;
  onStarted: (search: LeadSearchDTO) => void;
}

export function SearchSheet({ open, meta, onClose, onStarted }: Props) {
  const { showToast } = useWorkspace();
  const [niche, setNiche] = useState("");
  const [city, setCity] = useState("");
  const [count, setCount] = useState(10);
  const [extraChips, setExtraChips] = useState<string[]>([]);
  const [extraText, setExtraText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const extra = [...extraChips, extraText.trim()].filter(Boolean).join(", ");
  const understood = describeRequirements(parseRequirements(extra));
  const yandex = meta?.yandex ?? false;
  const osm = meta?.osm ?? true;

  function toggleExtra(chip: string) {
    setExtraChips((prev) => (prev.includes(chip) ? prev.filter((c) => c !== chip) : [...prev, chip]));
  }

  async function start(source: "osm" | "yandex") {
    if (niche.trim().length < 2) return showToast("Укажите нишу");
    if (city.trim().length < 2) return showToast("Укажите город");
    haptic("medium");
    setSubmitting(true);
    try {
      const search = await leadsApi.startSearch({ niche: niche.trim(), city: city.trim(), requested: count, extra: extra || null, source });
      onStarted(search);
      onClose();
    } catch (err) {
      const reason = err instanceof leadsApi.SearchStartError ? err.reason : "other";
      showToast(reason === "busy" ? "Поиск уже идёт — дождитесь результата" : reason === "not_configured" ? "Поиск по Яндексу не настроен" : "Не удалось запустить поиск");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className={`scrim${open ? " show" : ""}`} onClick={onClose} />
      <div className={`sheet${open ? " show" : ""}`}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div className="htitle">Поиск клиентов</div>
          <button className="iconbtn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label className="flabel label">Ниша</label>
            <div className="chiprow">
              {(meta?.niches ?? []).map((n) => (
                <div key={n} className={`pickchip${niche === n ? " active" : ""}`} onClick={() => setNiche(n)}>
                  {n}
                </div>
              ))}
            </div>
            <input type="text" style={{ marginTop: 8 }} placeholder="Или своя ниша: автомойки, ветклиники…" value={niche} onChange={(e) => setNiche(e.target.value)} maxLength={60} />
          </div>

          <div className="field">
            <label className="flabel label">Город</label>
            <div className="chiprow">
              {(meta?.cities ?? []).map((c) => (
                <div key={c} className={`pickchip${city === c ? " active" : ""}`} onClick={() => setCity(c)}>
                  {c}
                </div>
              ))}
            </div>
            <input type="text" style={{ marginTop: 8 }} placeholder="Или другой город" value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} />
          </div>

          <div className="field">
            <label className="flabel label">Сколько лидов найти</label>
            <div className="chiprow">
              {COUNTS.map((n) => (
                <div key={n} className={`pickchip${count === n ? " active" : ""}`} onClick={() => setCount(n)}>
                  {n}
                </div>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="flabel label">Дополнительно</label>
            <div className="chiprow">
              {EXTRA_CHIPS.map((c) => (
                <div key={c} className={`pickchip${extraChips.includes(c) ? " active" : ""}`} onClick={() => toggleExtra(c)}>
                  {c}
                </div>
              ))}
            </div>
            <textarea style={{ marginTop: 8 }} placeholder="Например: небольшие локальные бизнесы без современного сайта" value={extraText} onChange={(e) => setExtraText(e.target.value)} maxLength={300} />
            {extra &&
              (understood.length ? (
                <div className="note info">Учту: {understood.join("; ")}.</div>
              ) : (
                <div className="note info">Не распознано как фильтр — сохраню в истории, но отбирать по нему не смогу.</div>
              ))}
          </div>

          {osm ? (
            <div className="note info" style={{ marginTop: 0 }}>
              Источник: OpenStreetMap — вся Россия, любой город или регион. Сайты проверяются автоматически, email ищется на сайтах компаний.
            </div>
          ) : (
            <div className="note warn" style={{ marginTop: 0 }}>
              OpenStreetMap выключен (LEADS_OSM_ENABLED=false).
            </div>
          )}
          {osm && (
            <button className="primary-btn" style={{ marginTop: 14 }} onClick={() => start("osm")} disabled={submitting}>
              {submitting ? "Запускаю…" : "🔎 Начать поиск"}
            </button>
          )}
          {yandex && (
            <button className="ghost-btn" onClick={() => start("yandex")} disabled={submitting}>
              🧪 Искать через Яндекс (тест)
            </button>
          )}
        </div>
      </div>
    </>
  );
}
