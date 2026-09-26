import { NextResponse } from "next/server";
import { deliverDueNotifications, scheduleOverdueNotifications } from "@/lib/notifications";

// Protect with a shared secret so this isn't a public "send notifications"
// endpoint. Configure your scheduler to call:
//   GET /api/notifications/cron?secret=CRON_SECRET
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const overdueScheduled = await scheduleOverdueNotifications();
  const delivered = await deliverDueNotifications();
  return NextResponse.json({ overdueScheduled, delivered });
}
