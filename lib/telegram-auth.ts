import crypto from "crypto";
import { prisma } from "./prisma";

/**
 * Validates Telegram WebApp `initData` per Telegram's documented algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * NEVER trust user data sent from the frontend directly (no plain user_id in
 * headers/body). The frontend sends the raw `initData` string it received
 * from `window.Telegram.WebApp.initData`, and every API route re-validates
 * it against BOT_TOKEN server-side before touching the database.
 */

export interface TelegramUserPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // reject stale initData

export function validateInitData(initData: string): TelegramUserPayload | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  // Data-check-string: all fields except `hash`, sorted alphabetically,
  // joined with \n as "key=value".
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // Constant-time compare
  const a = Buffer.from(computedHash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const userJson = params.get("user");
  if (!userJson) return null;

  try {
    return JSON.parse(userJson) as TelegramUserPayload;
  } catch {
    return null;
  }
}

/**
 * Resolves (and upserts) the authenticated User + checks/enforces the
 * two-person workspace membership rule. Call this at the top of every
 * authenticated API route.
 */
export async function requireAuthedUser(request: Request) {
  const initData = request.headers.get("x-telegram-init-data");
  const devUserId = request.headers.get("x-dev-user-id");
  return authenticate(initData, devUserId);
}

/**
 * Same as requireAuthedUser, but reads initData (and the dev-mode user id)
 * from query string values instead of headers. EventSource (used for the
 * SSE stream) can't set custom headers, so that route authenticates this
 * way instead — the validation logic itself is identical.
 */
export async function requireAuthedUserFromQuery(searchParams: URLSearchParams) {
  return authenticate(searchParams.get("initData"), searchParams.get("devUserId"));
}

async function authenticate(initData: string | null, devUserId: string | null) {
  if (initData) return resolveAuthedUser(initData);
  return devOrThrow(devUserId);
}

async function devOrThrow(devUserId: string | null) {
  if (process.env.ALLOW_DEV_AUTH === "true" && process.env.NODE_ENV !== "production") {
    // Local development only. ALLOW_DEV_AUTH must never be true in prod —
    // enforced again below as a hard safety net regardless of env value.
    return devFallbackUser(devUserId ?? "1");
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH === "true") {
    // Hard safety net: refuse to boot the dev bypass in production even if
    // the env var was set by mistake.
    throw new AuthError("Dev auth bypass is disabled in production");
  }
  throw new AuthError("Missing Telegram authentication");
}

async function resolveAuthedUser(initData: string) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEV_AUTH === "true") {
    throw new AuthError("Dev auth bypass is disabled in production");
  }

  const tgUser = validateInitData(initData);
  if (!tgUser) throw new AuthError("Invalid Telegram authentication");

  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(tgUser.id) },
    update: {
      username: tgUser.username,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
      avatarUrl: tgUser.photo_url,
      lastSeenAt: new Date(),
    },
    create: {
      telegramId: BigInt(tgUser.id),
      username: tgUser.username,
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
      avatarUrl: tgUser.photo_url,
    },
  });

  return user;
}

/**
 * Dev-only stand-in for real Telegram users, keyed by a small numeric id
 * (default "1"). The frontend sends this as X-Dev-User-Id (see
 * lib/telegram-client.ts's getDevUserId()), letting you open two browser
 * windows — one plain, one with `?devUser=2` in the URL — and use the app
 * as two different people without any real Telegram account, bot, or
 * network access. Telegram IDs 1-9999 are reserved by Telegram itself and
 * will never collide with a real user, so this is safe even if a stray
 * dev-mode row ends up in a database that later sees real traffic.
 */
async function devFallbackUser(devUserId: string) {
  const numeric = Math.max(1, Math.min(9999, parseInt(devUserId, 10) || 1));
  return prisma.user.upsert({
    where: { telegramId: BigInt(numeric) },
    update: {},
    create: { telegramId: BigInt(numeric), firstName: `Тест ${numeric}`, username: `dev_user_${numeric}` },
  });
}

export class AuthError extends Error {
  status = 401;
}

/**
 * Returns the single workspace this user belongs to, or null.
 * A user can belong to at most one workspace (enforced by a unique
 * constraint on WorkspaceMember.userId), and a workspace can have at
 * most two members (enforced here at the application layer since it
 * depends on a COUNT, which Postgres constraints can't express directly).
 */
export async function getUserWorkspace(userId: string) {
  const membership = await prisma.workspaceMember.findUnique({
    where: { userId },
    include: { workspace: { include: { members: true } } },
  });
  return membership?.workspace ?? null;
}

export async function requireWorkspace(userId: string) {
  const workspace = await getUserWorkspace(userId);
  if (!workspace) {
    const err = new Error("No workspace") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return workspace;
}
