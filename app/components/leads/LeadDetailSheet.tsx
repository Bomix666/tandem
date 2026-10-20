"use client";

// Карточка лида: контакты с проверкой email, Lead Score, возможность, статус и
// действия Sales OS — письмо, сообщение в мессенджер, задача, follow-up.
// Письма и сообщения открываются в OutreachSheet; приложение ничего не
// отправляет само.

import { useEffect, useState } from "react";
import {
  CHANNEL_EMOJI,
  CHANNEL_LABELS,
  LEAD_STATUS_EMOJI,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_ORDER,
  OUTREACH_STATUS_EMOJI,
  OUTREACH_STATUS_LABELS,
  POTENTIAL_LABELS,
} from "@/lib/leads/labels";
import * as leadsApi from "@/lib/leads-api";
import { haptic, hapticSuccess, openExternalLink } from "@/lib/telegram-client";
import { useWorkspace } from "@/lib/workspace-context";
import type { LeadDTO, LeadStatusDTO, OutreachChannelDTO } from "@/types/leads";
import { displayAddress, formatDateFull, formatDayTime, relativeDay } from "./format";
import { FollowUpPicker, type FollowUpWhen } from "./FollowUpPicker";
import { statusTone } from "./OutreachSheet";

interface Props {
  /** Лиды текущего списка — для «← / →» внутри карточки. */
  ids: string[];
  index: number | null;
  /** Меняется, когда лид мог измениться снаружи (письмо, follow-up) — карточка перезагружается. */
  refreshKey: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
  onChanged: (lead: LeadDTO) => void;
  onOpenOutreach: (outreachId: string) => void;
}

const MESSENGERS: { channel: OutreachChannelDTO; hint: string }[] = [
  { channel: "TELEGRAM", hint: "коротко" },
  { channel: "WHATSAPP", hint: "коротко и по-разговорному" },
  { channel: "SOCIAL", hint: "очень коротко" },
];

export function LeadDetailSheet({ ids, index, refreshKey, onNavigate, onClose, onChanged, onOpenOutreach }: Props) {
  const { showToast, refreshAll } = useWorkspace();
  const leadId = index !== null ? ids[index] ?? null : null;
  const [lead, setLead] = useState<LeadDTO | null>(null);
  const [existingTask, setExistingTask] = useState<{ title: string; createdAt: string } | null>(null);
  const [panel, setPanel] = useState<"message" | "followup" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setExistingTask(null);
    setPanel(null);
  }, [leadId]);

  useEffect(() => {
    if (!leadId) return;
    let cancelled = false;
    leadsApi
      .getLead(leadId)
      .then(({ lead }) => !cancelled && setLead(lead))
      .catch(() => !cancelled && showToast("Не удалось открыть лид"));
    return () => {
      cancelled = true;
    };
  }, [leadId, refreshKey, showToast]);

  const open = leadId !== null;
  const shown = lead && lead.id === leadId ? lead : null;

  function apply(fresh: LeadDTO) {
    setLead(fresh);
    onChanged(fresh);
  }

  async function reload() {
    if (!shown) return;
    const fresh = await leadsApi.getLead(shown.id).catch(() => null);
    if (fresh) apply(fresh.lead);
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
      showToast(res.lead.saved ? "❤️ Лид сохранён · в работе" : "Убран из сохранённых");
    }
  }

  async function prepare(channel: OutreachChannelDTO) {
    if (!shown) return;
    haptic("medium");
    const res = await run(`prepare-${channel}`, () => leadsApi.prepareOutreach(shown.id, channel));
    if (!res) return;
    setPanel(null);
    if (res.reused) showToast("Открыл сохранённый черновик");
    onOpenOutreach(res.outreach.id);
    void reload();
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
    showToast("Задача создана — лид в «📩 Связаться»");
    await reload();
    refreshAll().catch(() => void 0);
  }

  async function followUp(when: FollowUpWhen) {
    if (!shown) return;
    const res = await run("followup", () => leadsApi.setFollowUp(shown.id, when));
    if (!res) return;
    hapticSuccess();
    setPanel(null);
    showToast(`⏰ Follow-up ${res.followUp.created ? "поставлен" : "перенесён"}: ${formatDayTime(res.followUp.at)}`);
    await reload();
    refreshAll().catch(() => void 0);
  }

  const contactTasks = shown?.tasks.filter((t) => t.kind === "CONTACT") ?? [];
  const emailDraft = shown?.outreach && shown.outreach.channel === "EMAIL" && (shown.outreach.status === "DRAFT" || shown.outreach.status === "READY");

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

            <div className="flags">
              <span className="pill gold">
                {LEAD_STATUS_EMOJI[shown.status]} {LEAD_STATUS_LABELS[shown.status]}
              </span>
              {shown.saved && <span className="pill">❤️ сохранён</span>}
              {contactTasks.length > 0 && <span className="pill">📋 {contactTasks.every((t) => t.done) ? "задача выполнена" : "задача"}</span>}
              {shown.followUp && (
                <span className={`pill ${relativeDay(shown.followUp.at).startsWith("просрочено") ? "rust" : "amber"}`}>⏰ {formatDayTime(shown.followUp.at)}</span>
              )}
              {shown.outreach && (
                <span className={`pill ${statusTone(shown.outreach.status)}`}>
                  {CHANNEL_EMOJI[shown.outreach.channel]} {OUTREACH_STATUS_LABELS[shown.outreach.status]}
                </span>
              )}
            </div>

            <div className="action-grid">
              <button className="primary-btn" onClick={() => (emailDraft ? onOpenOutreach(shown.outreach!.id) : prepare("EMAIL"))} disabled={busy === "prepare-EMAIL"}>
                {busy === "prepare-EMAIL" ? "Готовлю…" : emailDraft ? "✉️ Открыть письмо" : "✨ Подготовить письмо"}
              </button>
              <button className={`secondary-btn${panel === "message" ? " active" : ""}`} onClick={() => setPanel(panel === "message" ? null : "message")}>
                💬 Сообщение
              </button>
              <button className="secondary-btn" onClick={() => makeTask(false)} disabled={busy === "task"}>
                {busy === "task" ? "Создаю…" : contactTasks.length ? "✅ Задача" : "➕ Задача"}
              </button>
              <button className="secondary-btn" onClick={() => setPanel(panel === "followup" ? null : "followup")}>
                {shown.followUp ? "⏰ Перенести" : "⏰ Follow-up"}
              </button>
            </div>

            {panel === "message" && (
              <div className="picker">
                <div className="label">💬 Канал — у каждого свой формат текста</div>
                <div className="os-list" style={{ marginTop: 8 }}>
                  {MESSENGERS.map((m) => (
                    <div key={m.channel} className="o-card" onClick={() => prepare(m.channel)}>
                      <div className="o-top">
                        <div className="o-chan">{CHANNEL_EMOJI[m.channel]}</div>
                        <div className="o-main">
                          <div className="o-name">{CHANNEL_LABELS[m.channel]}</div>
                          <div className="o-sub">{m.hint} · {channelContact(shown, m.channel)}</div>
                        </div>
                        <div className="go" style={{ color: "var(--ink-dim)" }}>
                          {busy === `prepare-${m.channel}` ? "…" : "›"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="o-hint">Ничего не отправляется автоматически: приложение готовит текст, отправляешь ты.</div>
              </div>
            )}
            {panel === "followup" && <FollowUpPicker current={shown.followUp?.at} busy={busy === "followup"} onPick={followUp} />}
            {existingTask && (
              <div className="note warn">
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
            )}

            {shown.outreach && (
              <div className="kv" style={{ marginTop: 6 }}>
                <div className="k">Обращение</div>
                <div className="o-card" onClick={() => onOpenOutreach(shown.outreach!.id)}>
                  <div className="o-top">
                    <div className="o-chan">{CHANNEL_EMOJI[shown.outreach.channel]}</div>
                    <div className="o-main">
                      <div className="o-name">
                        {CHANNEL_LABELS[shown.outreach.channel]} · {OUTREACH_STATUS_EMOJI[shown.outreach.status]} {OUTREACH_STATUS_LABELS[shown.outreach.status]}
                      </div>
                      <div className="o-sub">
                        {shown.outreach.sentAt ? `отправлено ${formatDateFull(shown.outreach.sentAt)}` : "черновик — проверь и отправь"}
                        {shown.outreach.followUpAt ? ` · ⏰ ${formatDayTime(shown.outreach.followUpAt)}` : ""}
                      </div>
                    </div>
                    <div className="go" style={{ color: "var(--lime)" }}>
                      ›
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="kv">
              <div className="k">Сайт</div>
              <SiteValue lead={shown} />
            </div>

            <div className="kv">
              <div className="k">Email</div>
              {shown.contacts.length ? (
                <div className="v emails">
                  {shown.contacts.map((c) => (
                    <div key={c.value} className="email-row">
                      <span className={`echeck ${c.check?.toLowerCase() ?? "none"}`} title={c.note ?? undefined}>
                        {c.check === "VALID" ? "🟢" : c.check === "INVALID" ? "🔴" : "🟡"}
                      </span>
                      <div className="emain">
                        {c.check === "INVALID" ? <span className="dead">{c.value}</span> : <span>{c.value}</span>}
                        <div className="esub">
                          {c.checkLabel ?? "Не проверен"} ·{" "}
                          {c.sourceUrl ? (
                            <button className="linkbtn" onClick={() => openExternalLink(c.sourceUrl!)}>
                              {c.sourceLabel}
                            </button>
                          ) : (
                            c.sourceLabel
                          )}
                          {c.note ? ` — ${c.note}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : shown.emails.length ? (
                <div className="v">{shown.emails.join(", ")}</div>
              ) : (
                <div className="v missing">Не найден</div>
              )}
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
              <div className="k">Мессенджеры</div>
              {shown.messengers.length ? (
                <>
                  <div className="linkchips">
                    {shown.messengers.map((m) => (
                      <button key={m.url} className="linkchip" onClick={() => openExternalLink(m.url)}>
                        {m.label}
                        {m.byPhone ? " · по номеру" : ""} ↗
                      </button>
                    ))}
                  </div>
                  {shown.messengers.some((m) => m.byPhone) && (
                    <div className="v missing">По номеру — чат откроется, если номер есть в мессенджере.</div>
                  )}
                </>
              ) : (
                <div className="v missing">Не найдены</div>
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
              <div className="k">🎯 Lead Score {shown.score}/100</div>
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
                <div className="k">💡 Возможность</div>
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

function channelContact(lead: LeadDTO, channel: OutreachChannelDTO): string {
  const m = (t: string) => lead.messengers.find((x) => x.type === t);
  if (channel === "TELEGRAM") return m("telegram") ? (m("telegram")!.byPhone ? "по номеру" : "есть контакт") : "нет контакта — текст скопируешь";
  if (channel === "WHATSAPP") return m("whatsapp") || lead.phones.length ? "есть номер" : "нет номера — текст скопируешь";
  const pages = lead.socials.filter((s) => s.type === "vk" || s.type === "instagram").map((s) => s.label);
  return pages.length ? pages.join(", ") : "нет страниц — текст скопируешь";
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
