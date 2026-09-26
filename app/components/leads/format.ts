// Форматирование для раздела «Клиенты».

export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

export const leadsWord = (n: number) => `${n} ${plural(n, ["лид", "лида", "лидов"])}`;

export const formatMoney = (n: number) => `${n.toLocaleString("ru-RU")} ₽`;

/** «250 тыс ₽», «1,2 млн ₽» — для компактных плашек. */
export function formatMoneyShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} млн ₽`;
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString("ru-RU")} тыс ₽`;
  return formatMoney(n);
}

/** «Россия, Москва, Тверская улица, 7» → «Тверская улица, 7» (город показываем отдельно). */
export function displayAddress(address: string, city: string): string {
  const skip = new Set(["россия", city.trim().toLowerCase()]);
  return address
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p && !skip.has(p.toLowerCase()))
    .join(", ");
}

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
export const formatDateFull = (iso: string) => new Date(iso).toLocaleDateString("ru-RU");

/** «50000», «50 000», «50к», «50 тыс» → 50000. */
export function parseMoney(text: string): number | null {
  const m = text
    .trim()
    .toLowerCase()
    .match(/^(\d[\d\s]*)([.,]\d+)?\s*(к|k|тыс\.?)?\s*(₽|руб\.?|р\.?)?$/);
  if (!m) return null;
  let value = parseFloat(`${m[1]!.replace(/\s/g, "")}${(m[2] ?? "").replace(",", ".")}`);
  if (m[3]) value *= 1000;
  value = Math.round(value);
  return value >= 1 && value <= 100_000_000 ? value : null;
}
