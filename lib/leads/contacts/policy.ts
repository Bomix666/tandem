// Какие email можно сохранять. Только публичные адреса бизнеса:
//   • на домене сайта компании — любой не личный адрес (info@, sales@,
//     request@, адрес с названием бизнеса…): он опубликован самой компанией;
//   • на бесплатной почте (gmail, mail.ru, …) или чужом домене — только если
//     адрес явно связан с названием бизнеса (blackbarber@gmail.com) — такие
//     помечаются 🟡 «Найден, не подтверждён».
// Личные адреса (имя.фамилия@, i.ivanov@) и всё непонятное не сохраняем.

export const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "yandex.ru", "ya.ru", "yandex.com", "yandex.by", "yandex.kz", "yandex.ua",
  "mail.ru", "bk.ru", "list.ru", "inbox.ru", "internet.ru", "rambler.ru", "lenta.ru", "autorambler.ru", "ro.ru",
  "icloud.com", "me.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "proton.me", "protonmail.com",
]);

// Общие ящики компании (без цифр и разделителей: info2, info-spb → info)
const ROLE_LOCALS = new Set([
  "info", "hello", "hi", "mail", "email", "post", "office", "contact", "contacts", "kontakt", "kontakty",
  "sales", "sale", "prodazhi", "support", "help", "service", "servis", "booking", "book", "zapis", "zakaz", "zakazy",
  "order", "orders", "reception", "admin", "administrator", "manager", "managers", "team", "client", "clients",
  "klient", "partner", "partners", "pr", "marketing", "reklama", "director", "dir", "shop", "store", "studio", "salon",
  "clinic", "klinika", "cafe", "kafe", "restaurant", "hotel", "welcome", "feedback", "otzyv", "general", "main", "corp",
]);

const NEVER = /^(no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster|hostmaster|webmaster|abuse|bounce|example|test|user|username|name|email|your|yourname|you|login|privacy|dpo|gdpr|hr|job|jobs|career|careers|resume|vacancy|rabota)$/;
const PLACEHOLDER_DOMAINS = /(^|\.)(example\.(com|ru|org)|domain\.(com|ru)|site\.(com|ru)|email\.(com|ru)|mail\.com|sentry\.io|wixpress\.com|sentry-next\.wixpress\.com|test\.ru)$/;

// Частые имена — признак личного адреса (anna.smirnova@, ivan_petrov@)
const FIRST_NAMES = new Set(
  (
    "aleksandr alexander alexandr sasha aleksey alexey alex andrey andrei anton artem artyom boris vadim valentin valery " +
    "vasily vasiliy viktor victor vitaly vladimir vlad vladislav vyacheslav gennady georgy german gleb grigory daniil danil " +
    "denis dmitry dmitriy dima evgeny evgeniy egor ivan igor ilya kirill konstantin leonid maksim maxim mikhail misha nikita " +
    "nikolay oleg pavel petr roman ruslan sergey sergei stanislav stepan timur fedor yury yuri yaroslav arseny matvey " +
    "aleksandra alexandra alina alla anastasia anastasiya nastya anna anya antonina valentina valeria vera veronika " +
    "viktoria victoria galina daria darya dasha diana evgenia ekaterina katya elena lena elizaveta zhanna zoya inna irina " +
    "karina kristina ksenia kseniya larisa lidia lyubov lyudmila margarita marina maria mariya masha nadezhda natalia " +
    "natalya natasha nina oksana olga polina raisa svetlana sveta sofia sofya tatiana tatyana tanya ulyana yulia yuliya " +
    "yana julia olesya alena alyona"
  ).split(" ")
);

const GENERIC_WORDS = new Set(
  (
    "barber barbershop barbershop barbershoop salon studio studiya beauty krasoty krasota kafe cafe coffee kofe kofeynya " +
    "restoran restaurant shop magazin market auto avto servis service center centr tsentr klinika clinic dental " +
    "stomatologiya stomatologia fitness club klub hotel gostinitsa cvety tsvety flowers remont nails nail manikur spa " +
    "medical group company the and plus pro best city moscow moskva spb piter russia rossiya ooo zao ip parikmaherskaya " +
    "parikmaherskaya hairdresser hair style stil master masterskaya home dom mir house"
  ).split(" ")
);

const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sh", ъ: "",
  ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Приведение к «скелету» для сравнения: латиница, без вариантов транслитерации. */
export function skeleton(s: string): string {
  return s
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => TRANSLIT[ch] ?? "")
    .replace(/shch|sch/g, "sh")
    .replace(/kh/g, "h")
    .replace(/ts|tz/g, "c")
    .replace(/ck|q/g, "k")
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/j/g, "y")
    .replace(/iu/g, "yu")
    .replace(/ia/g, "ya")
    .replace(/[^a-z0-9]/g, "");
}

/** Отличительные слова названия бизнеса (без «барбершоп», «салон», «кафе»…). */
export function brandTokens(name: string, siteDomain?: string): string[] {
  // «ФлагманСтом» → «Флагман», «Стом»: в адресе части названия бывают переставлены (stomflagman@)
  const words = name
    .split(/[^\p{L}\p{N}]+/u)
    .flatMap((w) => [w, ...w.split(/(?<=[a-zа-яё])(?=[A-ZА-ЯЁ])/u)])
    .filter(Boolean);
  const tokens = new Set<string>();
  for (const w of words) {
    const s = skeleton(w);
    if (s.length >= 4 && !GENERIC_WORDS.has(s)) tokens.add(s);
  }
  const whole = skeleton(name.replace(/[^\p{L}\p{N}]+/gu, ""));
  if (whole.length >= 6) tokens.add(whole);
  if (siteDomain) {
    const label = skeleton(siteDomain.split(".").slice(0, -1).join(""));
    if (label.length >= 4 && !GENERIC_WORDS.has(label)) tokens.add(label);
  }
  return [...tokens];
}

const SURNAME = /^[a-z]{3,}(ov|ova|ev|eva|in|ina|sky|skiy|skaya|enko|uk)$/;

/** Похож ли адрес на личный: имя.фамилия, i.ivanov, ivanova.anna, smirnova. */
export function looksPersonal(local: string): boolean {
  const parts = local.toLowerCase().split(/[._-]+/).map((p) => p.replace(/\d+$/, "")).filter(Boolean);
  if (parts.some((p) => FIRST_NAMES.has(p))) return true;
  if (parts.length === 2 && parts.some((p) => p.length === 1) && parts.some((p) => p.length >= 3)) return true; // i.ivanov
  if (parts.length === 1) return parts[0]!.length >= 6 && SURNAME.test(parts[0]!); // smirnova@
  return parts.some((p) => SURNAME.test(p));
}

export function isRoleLocal(local: string): string | null {
  const base = local.toLowerCase().split(/[._+-]/)[0]!.replace(/\d+$/, "");
  return ROLE_LOCALS.has(base) ? base : null;
}

export interface EmailContext {
  name: string; // название бизнеса
  siteDomain?: string; // домен собственного сайта, если есть
}

export type EmailDecision =
  | { accept: true; email: string; role: string; companyDomain: boolean; freeMail: boolean }
  | { accept: false; email: string; reason: string };

const domainOf = (email: string) => email.split("@")[1] ?? "";
const sameSite = (domain: string, site?: string) => !!site && (domain === site || domain.endsWith(`.${site}`));

export function classifyEmail(raw: string, ctx: EmailContext): EmailDecision {
  const email = raw.trim().toLowerCase();
  const [local = "", domain = ""] = email.split("@");
  const reject = (reason: string): EmailDecision => ({ accept: false, email, reason });
  if (!/^[a-z0-9][a-z0-9._%+-]{0,63}$/.test(local) || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/.test(domain) || local.includes("..")) {
    return reject("неверный формат");
  }
  if (NEVER.test(local.replace(/\d+$/, "")) || PLACEHOLDER_DOMAINS.test(domain)) return reject("служебный или шаблонный адрес");

  const site = ctx.siteDomain?.toLowerCase().replace(/^www\./, "");
  const companyDomain = sameSite(domain, site);
  const freeMail = FREE_MAIL.has(domain);
  const role = isRoleLocal(local);
  const tokens = brandTokens(ctx.name, site);
  const loc = skeleton(local);
  const brandInLocal = tokens.some((t) => loc.includes(t) || (loc.length >= 5 && t.includes(loc)));

  // общий ящик (admin@, info@) — не личный, даже если похож на фамилию
  if (!role && looksPersonal(local) && !(brandInLocal && tokens.some((t) => t.length >= 6 && loc.includes(t)))) {
    return reject("похоже на личный адрес");
  }
  if (companyDomain) {
    return { accept: true, email, role: role ?? (brandInLocal ? "brand" : "company"), companyDomain, freeMail };
  }
  if (freeMail) {
    return brandInLocal ? { accept: true, email, role: "brand", companyDomain, freeMail } : reject("бесплатная почта без названия бизнеса");
  }
  // чужой домен: только если сам домен — название бизнеса (сайт не указан или другой)
  const label = skeleton(domain.split(".").slice(0, -1).join(""));
  const brandDomain = tokens.some((t) => label.includes(t));
  if (brandDomain && (role || brandInLocal)) return { accept: true, email, role: role ?? "brand", companyDomain, freeMail };
  return reject("домен не относится к бизнесу");
}
