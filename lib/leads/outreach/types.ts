// Контракты модуля обращений (Outreach). Генератор текста и «отправитель»
// подключаются через эти интерфейсы — шаблоны сейчас, Claude API и почтовый
// сервис позже, без переделки бота, Mini App и хранения.

import type { OutreachChannel } from "@prisma/client";
import type { LeadFacts } from "../proposal/types";

/** Подпись из «Настроек»: только то, что пользователь заполнил сам. */
export interface SenderProfile {
  name?: string | null;
  company?: string | null;
  portfolioUrl?: string | null;
  contact?: string | null;
}

export interface OutreachRequest {
  channel: OutreachChannel;
  facts: LeadFacts;
  sender: SenderProfile;
  /** Номер варианта формулировки — для «🔄 Другой вариант». */
  variant: number;
  /** Текст прошлого варианта: AI пишет новый заметно иначе. */
  previous?: string;
}

export interface OutreachText {
  subject?: string; // только для email
  body: string;
  /** Что стоит поправить перед отправкой («нет имени в подписи»). */
  warnings: string[];
  /** AI не ответил и текст собран шаблоном — почему (показывается пользователю). */
  fallback?: string;
}

export interface OutreachGenerator {
  id: string; // сохраняется в Outreach.generator
  label: string;
  generate(req: OutreachRequest): Promise<OutreachText>;
}

/**
 * Передача пользователю для ручной отправки: ссылка (почта / Telegram /
 * WhatsApp) и текст для копирования. Автоотправки нет — пользователь сам
 * открывает почту или мессенджер и сам нажимает «Отправить».
 */
export interface ManualHandoff {
  url: string | null;
  copyText: string;
  hint: string;
}

export interface OutreachSender {
  channel: OutreachChannel;
  mode: "manual"; // "auto" — когда появится почтовый сервис (с отдельным подтверждением)
  prepare(o: { recipient: string | null; subject?: string | null; body: string }): ManualHandoff;
}
