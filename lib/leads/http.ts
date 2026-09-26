// HTTP-утилиты модуля. fetchPublicPage — для сайтов бизнесов: адреса приходят
// из чужих данных (Яндекс, OSM), поэтому запрещаем внутренние адреса
// (localhost, 10.x, db:5432 и т. п.) на каждом шаге редиректа — иначе
// «сайт» мог бы указывать внутрь нашей docker-сети.

import dns from "node:dns/promises";
import net from "node:net";

export class UnsafeUrlError extends Error {}

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  const [a = 0, b = 0] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return true;
  if (v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")) return true;
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIPv4(mapped[1]!) : false;
}

export async function assertPublicUrl(url: URL, allowPrivate: boolean): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("unsupported protocol");
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError("private address");
    return;
  }
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("internal hostname");
  }
  const addrs = await dns.lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError("private address");
}

export interface FetchedPage {
  status: number;
  finalUrl: string;
  contentType: string;
  server: string;
  body: Buffer;
}

export async function fetchPublicPage(
  rawUrl: string,
  opts: { timeoutMs: number; maxBytes: number; userAgent: string; allowPrivate: boolean }
): Promise<FetchedPage> {
  const signal = AbortSignal.timeout(opts.timeoutMs);
  let url = new URL(rawUrl);

  for (let hop = 0; hop < 6; hop++) {
    await assertPublicUrl(url, opts.allowPrivate);
    const res = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": opts.userAgent, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" },
    });

    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      url = new URL(location, url);
      continue;
    }

    return {
      status: res.status,
      finalUrl: url.toString(),
      contentType: res.headers.get("content-type") ?? "",
      server: res.headers.get("server") ?? "",
      body: await readLimited(res, opts.maxBytes),
    };
  }
  throw new Error("too many redirects");
}

async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    total += value.byteLength;
  }
  await reader.cancel().catch(() => void 0);
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

/** Декодирует HTML с учётом кодировки: старые русские сайты часто в windows-1251. */
export function decodeHtml(body: Buffer, contentType: string): string {
  const head = body.subarray(0, 4096).toString("latin1");
  const charset =
    contentType.match(/charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    "utf-8";
  try {
    return new TextDecoder(charset.toLowerCase()).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** JSON-запрос к API с таймаутом; при ошибке HTTP — HttpError со статусом. */
export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs: number }): Promise<T> {
  const { timeoutMs, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new HttpError(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, res.status);
  }
  return (await res.json()) as T;
}
