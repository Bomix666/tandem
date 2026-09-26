// Главное меню бота — постоянная клавиатура внизу чата. Команды (/task,
// /tasks, /app) работают как раньше; кнопки меню — дополнительный способ.

import { Keyboard } from "grammy";

export const MENU = {
  tasks: "📋 Задачи",
  newTask: "➕ Новая задача",
  findClients: "🔎 Найти клиентов",
  myLeads: "❤️ Мои лиды",
  history: "🕘 История поиска",
  stats: "📊 Статистика",
  settings: "⚙️ Настройки",
} as const;

export function mainMenuKeyboard() {
  return new Keyboard()
    .text(MENU.tasks)
    .text(MENU.newTask)
    .row()
    .text(MENU.findClients)
    .text(MENU.myLeads)
    .row()
    .text(MENU.history)
    .text(MENU.stats)
    .row()
    .text(MENU.settings)
    .resized()
    .persistent();
}
