// Общее для /api/leads/*: та же авторизация через Telegram initData, что и у
// задач (lib/telegram-auth.ts), и тот же формат ошибок, что в app/api/tasks.

import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireAuthedUser, requireWorkspace } from "../telegram-auth";
import { redactError } from "./redact";

export async function leadsAuth(request: Request) {
  const user = await requireAuthedUser(request);
  const workspace = await requireWorkspace(user.id);
  return { user, workspace };
}

export function leadsError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof z.ZodError) return NextResponse.json({ error: err.flatten() }, { status: 400 });
  const status = (err as { status?: number })?.status ?? 500;
  if (status >= 500) console.error(redactError(err));
  return NextResponse.json({ error: status === 404 ? "Not found" : "Something went wrong" }, { status });
}

export function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
