import { NextResponse } from "next/server";
import { z } from "zod";
import { toSearchDTO } from "@/lib/leads/dto";
import { startSearchJob, type StartSearchParams } from "@/lib/leads/jobs";
import { getSearch, listSearches } from "@/lib/leads/repository";
import { leadsAuth, leadsError, notFound } from "@/lib/leads/route-helpers";

// ответы зависят от пользователя (Telegram initData) — никакого статического рендера
export const dynamic = "force-dynamic";

// GET /api/leads/searches?page=0 — история поиска.
export async function GET(request: Request) {
  try {
    const { workspace } = await leadsAuth(request);
    const page = Math.max(0, Number(new URL(request.url).searchParams.get("page")) || 0);
    const { items, total } = await listSearches(workspace.id, page, 20);
    return NextResponse.json({ searches: items.map((s) => toSearchDTO(s)), total });
  } catch (err) {
    return leadsError(err);
  }
}

const startSchema = z.union([
  z.object({
    niche: z.string().trim().min(2).max(60),
    city: z.string().trim().min(2).max(60),
    requested: z.number().int().min(1).max(30),
    extra: z.string().trim().max(300).nullish(),
    /** osm — основной источник; yandex — тестовая интеграция (нужен ключ). */
    source: z.enum(["osm", "yandex"]).optional(),
  }),
  // «Найти ещё» / «Повторить» по существующему поиску
  z.object({ fromSearchId: z.string().min(1), mode: z.enum(["more", "retry"]) }),
]);

// POST /api/leads/searches — запускает поиск в фоне и сразу отвечает;
// прогресс — GET /api/leads/searches/:id.
export async function POST(request: Request) {
  try {
    const { user, workspace } = await leadsAuth(request);
    const body = startSchema.parse(await request.json());

    let params: Omit<StartSearchParams, "workspaceId" | "userId" | "chatId">;
    if ("fromSearchId" in body) {
      const prev = await getSearch(body.fromSearchId, workspace.id);
      if (!prev) return notFound();
      params = {
        niche: prev.niche,
        city: prev.city,
        requested: prev.requested,
        extra: prev.extra,
        source: prev.source === "yandex" ? "yandex" : "osm",
        parent: body.mode === "more" ? prev : null,
      };
    } else {
      params = { niche: body.niche, city: body.city, requested: body.requested, extra: body.extra || null, source: body.source ?? "osm" };
    }

    const result = await startSearchJob({ workspaceId: workspace.id, userId: user.id, chatId: null, ...params });
    if (result.status === "busy") return NextResponse.json({ error: "busy" }, { status: 409 });
    if (result.status === "not_configured") return NextResponse.json({ error: "not_configured" }, { status: 400 });
    return NextResponse.json({ search: toSearchDTO(result.search) }, { status: 201 });
  } catch (err) {
    return leadsError(err);
  }
}
