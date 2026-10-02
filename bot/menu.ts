// Главное меню бота — постоянная клавиатура внизу чата. Команды (/task,
// /tasks, /app, /find, /leads) работают как раньше; кнопки меню —
// дополнительный способ. Экраны Sales OS дальше листаются кнопками в сообщении.

import { Keyboard } from "grammy";

export const MENU = {
  home: "🚀 Sales OS",
  findClients: "🔎 Найти клиентов",
  myLeads: "👥 Мои лиды",
  outreach: "📨 Outreach",
  followUp: "⏰ Follow-up",
  analytics: "📊 Аналитика",
  tasks: "📋 Задачи",
  newTask: "➕ Задача",
  settings: "⚙️ Настройки",
} as const;

/** Подписи прежнего меню — у кого клавиатура ещё старая, кнопки продолжают работать. */
export const LEGACY_MENU = {
  myLeads: "❤️ Мои лиды",
  history: "🕘 История поиска",
  stats: "📊 Статистика",
  newTask: "➕ Новая задача",
} as const;

export function mainMenuKeyboard() {
  return new Keyboard()
    .text(MENU.home)
    .text(MENU.findClients)
    .row()
    .text(MENU.myLeads)
    .text(MENU.outreach)
    .row()
    .text(MENU.followUp)
    .text(MENU.analytics)
    .row()
    .text(MENU.tasks)
    .text(MENU.newTask)
    .text(MENU.settings)
    .resized()
    .persistent();
}
