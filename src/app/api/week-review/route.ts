import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { generateWeeklyReview, readWeeklyReview, saveWeeklyReview } from "@/lib/weekly-review"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60 // full-context Opus generation runs tens of seconds

// The dashboard's weekly-review card. The Sunday cron writes the canonical
// review; GET serves it instantly, POST regenerates on demand through the
// same Emergy-brained generator (rate-limited — this is an Opus call).

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const review = await readWeeklyReview(session.user.id)
  return NextResponse.json({ review })
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const rl = checkRateLimit(userId, "week_review", 5, 24 * 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Regeneration limit reached for today.", resetAt: rl.resetAt },
      { status: 429 }
    )
  }

  const review = await generateWeeklyReview(userId)
  if (!review) {
    return NextResponse.json(
      { error: "Not enough data this week for a review — or AI is not configured." },
      { status: 503 }
    )
  }

  await saveWeeklyReview(userId, review)
  return NextResponse.json({ review })
}
