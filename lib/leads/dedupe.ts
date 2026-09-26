// Защита от дублей. Один и тот же бизнес узнаём по устойчивым признакам:
// id в Яндексе/OSM, домен собственного сайта, телефон, название + адрес,
// название + координаты рядом.

import { distanceMeters } from "./normalize";

export interface DedupeRecord {
  id: string;
  yandexId?: string | null;
  osmId?: string | null;
  domain?: string | null;
  normPhones: string[];
  normName: string;
  normAddress?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export type DedupeProbe = Omit<DedupeRecord, "id">;

export function isSameBusiness(a: DedupeProbe, b: DedupeProbe): boolean {
  if (a.yandexId && a.yandexId === b.yandexId) return true;
  if (a.osmId && a.osmId === b.osmId) return true;
  if (a.domain && a.domain === b.domain) return true;
  if (a.normPhones.some((p) => b.normPhones.includes(p))) return true;
  if (!a.normName || a.normName !== b.normName) return false;
  if (a.normAddress && a.normAddress === b.normAddress) return true;
  if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) {
    return distanceMeters(a.lat, a.lon, b.lat, b.lon) <= 150;
  }
  return false;
}

export class LeadIndex {
  private records: DedupeRecord[];

  constructor(records: DedupeRecord[] = []) {
    this.records = [...records];
  }

  find(probe: DedupeProbe): DedupeRecord | null {
    return this.records.find((r) => isSameBusiness(probe, r)) ?? null;
  }

  add(record: DedupeRecord): void {
    this.records.push(record);
  }

  get size(): number {
    return this.records.length;
  }
}

/** Ключ для списка отклонённых кандидатов (чтобы «Найти ещё» их не перепроверял). */
export function rejectKey(probe: DedupeProbe): string {
  return probe.yandexId ? `y:${probe.yandexId}` : probe.osmId ? `o:${probe.osmId}` : `n:${probe.normName}|${probe.normAddress ?? ""}`;
}
