import { NextResponse } from "next/server";
import { getAnalytics } from "@/lib/leads/analytics";
import { leadsAuth, leadsError } from "@/lib/leads/route-helpers";
import type { AnalyticsDTO } from "@/types/leads";

export const dynamic = "force-dynamic";

// GET /api/leads/analytics?period=0|7|30 — воронка и коэффициенты по реальным данным.
export async function GET(request: Request) {
  try {
    const { workspace } = await leadsAuth(request);
    const p = Number(new URL(request.url).searchParams.get("period"));
    const analytics: AnalyticsDTO = await getAnalytics(workspace.id, p === 7 || p === 30 ? p : null);
    return NextResponse.json({ analytics });
  } catch (err) {
    return leadsError(err);
  }
}
