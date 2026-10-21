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
  /** WhatsApp / Telegram: с сайта или по мобильному номеру (byPhone — не проверено). */
  messengers: { type: string; label: string; url: string; byPhone: boolean }[];
  hours: string | null;
  sources: { provider: string; label: string; url: string }[];
  score: number;
  potential: PotentialDTO;
  reasons: { label: string; points: number }[];
  offer: string | null;
  status: LeadStatusDTO;
  saved: boolean;
  proposal: string | null;
  tasks: { id: string; title: string; createdAt: string; kind: "CONTACT" | "FOLLOW_UP"; done: boolean }[];
  /** Открытый follow-up: когда напомнить. */
  followUp: { taskId: string; at: string } | null;
  /** Последнее обращение (письмо / сообщение). */
  outreach: OutreachSummaryDTO | null;
  createdAt: string;
}

// ---------- Outreach, follow-up, дашборд, аналитика (Sales OS) ----------

export type OutreachChannelDTO = "EMAIL" | "TELEGRAM" | "WHATSAPP" | "SOCIAL";
export type OutreachStatusDTO = "DRAFT" | "READY" | "SENT" | "WAITING" | "REPLIED" | "FOLLOW_UP" | "REJECTED" | "CLIENT";

export interface OutreachSummaryDTO {
  id: string;
  channel: OutreachChannelDTO;
  status: OutreachStatusDTO;
  sentAt: string | null;
  followUpAt: string | null;
  updatedAt: string;
}

export interface OutreachDTO extends OutreachSummaryDTO {
  leadId: string;
  leadName: string;
  recipient: string | null;
  recipientCheck: "VALID" | "UNVERIFIED" | "INVALID" | null;
  subject: string | null;
  body: string;
  /** Текст правил пользователь (а не шаблон). */
  edited: boolean;
  variant: number;
  repliedAt: string | null;
  createdAt: string;
  /** Можно править — ещё не отмечено отправленным. */
  editable: boolean;
  warnings: string[];
  engine: string;
  /**
   * Куда пользователь сам отправит: письмо — подписанная страница /go/mail (в ней
   * mailto:), WhatsApp — wa.me с текстом, Telegram/соцсети — страница контакта.
   */
  openUrl: string | null;
  openLabel: string | null;
  /** С какой подключённой почты письмо уйдёт по кнопке «📤 Отправить письмо»; null — кнопки нет. */
  sendFrom: string | null;
}

export interface FollowUpDTO {
  taskId: string;
  leadId: string;
  leadName: string;
  leadStatus: LeadStatusDTO;
  at: string;
  scope: "overdue" | "today" | "later";
  done: boolean;
  outreach: { id: string; channel: OutreachChannelDTO; sentAt: string | null; recipient: string | null } | null;
}

export interface NextActionDTO {
  kind: "followup" | "reply" | "send" | "prepare" | "hot" | "upcoming";
  leadId: string;
  name: string;
  outreachId?: string;
  taskId?: string;
  at?: string;
  overdue?: boolean;
  score?: number;
}

export interface DashboardDTO {
  date: string;
  today: { newLeads: number; toProcess: number; followUps: number; replies: number; hot: number };
  pipeline: { fresh: number; toContact: number; waiting: number; negotiation: number; clients: number };
  outreachToday: { drafted: number; sent: number; replies: number };
  followUps: { overdue: number; today: number; later: number };
  next: NextActionDTO | null;
}

export interface AnalyticsDTO {
  period: 7 | 30 | null;
  total: number;
  found: number;
  saved: number;
  contacted: number;
  replied: number;
  negotiation: number;
  clients: number;
  rejected: number;
  outreach: { drafted: number; sent: number; replies: number };
  rates: { contact: number | null; reply: number | null; conversion: number | null };
  avgCheck: number;
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
  /** Подпись в письмах и сообщениях — общая с ботом («⚙️ Настройки → Подпись»). */
  sender: SenderDTO;
}

export interface SenderDTO {
  name: string | null;
  company: string | null;
  portfolioUrl: string | null;
  contact: string | null;
}
