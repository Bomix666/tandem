// Общие типы модуля поиска клиентов.

export type SocialType =
  | "instagram"
  | "vk"
  | "telegram"
  | "whatsapp"
  | "ok"
  | "facebook"
  | "youtube"
  | "tiktok"
  | "dzen"
  | "taplink";

export interface SocialLink {
  type: SocialType;
  url: string;
}

export type ProviderName = "yandex" | "osm";

export interface SourceRef {
  provider: ProviderName;
  url: string;
}

/** Бизнес в том виде, в каком его вернул источник — до проверки сайта и скоринга. */
export interface BusinessCandidate {
  provider: ProviderName;
  externalId: string; // id организации в Яндексе или "node/123" в OSM
  name: string;
  categories: string[];
  address?: string;
  lat?: number;
  lon?: number;
  websiteRaw?: string; // как указано в источнике — может оказаться соцсетью
  phones: string[];
  emails: string[];
  socials: SocialLink[];
  hours?: string;
  sourceUrl: string;
}

/** «Собственный сайт», соцсеть вместо сайта, страница онлайн-записи вместо сайта или ничего. */
export type WebsiteKind = "own" | "social" | "booking" | "none";

export interface SiteAudit {
  url: string;
  checkedAt: string;
  status: "ok" | "unreachable" | "error_status" | "blocked";
  httpStatus?: number;
  finalUrl?: string;
  error?: string;
  https?: boolean;
  hasViewport?: boolean;
  hasForm?: boolean;
  bookingWidget?: string | null;
  hasCta?: boolean;
  copyrightYear?: number | null;
  platform?: string | null;
  outdated?: string[];
  emails: string[];
  socials: SocialLink[];
  phones: string[];
}

/** Лид-кандидат после объединения источников — то, что скорим и сохраняем. */
export interface LeadDraft {
  name: string;
  normName: string;
  city: string;
  niche: string; // название ниши, как в поиске
  category?: string;
  address?: string;
  normAddress?: string;
  lat?: number;
  lon?: number;
  websiteKind: WebsiteKind;
  website?: string;
  domain?: string;
  bookingPage?: { name: string; url: string };
  socials: SocialLink[];
  phones: string[];
  normPhones: string[];
  emails: string[];
  hours?: string;
  yandexId?: string;
  osmId?: string;
  sources: SourceRef[];
  confirmedByOsm: boolean; // найден и в Яндексе, и в OSM
  chainSize: number; // сколько точек с таким же названием в выдаче
  nicheMatch: boolean;
  audit?: SiteAudit;
}

export type Potential = "HIGH" | "MEDIUM" | "LOW";

export interface ScoreReason {
  label: string;
  points: number; // > 0 — повышает соответствие, < 0 — понижает
}

export interface ScoreResult {
  score: number; // 0–100
  potential: Potential;
  reasons: ScoreReason[];
  /** Причина, по которой бизнес не подходит в лиды (отфильтрован), или null. */
  reject: string | null;
}
