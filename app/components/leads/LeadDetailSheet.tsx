"use client";

import { useEffect, useState } from "react";
import { LEAD_STATUS_EMOJI, LEAD_STATUS_LABELS, LEAD_STATUS_ORDER, POTENTIAL_LABELS } from "@/lib/leads/labels";
import * as leadsApi from "@/lib/leads-api";
import { haptic, hapticSuccess, openExternalLink } from "@/lib/telegram-client";
import { useWorkspace } from "@/lib/workspace-context";
import type { LeadDTO, LeadStatusDTO } from "@/types/leads";
import { displayAddress, formatDateFull } from "./format";

interface Props {
  /** Лиды текущего списка — для «← / →» внутри карточки. */
  ids: string[];
  index: number | null;
  onNavigate: (index: number) => void;
  onClose: () => void;
  onChanged: (lead: LeadDTO) => void;
}

export function LeadDetailSheet({ ids, index, onNavigate, onClose, onChanged }: Props) {
  const { showToast, refreshAll } = useWorkspace();
  const leadId = index !== null ? ids[index] ?? null : null;
  const [lead, setLead] = useState<LeadDTO | null>(null);
  const [proposal, setProposal] = useState<{ text: string; engine: string; note: string | null } | null>(null);
  const [existingTask, setExistingTask] = useState<{ title: string; createdAt: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setProposal(null);
    setExistingTask(null);
    if (!leadId) return;
    let cancelled = false;
    leadsApi
      .getLead(leadId)
      .then(({ lead }) => {
        if (cancelled) return;
        setLead(lead);
        if (lead.proposal) setProposal({ text: lead.proposal, engine: "сохранённый вариант", note: null });
      })
      .catch(() => !cancelled && showToast("Не удалось открыть лид"));
    return () => {
      cancelled = true;
    };
  }, [leadId, showToast]);

  const open = leadId !== null;
  const shown = lead && lead.id === leadId ? lead : null;

  function apply(fresh: LeadDTO) {
    setLead(fresh);
    onChanged(fresh);
  }

  async function run<T>(key: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(key);
    try {
      return await fn();
    } catch {
      showToast("Что-то пошло не так, попробуй ещё раз");
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  async function setStatus(status: LeadStatusDTO) {
    if (!shown || shown.status === status) return;
    haptic("light");
    const res = await run("status", () => leadsApi.updateLead(shown.id, { status }));
    if (res) {
      apply(res.lead);
      showToast(`Статус: ${LEAD_STATUS_LABELS[status]}`);
    }
  }

  async function toggleSaved() {
    if (!shown) return;
    haptic("light");
    const res = await run("save", () => leadsApi.updateLead(shown.id, { saved: !shown.saved }));
    if (res) {
      apply(res.lead);
      showToast(res.lead.saved ? "Лид сохранён" : "Убран из сохранённых");
    }
  }

  async function makeProposal() {
    if (!shown) return;
    haptic("medium");
    const res = await run("proposal", () => leadsApi.createProposal(shown.id));
    if (res) setProposal(res);
  }

  async function copyProposal() {
    if (!proposal) return;
    try {
      await navigator.clipboard.writeText(proposal.text);
      hapticSuccess();
      showToast("Текст скопирован");
    } catch {
      showToast("Не удалось скопировать — выдели текст вручную");
    }
  }

  async function makeTask(force: boolean) {
    if (!shown) return;
    haptic("medium");
    const res = await run("task", () => leadsApi.createTaskFromLead(shown.id, force));
    if (!res) return;
    if (res.status === "exists") {
      setExistingTask({ title: res.task.title, createdAt: res.task.createdAt });
      return;
    }
    setExistingTask(null);
    hapticSuccess();
    showToast("Задача создана — она в разделе «Задачи»");
    const fresh = await leadsApi.getLead(shown.id).catch(() => null);
    if (fresh) apply(fresh.lead);
    refreshAll().catch(() => void 0);
  }

  return (
    <>
      <div className={`scrim${open ? " show" : ""}`} onClick={onClose} />
      <div className={`sheet${open ? " show" : ""}`}>
        {/* закрытая панель пустая: иначе её шапка выглядывала бы из-под края поверх меню */}
        {open && <div className="sheet-grab" />}
        {open && (
          <div className="sheet-head">
            <div className="htitle" style={{ maxWidth: "80%" }}>
              {shown?.name ?? "Загрузка…"}
            </div>
            <button className="iconbtn" onClick={onClose}>
              ✕
            </button>
          </div>
        )}
        {open && shown && (
          <div className="sheet-body">
            <div className="lead-hero">
              <div className={`bigscore ${shown.potential.toLowerCase()}`}>
                <div className="n">{shown.score}</div>
                <div className="of">ИЗ 100</div>
              </div>
              <div className="meta">
                <div className="pot">Потенциал: {POTENTIAL_LABELS[shown.potential].toLowerCase()}</div>
                <div className="where">
                  {shown.category ?? shown.niche}
                  <br />
                  {[shown.city, shown.address ? displayAddress(shown.address, shown.city) : ""].filter(Boolean).join(", ")}
                </div>
              </div>
            </div>

            <div className="kv">
              <div className="k">Сайт</div>
              <SiteValue lead={shown} />
            </div>

            <div className="kv">
              <div className="k">Телефон</div>
              {shown.phones.length ? (
                <div className="v">
                  {shown.phones.map((p, i) => (
                    <span key={p}>
                      {i > 0 && ", "}
                      <a href={`tel:${p.replace(/[^\d+]/g, "")}`}>{p}</a>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="v missing">Не найден</div>
              )}
            </div>

            <div className="kv">
              <div className="k">Email</div>
              {shown.emails.length ? (
                <div className="v">
                  {shown.emails.map((m, i) => (
                    <span key={m}>
                      {i > 0 && ", "}
                      <a href={`mailto:${m}`}>{m}</a>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="v missing">Не найден</div>
              )}
            </div>

            <div className="kv">
              <div className="k">Соцсети</div>
              {shown.socials.length ? (
                <div className="linkchips">
                  {shown.socials.map((s) => (
                    <button key={s.url} className="linkchip" onClick={() => openExternalLink(s.url)}>
                      {s.label} ↗
                    </button>
                  ))}
                </div>
              ) : (
                <div className="v missing">Не найдены</div>
              )}
            </div>

            {shown.hours && (
              <div className="kv">
                <div className="k">Режим работы</div>
                <div className="v">{shown.hours}</div>
              </div>
            )}

            <div className="kv">
              <div className="k">Почему {shown.score}/100</div>
              <div className="reasons">
                {shown.reasons.map((r) => (
                  <div key={r.label} className={`reason ${r.points > 0 ? "plus" : "minus"}`}>
                    <span className="mark">{r.points > 0 ? "✓" : "✗"}</span>
                    <span>{r.label}</span>
                    <span className="pts">{r.points > 0 ? `+${r.points}` : r.points}</span>
                  </div>
                ))}
              </div>
            </div>

            {shown.offer && (
              <div className="kv">
                <div className="k">Что можно предложить</div>
                <div className="v">{shown.offer}</div>
              </div>
            )}

            <div className="kv">
              <div className="k">Статус</div>
              <div className="status-grid">
                {LEAD_STATUS_ORDER.map((s) => (
                  <div key={s} className={`pickchip${shown.status === s ? " active" : ""}`} onClick={() => setStatus(s)}>
                    {LEAD_STATUS_EMOJI[s]} {LEAD_STATUS_LABELS[s]}
                  </div>
                ))}
              </div>
            </div>

            <div className="kv">
              <div className="k">Предложение</div>
              {proposal ? (
                <>
                  <div className="proposal">{proposal.text}</div>
                  <div className="proposal-meta">
                    {proposal.engine === "сохранённый вариант" ? "Последний сгенерированный текст." : `Сделано: ${proposal.engine}.`}
                    {proposal.note ? ` ${proposal.note}` : ""} Проверь перед отправкой — приложение ничего не отправляет само.
                  </div>
                  <div className="btn-row">
                    <button className="secondary-btn" onClick={copyProposal}>
                      Скопировать
                    </button>
                    <button className="secondary-btn" onClick={() => setStatus("CONTACTED")} disabled={shown.status === "CONTACTED"}>
                      💬 Написали
                    </button>
                  </div>
                  <button className="ghost-btn" onClick={makeProposal} disabled={busy === "proposal"}>
                    Сгенерировать заново
                  </button>
                </>
              ) : (
                <button className="secondary-btn" onClick={makeProposal} disabled={busy === "proposal"}>
                  {busy === "proposal" ? "Составляю…" : "✨ Создать предложение"}
                </button>
              )}
            </div>

            <div className="kv">
              <div className="k">Задача</div>
              {existingTask ? (
                <div className="note warn" style={{ marginTop: 0 }}>
                  У лида уже есть задача «{existingTask.title}» от {formatDateFull(existingTask.createdAt)}. Создать ещё одну?
                  <div className="btn-row">
                    <button className="secondary-btn" onClick={() => makeTask(true)} disabled={busy === "task"}>
                      Да, создать
                    </button>
                    <button className="secondary-btn" onClick={() => setExistingTask(null)}>
                      Отмена
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {shown.tasks.length > 0 && (
                    <div className="v" style={{ marginBottom: 8 }}>
                      ✅ {shown.tasks[0]!.title}
                      {shown.tasks.length > 1 ? ` (+${shown.tasks.length - 1})` : ""}
                    </div>
                  )}
                  <button className="primary-btn" style={{ marginTop: 0 }} onClick={() => makeTask(false)} disabled={busy === "task"}>
                    {busy === "task" ? "Создаю…" : shown.tasks.length ? "➕ Ещё одна задача" : "➕ Создать задачу"}
                  </button>
                </>
              )}
            </div>

            <button className="ghost-btn" onClick={toggleSaved} disabled={busy === "save"}>
              {shown.saved ? "💔 Убрать из сохранённых" : "❤️ Сохранить лид"}
            </button>

            <div className="kv" style={{ marginTop: 8 }}>
              <div className="k">Источник</div>
              <div className="linkchips">
                {shown.sources.map((s) => (
                  <button key={s.url} className="linkchip" onClick={() => openExternalLink(s.url)}>
                    {s.label} ↗
                  </button>
                ))}
              </div>
            </div>

            {ids.length > 1 && index !== null && (
              <div className="sheet-nav">
                <button className="secondary-btn" disabled={index === 0} onClick={() => onNavigate(index - 1)}>
                  ← Предыдущий
                </button>
                <button className="secondary-btn" disabled={index >= ids.length - 1} onClick={() => onNavigate(index + 1)}>
                  Следующий →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function SiteValue({ lead }: { lead: LeadDTO }) {
  const s = lead.site;
  if (s.kind === "own" && s.url) {
    return (
      <div className="v">
        <button className="linkbtn" onClick={() => openExternalLink(s.url!)}>
          {s.domain ?? s.url} ↗
        </button>
        <div className="tags" style={{ marginTop: 8 }}>
          {s.check === null && <span className="tag">не проверялся</span>}
          {s.check === "blocked" && <span className="tag">не удалось проверить{s.note ? ` (${s.note})` : ""}</span>}
          {(s.check === "unreachable" || s.check === "error_status") && <span className="tag warn">не открывается{s.note ? ` — ${s.note}` : ""}</span>}
          {s.issues.map((i) => (
            <span key={i} className="tag warn">
              {i}
            </span>
          ))}
          {s.check === "ok" && !s.issues.length && <span className={`tag ${s.modern ? "good" : ""}`}>{s.modern ? "выглядит современным" : "проблем не найдено"}</span>}
          {s.platform && <span className="tag">{s.platform}</span>}
        </div>
      </div>
    );
  }
  if (s.kind === "booking" && s.booking) {
    return (
      <div className="v">
        <span className="missing" style={{ color: "var(--ink-faint)" }}>Не найден · </span>
        запись через{" "}
        <button className="linkbtn" onClick={() => openExternalLink(s.booking!.url)}>
          {s.booking.name} ↗
        </button>
      </div>
    );
  }
  if (s.kind === "social") return <div className="v missing">Не найден — вместо сайта соцсеть</div>;
  return <div className="v missing">Не найден</div>;
}
