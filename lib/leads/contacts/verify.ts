// Проверка email без отправки писем: формат + DNS (есть ли у домена почтовый
// сервер) + совпадение домена с сайтом компании. SMTP-зондирование не делаем:
// это похоже на рассылку спама и почтовые серверы за такое банят.
//
//   🟢 VALID       формат верный, MX есть, домен = сайт компании
//   🟡 UNVERIFIED  MX есть, но бесплатная почта / другой домен; или DNS не ответил
//   🔴 INVALID     битый формат, домена нет или он не принимает почту

import dns from "node:dns/promises";
import { FREE_MAIL } from "./policy";

export type EmailCheck = "VALID" | "UNVERIFIED" | "INVALID";

export interface EmailVerification {
  check: EmailCheck;
  note: string;
}

export type MxStatus = "mx" | "a_only" | "no_mail" | "nxdomain" | "dns_error";

export type MxResolver = (domain: string) => Promise<MxStatus>;

const FORMAT = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,24}$/;
const CACHE_MS = 6 * 3_600_000;
const cache = new Map<string, { at: number; status: Promise<MxStatus> }>();

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "ETIMEOUT" })), ms).unref()),
  ]);

async function lookupMx(domain: string): Promise<MxStatus> {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 5_000);
    // «нулевой MX» (RFC 7505): домен явно не принимает почту
    if (mx.length === 1 && (mx[0]!.exchange === "" || mx[0]!.exchange === ".")) return "no_mail";
    if (mx.length) return "mx";
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOTFOUND") return "nxdomain";
    if (code !== "ENODATA") return "dns_error";
  }
  // MX нет — по стандарту почта идёт на A-запись домена; это слабый признак
  try {
    const a = await withTimeout(dns.resolve4(domain), 5_000);
    return a.length ? "a_only" : "no_mail";
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code === "ENOTFOUND" ? "nxdomain" : code === "ENODATA" ? "no_mail" : "dns_error";
  }
}

/**
 * Подмена DNS для тестов: LEADS_MX_OVERRIDES="gmail.com=mx,dead.ru=nxdomain".
 * В production игнорируется.
 */
function overrides(): Map<string, MxStatus> | null {
  const raw = process.env.LEADS_MX_OVERRIDES;
  if (!raw || process.env.NODE_ENV === "production") return null;
  const map = new Map<string, MxStatus>();
  for (const pair of raw.split(",")) {
    const [d, s] = pair.split("=").map((x) => x?.trim());
    if (d && s) map.set(d.toLowerCase(), s as MxStatus);
  }
  return map;
}

export const defaultMxResolver: MxResolver = (domain) => {
  const o = overrides();
  if (o) return Promise.resolve(o.get(domain) ?? o.get("*") ?? "dns_error");
  const hit = cache.get(domain);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.status;
  const status = lookupMx(domain);
  cache.set(domain, { at: Date.now(), status });
  return status;
};

export async function verifyEmail(email: string, siteDomain: string | undefined, resolveMx: MxResolver = defaultMxResolver): Promise<EmailVerification> {
  const e = email.trim().toLowerCase();
  if (!FORMAT.test(e) || e.includes("..")) return { check: "INVALID", note: "неверный формат адреса" };
  const domain = e.split("@")[1]!;
  const status = await resolveMx(domain);
  if (status === "nxdomain") return { check: "INVALID", note: "домен не существует" };
  if (status === "no_mail") return { check: "INVALID", note: "домен не принимает почту" };
  if (status === "dns_error") return { check: "UNVERIFIED", note: "DNS не ответил — проверить не удалось" };

  const site = siteDomain?.toLowerCase().replace(/^www\./, "");
  const onSite = !!site && (domain === site || domain.endsWith(`.${site}`));
  if (status === "a_only") return { check: "UNVERIFIED", note: "у домена нет MX-записи — письмо может не дойти" };
  if (onSite) return { check: "VALID", note: "почтовый сервер есть, домен совпадает с сайтом компании" };
  if (FREE_MAIL.has(domain)) return { check: "UNVERIFIED", note: "бесплатная почта — не подтверждено, что это адрес компании" };
  return { check: "UNVERIFIED", note: "почтовый сервер есть, но домен отличается от сайта компании" };
}

export function resetMxCache() {
  cache.clear();
}
