import { describe, expect, it } from "vitest";
import { dayDiff, daysFromNow, endOfDay, formatDayTime, parseUserDate, startOfDay } from "../time";

// 2026-10-03 23:30 по Москве (20:30 UTC) — рядом с полуночью, чтобы ловить ошибки пояса
const NOW = new Date("2026-10-03T20:30:00Z");
const TZ = "Europe/Moscow";

describe("даты в часовом поясе пользователя", () => {
  it("границы дня — по Москве, а не по UTC", () => {
    expect(startOfDay(NOW, TZ).toISOString()).toBe("2026-10-02T21:00:00.000Z");
    expect(endOfDay(NOW, TZ).toISOString()).toBe("2026-10-03T20:59:59.999Z");
  });

  it("«через 2 дня» — в 10:00 по Москве", () => {
    expect(daysFromNow(2, NOW, TZ).toISOString()).toBe("2026-10-05T07:00:00.000Z");
    expect(formatDayTime(daysFromNow(2, NOW, TZ), TZ)).toBe("05.10, 10:00");
  });

  it("разбор даты из сообщения", () => {
    expect(parseUserDate("05.10", NOW, TZ)?.toISOString()).toBe("2026-10-05T07:00:00.000Z");
    expect(parseUserDate("05.10 15:30", NOW, TZ)?.toISOString()).toBe("2026-10-05T12:30:00.000Z");
    expect(parseUserDate("завтра", NOW, TZ)?.toISOString()).toBe("2026-10-04T07:00:00.000Z");
    expect(parseUserDate("через 3 дня", NOW, TZ)?.toISOString()).toBe("2026-10-06T07:00:00.000Z");
    expect(parseUserDate("7", NOW, TZ)?.toISOString()).toBe("2026-10-10T07:00:00.000Z");
    expect(parseUserDate("01.01", NOW, TZ)?.toISOString()).toBe("2027-01-01T07:00:00.000Z"); // уже прошло → следующий год
  });

  it("непонятное или прошедшее — null", () => {
    for (const t of ["вчера", "31.02", "сегодня 09:00", "12.13", "когда-нибудь", "01.10.2026"]) expect(parseUserDate(t, NOW, TZ), t).toBeNull();
  });

  it("разница в календарных днях", () => {
    expect(dayDiff(NOW, new Date("2026-10-03T21:30:00Z"), TZ)).toBe(1); // 00:30 следующего дня по Москве
    expect(dayDiff(NOW, new Date("2026-10-01T09:00:00Z"), TZ)).toBe(-2);
  });
});
