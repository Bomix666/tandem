import { requireAuthedUserFromQuery, requireWorkspace, AuthError } from "@/lib/telegram-auth";
import { subscribe, type RealtimeEvent } from "@/lib/pubsub";

// Требует Node runtime (не Edge) — состояние в lib/pubsub.ts живёт в памяти
// процесса, Edge-функции такую память между вызовами не делят.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// EventSource (браузерный API для SSE) не умеет ставить кастомные
// заголовки, поэтому auth-данные передаются как query-параметры
// (initData и, в dev-режиме, devUserId) — см. requireAuthedUserFromQuery
// в lib/telegram-auth.ts. Для обычных fetch-запросов везде используются
// заголовки, это исключение только для этого роута.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  let workspaceId: string;
  try {
    const user = await requireAuthedUserFromQuery(searchParams);
    const workspace = await requireWorkspace(user.id);
    workspaceId = workspace.id;
  } catch (err) {
    if (err instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: RealtimeEvent | { type: "connected" }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller уже закрыт — игнорируем, cleanup случится по abort
        }
      };

      send({ type: "connected" });
      unsubscribe = subscribe(workspaceId, send);

      // Комментарий-пинг раз в 25с, чтобы прокси/CDN не закрывали простаивающее соединение.
      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          /* ignore */
        }
      }, 25000);

      request.signal.addEventListener("abort", () => {
        if (keepAlive) clearInterval(keepAlive);
        if (unsubscribe) unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      if (keepAlive) clearInterval(keepAlive);
      if (unsubscribe) unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // отключает буферизацию у nginx, если он стоит перед приложением
    },
  });
}
