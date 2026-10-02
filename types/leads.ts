// Данные модуля «Поиск клиентов», которые Mini App получает от /api/leads/*.
// Только типы — файл безопасно импортировать в клиентский код.

export type LeadStatusDTO = "FOUND" | "NEW" | "TO_CONTACT" | "CONTACTED" | "WAITING" | "NEGOTIATION" | "CLIENT" | "REJECTED" | "NOT_FIT";
export type PotentialDTO = "HIGH" | "MEDIUM" | "LOW";
/** a — все, h — горячие, f — сохранённые, d — найденные, n — новые, t — связаться, w — ждут ответа, g — переговоры, c — клиенты, r — отказы. */
export type LeadFilterDTO = "a" | "h" | "f" | "d" | "n" | "t" | "w" | "g" | "c" | "r";

/** Email лида: откуда взят и как проверен (🟢 VALID / 🟡 UNVERIFIED / 🔴 INVALID). */
export interface LeadContactDTO {
  value: string;
  check: "VALID" | "UNVERIFIED" | "INVALID" | null;
  checkLabel: string | null; // «Подтверждён», «Найден, не подтверждён», «Некорректный»
  note: string | null; // почему такая оценка
  source: "OSM" | "YANDEX" | "SITE" | "MANUAL";
  sourceLabel: string;
  sourceUrl: string | null;
  primary: boolean;
}

export interface LeadSiteDTO {
  kind: "own" | "social" | "booking" | "none";
  url: string | null;
  domain: string | null;
  booking: { name: string; url: string } | null;
  /** Результат проверки собственного сайта; null — не проверялся. */
  check: "ok" | "unreachable" | "error_status" | "blocked" | null;
  issues: string[];
  modern: boolean;
  note: string | null; // «защита от ботов, HTTP 403», «домен не найден»…
  platform: string | null;
}

export interface LeadDTO {
  id: string;
  name: string;
  city: string;
  niche: string;
  category: string | null;
  address: string | null;
  site: LeadSiteDTO;
  phones: string[];
  emails: string[];
  /** Email с проверкой; пусто у старых лидов — тогда показываются emails. */
  contacts: LeadContactDTO[];
  socials: { type: string; label: string; url: string }[];
  hours: string | null;
  sources: { provider: string; label: string; url: string }[];
  score: number;
  potential: PotentialDTO;
  reasons: { label: string; points: number }[];
  offer: string | null;
  status: LeadStatusDTO;
  saved: boolean;
  proposal: string | null;
  tasks: { id: string; title: string; createdAt: string }[];
  createdAt: string;
}

export interface LeadSearchDTO {
  id: string;
  niche: string;
  city: string;
  requested: number;
  extra: string | null;
  osmOnly: boolean;
  source: "osm" | "yandex";
  parentId: string | null;
  status: "RUNNING" | "DONE" | "FAILED";
  candidates: number; // бизнесов нашли источники
  found: number; // подходят
  checked: number;
  filtered: number;
  withEmail: number;
  needsReview: number;
  stage: string | null;
  warnings: string[];
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  breakdown: { high: number; medium: number; low: number; existing: number } | null;
}

export interface LeadsStatsDTO {
  total: number;
  saved: number;
  searches: number;
  byStatus: Partial<Record<LeadStatusDTO, number>>;
  avgCheck: number;
}

export interface LeadsMetaDTO {
  yandex: boolean;
  osm: boolean;
  /** «локальная копия от 02.10.2026, 1 234 567 бизнесов» */
  osmStatus: string;
  proposalLabel: string;
  niches: string[];
  cities: string[];
  stats: LeadsStatsDTO;
  /** Идущий сейчас поиск в пространстве (запущенный здесь, партнёром или из бота). */
  activeSearch: LeadSearchDTO | null;
}
