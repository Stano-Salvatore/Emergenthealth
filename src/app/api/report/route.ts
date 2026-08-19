import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { buildHealthReport } from "@/lib/health-report"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60 // gathers every clinical table and writes a summary

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  // The narrative is an Opus call, so this isn't free to spam.
  const rl = checkRateLimit(userId, "health_report", 20, 24 * 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Report limit reached for today.", resetAt: rl.resetAt }, { status: 429 })
  }

  const days = Number(req.nextUrl.searchParams.get("days") ?? 90)
  const report = await buildHealthReport(userId, Number.isFinite(days) ? days : 90)

  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } })
}
