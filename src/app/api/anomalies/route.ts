import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { scanUserAnomalies, MIN_HISTORY_DAYS } from "@/lib/anomaly-scan"

// Cheap by design — one indexed query and some median arithmetic — so unlike
// the correlation run this needs no cache.

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const { anomalies, days, latestDate, stale } = await scanUserAnomalies(session.user.id)
    return NextResponse.json({
      anomalies,
      days,
      latestDate,
      stale,
      enoughHistory: days >= MIN_HISTORY_DAYS + 1,
    })
  } catch {
    return NextResponse.json({ error: "Failed to scan" }, { status: 500 })
  }
}
