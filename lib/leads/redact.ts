// Маскировка секретов в логах и сообщениях об ошибках: ключи API в адресах
// запросов (?apikey=…), токены ботов Telegram, Bearer-токены.

const RULES: [RegExp, string][] = [
  [/([?&](?:apikey|api_key|key|token|access_token|secret)=)[^&\s"'<>]+/gi, "$1***"],
  [/\b\d{6,12}:[A-Za-z0-9_-]{30,}\b/g, "***:***"], // токен бота Telegram
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]{10,}/gi, "$1***"],
];

export function redact(text: string): string {
  return RULES.reduce((s, [re, to]) => s.replace(re, to), text);
}

export function redactError(err: unknown): string {
  const e = err as Error | undefined;
  return redact(e?.stack ?? e?.message ?? String(err));
}
