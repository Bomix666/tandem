import { NextResponse } from "next/server";
import { getDashboard } from "@/lib/leads/dashboard";
import { toDashboardDTO } from "@/lib/leads/dto";
import { leadsAuth, leadsError } from "@/lib/leads/route-helpers";

// ответы зависят от пользователя (Telegram initData) — никакого статического рендера
export const dynamic = "force-dynamic";

// GET /api/leads/dashboard — Sales OS: сегодня, воронка, outreach за день, ближайшее действие.
export async function GET(request: Request) {
  try {
    const { workspace } = await leadsAuth(request);
    const now = new Date();
    return NextResponse.json({ dashboard: toDashboardDTO(await getDashboard(workspace.id, now), now) });
  } catch (err) {
    return leadsError(err);
  }
}
