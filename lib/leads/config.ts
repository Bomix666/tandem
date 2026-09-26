// Настройки модуля поиска клиентов. Все ключи и адреса — только из
// переменных окружения (.env), в коде секретов нет. Геттеры, а не константы:
// значения читаются в момент вызова, поэтому тесты могут подменять env.

export const leadsConfig = {
  /** Ключ «API Поиска по организациям» из Кабинета разработчика Яндекса. */
  get yandexApiKey(): string | null {
    return process.env.YANDEX_PLACES_API_KEY?.trim() || null;
  },
  get yandexApiUrl(): string {
    return process.env.YANDEX_PLACES_API_URL?.trim() || "https://search-maps.yandex.ru/v1/";
  },
  /** OpenStreetMap — дополнительная проверка и дополнение данных. Ключ не нужен. */
  get osmEnabled(): boolean {
    return process.env.LEADS_OSM_ENABLED !== "false";
  },
  /**
   * Серверы Overpass по порядку: публичные серверы часто перегружены (504/429),
   * поэтому при ошибке пробуем следующий. OVERPASS_API_URL — через запятую.
   */
  get overpassUrls(): string[] {
    const fromEnv = process.env.OVERPASS_API_URL?.split(",").map((s) => s.trim()).filter(Boolean);
    // порядок — по тому, какие зеркала реально отвечали из РФ при проверке (сентябрь 2026)
    return fromEnv?.length
      ? fromEnv
      : [
          "https://overpass.openstreetmap.fr/api/interpreter",
          "https://z.overpass-api.de/api/interpreter",
          "https://overpass-api.de/api/interpreter",
          "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
        ];
  },
  get nominatimUrl(): string {
    return (process.env.NOMINATIM_URL?.trim() || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
  },
  /** Движок текстов предложений: пока только "template" (см. lib/leads/proposal). */
  get proposalEngine(): string {
    return process.env.LEADS_PROPOSAL_ENGINE?.trim() || "template";
  },
  /**
   * Разрешить проверку сайтов на внутренних адресах (localhost, 10.x, …).
   * Только для локальных тестов; в production игнорируется — иначе адрес
   * «сайта» из чужих данных мог бы указывать внутрь нашей сети (SSRF).
   */
  get allowPrivateUrls(): boolean {
    return process.env.LEADS_ALLOW_PRIVATE_URLS === "true" && process.env.NODE_ENV !== "production";
  },
  /** Nominatim/Overpass требуют User-Agent, по которому можно понять, кто ходит. */
  get userAgent(): string {
    const app = process.env.APP_URL?.trim();
    return `TandemLeads/0.1 (Telegram task manager${app ? `; ${app}` : ""})`;
  },
};

export function isYandexConfigured() {
  return leadsConfig.yandexApiKey !== null;
}
