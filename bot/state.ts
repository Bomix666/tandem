// Состояние диалога по чатам: какой пошаговый ввод сейчас ожидается
// (мастер поиска, текст новой задачи и т. п.). Хранится в памяти процесса:
// после перезапуска бота незаконченный мастер просто начинается заново.

export interface WizardDraft {
  niche?: string;
  city?: string;
  requested?: number;
  extra?: string | null;
}

export type ChatState =
  | { kind: "new_task" }
  | { kind: "lead_wizard"; step: "niche" | "city" | "count" | "extra" | "confirm"; draft: WizardDraft; messageId?: number }
  | { kind: "lead_name_query" }
  | { kind: "lead_avg_check" }
  | { kind: "lead_sender"; field: SenderField }
  // Sales OS: свой текст обращения / своя дата follow-up
  | { kind: "outreach_edit"; outreachId: string; editorMessageId?: number; promptMessageId?: number }
  | { kind: "followup_date"; scope: "l" | "o"; id: string; promptMessageId?: number }
  // Gmail (bot/leads/mail.ts): адрес, пароль приложения, цены для Claude, свой текст ответа
  | { kind: "gmail_user"; promptMessageId?: number }
  | { kind: "gmail_pass"; user: string; promptMessageId?: number }
  | { kind: "price_info"; promptMessageId?: number }
  | { kind: "reply_edit"; draftId: string; cardMessageId?: number; promptMessageId?: number };

/** Поля подписи в «⚙️ Настройки» модуля лидов. */
export type SenderField = "name" | "company" | "portfolio" | "contact";

const TTL_MS = 30 * 60_000;
const states = new Map<number, { state: ChatState; expires: number }>();

export const chatState = {
  get(chatId: number): ChatState | null {
    const entry = states.get(chatId);
    if (!entry) return null;
    if (entry.expires < Date.now()) {
      states.delete(chatId);
      return null;
    }
    return entry.state;
  },
  set(chatId: number, state: ChatState) {
    states.set(chatId, { state, expires: Date.now() + TTL_MS });
  },
  clear(chatId: number) {
    states.delete(chatId);
  },
};
