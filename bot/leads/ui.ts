// Оформление Sales OS в Telegram (HTML): разделители, «хлебные крошки»,
// таблицы с выровненными числами, проценты. Без эмодзи-шума — эмодзи только
// как метки разделов и статусов.

export const e = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

export const DIV = "━━━━━━━━━━━━━━━━━━";

/** Контекст экрана: «Sales OS › Лиды › Black Barber». */
export function crumbs(...parts: string[]): string {
  return `<i>Sales OS${parts.map((p) => ` › ${e(p)}`).join("")}</i>`;
}

/**
 * Таблица «подпись — число» моноширинным блоком: числа выровнены по правому
 * краю, как в дашборде. Эмодзи внутрь не ставим — ломают ширину.
 */
export function table(rows: [string, number | string][]): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  const valWidth = Math.max(...rows.map(([, v]) => String(v).length));
  return `<pre>${rows.map(([label, v]) => `${e(label.padEnd(width + 2))}${String(v).padStart(valWidth)}`).join("\n")}</pre>`;
}

export const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)}%`);

/** Короткая подпись для кнопки: не длиннее `max` символов. */
export const clip = (s: string, max = 28) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
