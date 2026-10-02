"use client";

// Подпись в письмах и сообщениях (общая с ботом). Попадает только в новые
// варианты текста — то, что пользователь заполнил сам.

import { useEffect, useState } from "react";
import * as leadsApi from "@/lib/leads-api";
import { hapticSuccess } from "@/lib/telegram-client";
import { useWorkspace } from "@/lib/workspace-context";
import type { LeadsMetaDTO, SenderDTO } from "@/types/leads";

const FIELDS: { key: keyof SenderDTO; label: string; placeholder: string }[] = [
  { key: "name", label: "Имя", placeholder: "как подписываться в письмах" },
  { key: "company", label: "Студия / компания", placeholder: "необязательно" },
  { key: "portfolioUrl", label: "Портфолио", placeholder: "https://…" },
  { key: "contact", label: "Контакт", placeholder: "+7… или @username" },
];

export function SenderForm({ sender, onSaved }: { sender: SenderDTO | null; onSaved: (m: LeadsMetaDTO) => void }) {
  const { showToast } = useWorkspace();
  const [values, setValues] = useState<SenderDTO>({ name: null, company: null, portfolioUrl: null, contact: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sender) setValues(sender);
  }, [sender]);

  async function save() {
    const portfolio = values.portfolioUrl?.trim();
    if (portfolio && !/^https?:\/\/\S+\.\S+/i.test(portfolio)) return showToast("Портфолио — ссылка вида https://…");
    setBusy(true);
    try {
      const meta = await leadsApi.setSender({
        name: values.name?.trim() || null,
        company: values.company?.trim() || null,
        portfolioUrl: portfolio || null,
        contact: values.contact?.trim() || null,
      });
      onSaved(meta);
      hapticSuccess();
      showToast("Подпись сохранена — появится в новых вариантах текста");
    } catch {
      showToast("Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="picker">
      <div className="label">✍️ Подпись в письмах</div>
      {FIELDS.map((f) => (
        <div key={f.key} className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <label className="flabel label">{f.label}</label>
          <input
            type="text"
            className="editor-input"
            placeholder={f.placeholder}
            value={values[f.key] ?? ""}
            maxLength={200}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        </div>
      ))}
      <button className="secondary-btn" style={{ marginTop: 12 }} onClick={save} disabled={busy}>
        {busy ? "Сохраняю…" : "Сохранить подпись"}
      </button>
      <div className="o-hint">Та же подпись — в боте («⚙️ Настройки»). В уже готовый текст не вставляется: нажми «🔄 Другой вариант».</div>
    </div>
  );
}
