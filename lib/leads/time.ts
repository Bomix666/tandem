// Даты для Sales OS в часовом поясе пользователя (LEADS_TIMEZONE, по умолчанию
// Москва): «сегодня», «через 2 дня в 10:00», разбор «05.10» / «завтра 15:00».

export const LEADS_TZ = () => process.env.LEADS_TIMEZONE?.trim() || "Europe/Moscow";

/** Смещение пояса относительно UTC в мс для момента `at`. */
function tzOffset(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** Календарная дата в поясе: { y, m (1–12), d }. */
export function localDate(at: Date, tz = LEADS_TZ()) {
  const shifted = new Date(at.getTime() + tzOffset(at, tz));
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** Момент «y-m-d hh:mm» по местному времени пояса. */
export function zonedTime(y: number, m: number, d: number, hh = 0, mm = 0, tz = LEADS_TZ()): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  return new Date(guess.getTime() - tzOffset(guess, tz));
}

export function startOfDay(at: Date, tz = LEADS_TZ()): Date {
  const { y, m, d } = localDate(at, tz);
  return zonedTime(y, m, d, 0, 0, tz);
}

export function endOfDay(at: Date, tz = LEADS_TZ()): Date {
  return new Date(startOfDay(new Date(startOfDay(at, tz).getTime() + 36 * 3600_000), tz).getTime() - 1);
}

/** «Через N дней в 10:00» — время напоминаний по умолчанию. */
export function daysFromNow(days: number, now = new Date(), tz = LEADS_TZ(), hour = 10): Date {
  const { y, m, d } = localDate(now, tz);
  return zonedTime(y, m, d + days, hour, 0, tz);
}

const fmt = (opts: Intl.DateTimeFormatOptions) => (at: Date, tz = LEADS_TZ()) => at.toLocaleString("ru-RU", { timeZone: tz, ...opts });
export const formatDay = fmt({ day: "2-digit", month: "2-digit", year: "numeric" });
export const formatDayShort = fmt({ day: "2-digit", month: "2-digit" });
export const formatDayTime = fmt({ day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Сколько полных календарных дней между датами (в поясе): 0 — тот же день. */
export function dayDiff(from: Date, to: Date, tz = LEADS_TZ()): number {
  return Math.round((startOfDay(to, tz).getTime() - startOfDay(from, tz).getTime()) / 86_400_000);
}

/**
 * Дата из сообщения пользователя: «05.10», «5.10.2026», «05.10 15:30»,
 * «завтра», «послезавтра», «через 3 дня», «3». Прошедшая дата без года —
 * значит следующий год. null — не понял или дата в прошлом.
 */
export function parseUserDate(input: string, now = new Date(), tz = LEADS_TZ()): Date | null {
  const t = input.trim().toLowerCase().replace(/ё/g, "е");
  const time = /(\d{1,2})[:.](\d{2})\s*$/.exec(t);
  const [hh, mm] = time && /\s/.test(t) ? [Number(time[1]), Number(time[2])] : [10, 0];
  if (hh > 23 || mm > 59) return null;
  const head = time && /\s/.test(t) ? t.slice(0, time.index).trim() : t;
  const today = localDate(now, tz);

  let result: Date | null = null;
  const rel = /^(?:через\s+)?(\d{1,3})(?:\s*(?:дн[еяй]*|д))?$/.exec(head);
  if (head === "сегодня") result = zonedTime(today.y, today.m, today.d, hh, mm, tz);
  else if (head === "завтра") result = zonedTime(today.y, today.m, today.d + 1, hh, mm, tz);
  else if (head === "послезавтра") result = zonedTime(today.y, today.m, today.d + 2, hh, mm, tz);
  else if (rel) result = zonedTime(today.y, today.m, today.d + Number(rel[1]), hh, mm, tz);
  else {
    const dm = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?$/.exec(head);
    if (!dm) return null;
    const [d, m] = [Number(dm[1]), Number(dm[2])];
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    let y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : today.y;
    result = zonedTime(y, m, d, hh, mm, tz);
    if (localDate(result, tz).d !== d) return null; // 31.02
    if (!dm[3] && result.getTime() < startOfDay(now, tz).getTime()) {
      y += 1;
      result = zonedTime(y, m, d, hh, mm, tz);
    }
  }
  return result && result.getTime() > now.getTime() - 60_000 ? result : null;
}
