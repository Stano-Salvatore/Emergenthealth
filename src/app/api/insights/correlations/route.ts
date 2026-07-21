import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { computeCorrelations, PERIOD_DAYS } from "@/lib/correlations"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const userId = session.user.id

  const url = new URL(req.url)
  const period = url.searchParams.get("period") ?? "overall"
  const windowDays = PERIOD_DAYS[period] ?? 90

  const { insights, totalDays } = await computeCorrelations(userId, windowDays)

  return NextResponse.json({
    insights,
    dataRange: { days: totalDays },
  })
}
