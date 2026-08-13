import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { loadDailyScore } from "@/lib/daily-score-load"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const day = new URL(req.url).searchParams.get("day")
  const valid = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined

  try {
    return NextResponse.json(await loadDailyScore(session.user.id, valid))
  } catch {
    return NextResponse.json({ error: "Failed to score" }, { status: 500 })
  }
}
