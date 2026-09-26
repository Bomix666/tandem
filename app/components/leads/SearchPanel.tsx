"use client";

import { useEffect, useRef, useState } from "react";
import * as leadsApi from "@/lib/leads-api";
import { haptic } from "@/lib/telegram-client";
import { useWorkspace } from "@/lib/workspace-context";
import type { LeadDTO, LeadSearchDTO } from "@/types/leads";
import { formatDateFull, leadsWord } from "./format";

const POLL_MS = 1500;

/** Опрашивает поиск, пока он идёт; возвращает актуальное состояние и лиды. */
export function useSearch(searchId: string | null, onFinished?: (s: LeadSearchDTO) => void) {
  const [data, setData] = useState<{ search: LeadSearchDTO; leads: LeadDTO[] } | null>(null);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  useEffect(() => {
    setData(null);
    if (!searchId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const fresh = await leadsApi.getSearch(searchId);
        if (cancelled) return;
        setData(fresh);
        if (fresh.search.status === "RUNNING") timer = setTimeout(tick, POLL_MS);
        else finishedRef.current?.(fresh.search);
      } catch {
        if (!cancelled) timer = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchId]);

  return data;
}

interface Props {
  search: LeadSearchDTO | null;
  onOpenResults?: () => void;
  onRelaunched: (search: LeadSearchDTO) => void;
  onDismiss?: () => void;
  fromHistory?: boolean;
}

export function SearchPanel({ search, onOpenResults, onRelaunched, onDismiss, fromHistory }: Props) {
  const { showToast } = useWorkspace();
  const [busy, setBusy] = useState(false);
  if (!search) {
    return (
      <div className="panel running">
        <div className="ptitle">
          <span className="spin" /> Загружаю поиск…
        </div>
      </div>
    );
  }

  async function relaunch(mode: "more" | "retry") {
    haptic("medium");
    setBusy(true);
    try {
      onRelaunched(await leadsApi.startSearch({ fromSearchId: search!.id, mode }));
    } catch (err) {
      const reason = err instanceof leadsApi.SearchStartError ? err.reason : "other";
      showToast(reason === "busy" ? "Поиск уже идёт — дождитесь результата" : reason === "not_configured" ? "Поиск по Яндексу не настроен" : "Не удалось запустить поиск");
    } finally {
      setBusy(false);
    }
  }

  const title = `${search.niche} · ${search.city}${search.parentId ? " · ещё" : ""}${search.osmOnly ? " · только OSM" : ""}`;
  const close = onDismiss && (
    <button className="iconbtn pclose" onClick={onDismiss} aria-label="Скрыть">
      ✕
    </button>
  );

  if (search.status === "RUNNING") {
    const pct = search.requested ? Math.min(100, Math.round((search.found / search.requested) * 100)) : 0;
    return (
      <div className="panel running">
        <div className="ptitle">
          <span className="spin" /> Ищу подходящие бизнесы…
        </div>
        <div className="psub">{title}</div>
        <div className={`pbar${search.checked === 0 ? " indeterminate" : ""}`}>
          <i style={{ width: `${Math.max(pct, 4)}%` }} />
        </div>
        <div className="pstats">
          <span>
            Найдено <b>{search.found}/{search.requested}</b>
          </span>
          <span>
            Проверено <b>{search.checked}</b>
          </span>
          <span>
            Отфильтровано <b>{search.filtered}</b>
          </span>
        </div>
        {search.stage && <div className="pstage">{search.stage}</div>}
        {search.warnings.map((w) => (
          <div key={w} className="note warn">
            {w}
          </div>
        ))}
      </div>
    );
  }

  if (search.status === "FAILED") {
    return (
      <div className="panel">
        <div className="ptitle">
          ⚠️ Поиск не выполнен {close}
        </div>
        <div className="psub">
          {title} · {formatDateFull(search.createdAt)}
        </div>
        <div className="note err">{search.error ?? "Неизвестная ошибка"}</div>
        <button className="primary-btn" style={{ marginTop: 12 }} onClick={() => relaunch("retry")} disabled={busy}>
          🔁 Повторить поиск
        </button>
      </div>
    );
  }

  const b = search.breakdown;
  return (
    <div className="panel">
      <div className="ptitle">
        {fromHistory ? `Поиск от ${formatDateFull(search.createdAt)}` : "✅ Поиск завершён"} {close}
      </div>
      <div className="psub">{title}</div>
      <div className="pstats" style={{ marginTop: 10 }}>
        <span>
          Найдено <b>{search.found}</b> {leadsWord(search.found).replace(/^\d+ /, "")}
        </span>
        <span>
          Проверено <b>{search.checked}</b>
        </span>
        <span>
          Отфильтровано <b>{search.filtered}</b>
        </span>
      </div>
      {b && search.found > 0 && (
        <div className="breakdown">
          <div>
            <div className="n high">{b.high}</div>
            <div className="cap label">Высокий</div>
          </div>
          <div>
            <div className="n medium">{b.medium}</div>
            <div className="cap label">Средний</div>
          </div>
          <div>
            <div className="n low">{b.low}</div>
            <div className="cap label">Низкий</div>
          </div>
        </div>
      )}
      {search.found === 0 && <div className="note info">Подходящих бизнесов не нашлось. Попробуйте другой город, нишу или «Найти ещё».</div>}
      {b?.existing ? <div className="note info">Уже были в базе: {b.existing} — дубли не создавались, недостающие данные дополнены.</div> : null}
      {search.warnings.map((w) => (
        <div key={w} className="note warn">
          {w}
        </div>
      ))}
      <div className="btn-row">
        {search.found > 0 && onOpenResults && (
          <button className="primary-btn" onClick={onOpenResults}>
            Смотреть лиды
          </button>
        )}
        <button className="secondary-btn" onClick={() => relaunch("more")} disabled={busy}>
          🔄 Найти ещё {search.requested}
        </button>
      </div>
    </div>
  );
}
