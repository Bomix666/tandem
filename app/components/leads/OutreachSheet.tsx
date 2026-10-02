"use client";

// Редактор обращения (письмо / сообщение) поверх карточки лида. Приложение
// ничего не отправляет: «📨 Открыть почту» открывает письмо в почте
// пользователя, «✅ Я отправил» — его собственная отметка, после неё —
// follow-up. Для отправленных — итог: ответили / клиент / отказ.

import { useEffect, useState } from "react";
import { CHANNEL_EMOJI, CHANNEL_LABELS, OUTREACH_STATUS_EMOJI, OUTREACH_STATUS_LABELS } from "@/lib/leads/labels";
import * as leadsApi from "@/lib/leads-api";
import { haptic, hapticSuccess, openExternalLink } from "@/lib/telegram-client";
import { useWorkspace } from "@/lib/workspace-context";
import type { LeadsMetaDTO, OutreachDTO, OutreachStatusDTO, SenderDTO } from "@/types/leads";
import { formatDateFull, formatDayTime, relativeDay } from "./format";
import { FollowUpPicker, type FollowUpWhen } from "./FollowUpPicker";
import { SenderForm } from "./SenderForm";

interface Props {
  outreachId: string | null;
  onClose: () => void;
  /** Что-то изменилось (статус, текст, follow-up) — обновить списки и карточку. */
  onChanged: () => void;
  onOpenLead?: (leadId: string) => void;
  sender: SenderDTO | null;
  onSenderSaved: (m: LeadsMetaDTO) => void;
}

export function statusTone(s: OutreachStatusDTO): string {
  if (s === "CLIENT" || s === "REPLIED") return "lime";
  if (s === "REJECTED") return "rust";
  if (s === "WAITING" || s === "FOLLOW_UP" || s === "SENT") return "amber";
  return "gold";
}

const CHECK_EMOJI = { VALID: "🟢", UNVERIFIED: "🟡", INVALID: "🔴" } as const;

export function OutreachSheet({ outreachId, onClose, onChanged, onOpenLead, sender, onSenderSaved }: Props) {
  const { showToast } = useWorkspace();
  const [o, setO] = useState<OutreachDTO | null>(null);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<"after-sent" | "manual" | null>(null);
  const [currentFollowUp, setCurrentFollowUp] = useState<string | null>(null);
  const [senderOpen, setSenderOpen] = useState(false);

  useEffect(() => {
    setEditing(false);
    setPicker(null);
    setSenderOpen(false);
    if (!outreachId) return;
    let cancelled = false;
    leadsApi
      .getOutreach(outreachId)
      .then(({ outreach }) => !cancelled && load(outreach))
      .catch(() => !cancelled && showToast("Не удалось открыть обращение"));
    return () => {
      cancelled = true;
    };
  }, [outreachId, showToast]);

  function load(next: OutreachDTO) {
    setO(next);
    setSubject(next.subject ?? "");
    setBody(next.body);
    setCurrentFollowUp(next.followUpAt);
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

  const open = outreachId !== null;
  const shown = o && o.id === outreachId ? o : null;

  async function save() {
    if (!shown) return;
    if (body.trim().length < 10) return showToast("Текст слишком короткий");
    const r = await run("save", () => leadsApi.saveOutreachText(shown.id, shown.channel === "EMAIL" ? subject : null, body));
    if (!r) return;
    load(r.outreach);
    setEditing(false);
    hapticSuccess();
    showToast("Текст сохранён");
    onChanged();
  }

  async function copy() {
    if (!shown) return;
    const text = shown.channel === "EMAIL" && shown.subject ? `${shown.subject}\n\n${shown.body}` : shown.body;
    try {
      await navigator.clipboard.writeText(text);
      hapticSuccess();
      showToast("Текст скопирован");
    } catch {
      showToast("Не удалось скопировать — выдели текст вручную");
    }
  }

  async function action(a: leadsApi.OutreachAction, toast?: string) {
    if (!shown) return;
    haptic("medium");
    const r = await run(a, () => leadsApi.outreachAction(shown.id, a));
    if (!r) return;
    load(r.outreach);
    if (toast) showToast(toast);
    if (a === "sent") setPicker("after-sent");
    onChanged();
  }

  function openSend() {
    if (!shown?.openUrl) return;
    haptic("light");
    openExternalLink(shown.openUrl);
    if (shown.status === "DRAFT") void leadsApi.outreachAction(shown.id, "ready").then((r) => load(r.outreach)).catch(() => void 0);
  }

  async function discard() {
    if (!shown) return;
    const r = await run("discard", () => leadsApi.discardOutreach(shown.id));
    if (!r) return;
    showToast("Черновик удалён");
    onChanged();
    onClose();
  }

  async function followUp(when: FollowUpWhen) {
    if (!shown) return;
    const r = await run("followup", () => leadsApi.setFollowUp(shown.leadId, when, shown.id));
    if (!r) return;
    hapticSuccess();
    setPicker(null);
    setCurrentFollowUp(r.followUp.at);
    showToast(`⏰ Follow-up ${r.followUp.created ? "поставлен" : "перенесён"}: ${formatDayTime(r.followUp.at)}`);
    const fresh = await leadsApi.getOutreach(shown.id).catch(() => null);
    if (fresh) load(fresh.outreach);
    onChanged();
  }

  const sent = shown && !shown.editable;
  return (
    <>
      <div className={`scrim top${open ? " show" : ""}`} onClick={onClose} />
      <div className={`sheet top${open ? " show" : ""}`}>
        {open && <div className="sheet-grab" />}
        {open && (
          <div className="sheet-head">
            <div className="htitle">
              {shown ? `${CHANNEL_EMOJI[shown.channel]} ${shown.channel === "EMAIL" ? "Письмо" : CHANNEL_LABELS[shown.channel]}` : "Загрузка…"}
            </div>
            <button className="iconbtn" onClick={onClose}>
              ✕
            </button>
          </div>
        )}
        {open && shown && (
          <div className="sheet-body">
            <div className="flags" style={{ marginTop: 0 }}>
              <span className={`pill ${statusTone(shown.status)}`}>
                {OUTREACH_STATUS_EMOJI[shown.status]} {OUTREACH_STATUS_LABELS[shown.status]}
              </span>
              <button className="pill" style={{ background: "none", cursor: "pointer" }} onClick={() => onOpenLead?.(shown.leadId)}>
                🏢 {shown.leadName} ›
              </button>
            </div>

            <div className="kv">
              <div className="k">{shown.channel === "EMAIL" ? "Кому" : "Куда"}</div>
              {shown.recipient ? (
                <div className="o-recipient">
                  {shown.recipientCheck && <span>{CHECK_EMOJI[shown.recipientCheck]}</span>}
                  {shown.recipient}
                </div>
              ) : (
                <div className="v missing">{shown.channel === "EMAIL" ? "Email не найден — отправь текст через телефон или соцсети" : "Контакт не найден — скопируй текст"}</div>
              )}
            </div>

            {shown.channel === "EMAIL" && (
              <div className="kv">
                <div className="k">Тема</div>
                {editing ? (
                  <input className="editor-input" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
                ) : (
                  <div className="v" style={{ fontWeight: 600 }}>
                    {shown.subject ?? "—"}
                  </div>
                )}
              </div>
            )}

            <div className="kv">
              <div className="k">Текст</div>
              {editing ? <textarea className="editor-area" value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} /> : <div className="proposal">{shown.body}</div>}
              {shown.editable && !editing && (
                <div className="proposal-meta">
                  {shown.edited ? "Текст отредактирован вручную." : `Сделано: ${shown.engine}.`} Проверь перед отправкой — приложение ничего не отправляет само.
                </div>
              )}
            </div>

            {shown.warnings.map((w) => (
              <div key={w} className="note warn">
                ⚠️ {w.replace("заполни «⚙️ Настройки → Подпись»", "заполни подпись")}
                {w.includes("Подпись") && !senderOpen && (
                  <button className="linkbtn" style={{ display: "block", marginTop: 6 }} onClick={() => setSenderOpen(true)}>
                    ✍️ Заполнить подпись
                  </button>
                )}
              </div>
            ))}
            {senderOpen && (
              <SenderForm
                sender={sender}
                onSaved={(m) => {
                  onSenderSaved(m);
                  setSenderOpen(false);
                  if (shown) void leadsApi.getOutreach(shown.id).then((r) => load(r.outreach)).catch(() => void 0);
                }}
              />
            )}

            {shown.editable && (
              <>
                {editing ? (
                  <div className="btn-row">
                    <button className="primary-btn" onClick={save} disabled={busy === "save"}>
                      {busy === "save" ? "Сохраняю…" : "💾 Сохранить"}
                    </button>
                    <button
                      className="secondary-btn"
                      onClick={() => {
                        setEditing(false);
                        setSubject(shown.subject ?? "");
                        setBody(shown.body);
                      }}
                    >
                      Отмена
                    </button>
                  </div>
                ) : (
                  <>
                    {shown.openUrl && (
                      <button className="primary-btn" onClick={openSend}>
                        {shown.openLabel}
                      </button>
                    )}
                    <div className="btn-row">
                      <button className="secondary-btn" onClick={() => setEditing(true)}>
                        ✏️ Редактировать
                      </button>
                      <button className="secondary-btn" onClick={copy}>
                        📋 Копировать
                      </button>
                    </div>
                    <div className="btn-row">
                      <button className="secondary-btn" onClick={() => action("regenerate", "Новый вариант текста")} disabled={busy === "regenerate"}>
                        🔄 Другой вариант
                      </button>
                      <button className="secondary-btn" onClick={() => action("sent", "📨 Отмечено как отправленное")} disabled={busy === "sent"}>
                        ✅ Я отправил
                      </button>
                    </div>
                    <button className="ghost-btn" onClick={discard} disabled={busy === "discard"}>
                      ❌ Удалить черновик
                    </button>
                  </>
                )}
              </>
            )}

            {sent && (
              <>
                <div className="note info">
                  {shown.sentAt ? `📨 Отправлено ${formatDateFull(shown.sentAt)}` : "📨 Отправлено"}
                  {currentFollowUp ? ` · ⏰ follow-up ${formatDayTime(currentFollowUp)} (${relativeDay(currentFollowUp)})` : ""}
                  {shown.repliedAt ? ` · 👀 ответ ${formatDateFull(shown.repliedAt)}` : ""}
                </div>
                {picker === "after-sent" && (
                  <FollowUpPicker title="✅ Отмечено как отправленное. Когда напомнить, если не ответят?" busy={busy === "followup"} onPick={followUp} onSkip={() => setPicker(null)} />
                )}
                {picker === "manual" && <FollowUpPicker current={currentFollowUp} busy={busy === "followup"} onPick={followUp} />}
                {shown.status !== "CLIENT" && shown.status !== "REJECTED" && (
                  <>
                    <div className="btn-row">
                      {shown.status !== "REPLIED" && (
                        <button className="secondary-btn" onClick={() => action("replied", "👀 Ответ отмечен · лид → 💬 Переговоры")} disabled={busy === "replied"}>
                          👀 Ответили
                        </button>
                      )}
                      <button className="secondary-btn" onClick={() => setPicker(picker === "manual" ? null : "manual")}>
                        ⏰ Follow-up
                      </button>
                    </div>
                    <div className="btn-row">
                      <button className="secondary-btn" onClick={() => action("client", "🤝 Клиент! Поздравляю")} disabled={busy === "client"}>
                        🤝 Клиент
                      </button>
                      <button className="secondary-btn" onClick={() => action("rejected", "❌ Отказ отмечен")} disabled={busy === "rejected"}>
                        ❌ Отказ
                      </button>
                    </div>
                  </>
                )}
                <button className="ghost-btn" onClick={copy}>
                  📋 Копировать текст
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
