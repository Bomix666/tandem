// Deliberately not AI-backed — fast, offline, deterministic. Recognizes
// English and Russian: today/сегодня, tonight/сегодня вечером,
// tomorrow/завтра, weekday names in either language, "in Nh"/"через Nч",
// and "HH:mm" or "H am/pm" times. If nothing is recognized, the whole
// input becomes the title and the caller falls back to a default deadline
// (the UI leaves it for the user to set explicitly).

const WEEKDAYS_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAYS_RU = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

export interface QuickAddResult {
  title: string;
  deadline: Date | null;
}

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  let text = input.trim();
  let deadline: Date | null = null;

  const timeMatch = text.match(/\b(\d{1,2})(:(\d{2}))?\s*(am|pm)?\b/i);
  let hours: number | null = null;
  let minutes = 0;
  if (timeMatch) {
    hours = parseInt(timeMatch[1]!, 10);
    minutes = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
    const ampm = timeMatch[4]?.toLowerCase();
    if (ampm === "pm" && hours < 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    if (hours > 23) hours = null; // reject bogus matches like "$5"
  }

  const lower = text.toLowerCase();
  let base: Date | null = null;

  if (/\btomorrow\b/.test(lower) || /\bзавтра\b/.test(lower)) {
    base = addDays(now, 1);
    text = stripWord(text, "tomorrow");
    text = stripWord(text, "завтра");
  } else if (/\btonight\b/.test(lower) || /сегодня вечером/.test(lower)) {
    base = new Date(now);
    text = stripWord(text, "tonight");
    text = text.replace(/сегодня вечером/i, "");
    if (hours === null) hours = 20;
  } else if (/\btoday\b/.test(lower) || /\bсегодня\b/.test(lower)) {
    base = new Date(now);
    text = stripWord(text, "today");
    text = stripWord(text, "сегодня");
  } else {
    for (let i = 0; i < WEEKDAYS_EN.length; i++) {
      const reEn = new RegExp(`\\b${WEEKDAYS_EN[i]}\\b`, "i");
      const reRu = new RegExp(`\\b${WEEKDAYS_RU[i]}\\b`, "i");
      if (reEn.test(lower)) {
        base = nextWeekday(now, i);
        text = stripWord(text, WEEKDAYS_EN[i]!);
        break;
      }
      if (reRu.test(lower)) {
        base = nextWeekday(now, i);
        text = stripWord(text, WEEKDAYS_RU[i]!);
        break;
      }
    }
  }

  const inHoursMatch = lower.match(/\bin (\d+) ?h(ours?)?\b/) ?? lower.match(/через (\d+) ?ч(ас(а|ов)?)?/);
  if (!base && inHoursMatch) {
    deadline = new Date(now.getTime() + parseInt(inHoursMatch[1]!, 10) * 3600_000);
    text = text.replace(inHoursMatch[0], "");
  }

  if (base) {
    base.setHours(hours ?? 18, minutes, 0, 0);
    deadline = base;
    if (timeMatch) text = text.replace(timeMatch[0], "");
  }

  text = text.replace(/\s+/g, " ").trim();
  return { title: text || input.trim(), deadline };
}

function stripWord(text: string, word: string) {
  return text.replace(new RegExp(`\\b${word}\\b`, "i"), "");
}

function addDays(d: Date, n: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function nextWeekday(from: Date, targetDow: number) {
  const d = new Date(from);
  const diff = (targetDow + 7 - d.getDay()) % 7 || 7; // always the *next* occurrence
  d.setDate(d.getDate() + diff);
  return d;
}
