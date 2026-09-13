import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getUserTimezone } from "@/lib/user-timezone"
import { localDateStr } from "@/lib/local-date"
import { loadDriftReport, rollingWindows } from "@/lib/drift-load"
import { driftQuestion } from "@/lib/drift"

export const dynamic = "force-dynamic"

// The last 30 days against the 30 before, for the card on the Patterns page.
//
// Rolling, not calendar. The monthly push compares September to August, which
// is the right frame for a message that arrives on the 1st and the wrong one
// for a screen you can open on the 14th — on that day "last month" is a
// fortnight stale, and the shift you want to ask about is the one happening
// now. `rollingWindows` is what the chat tool already uses for the same reason.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id

  const timezone = await getUserTimezone(userId)
  const windows = rollingWindows(localDateStr(timezone))

  try {
    const report = await loadDriftReport(userId, timezone, windows)
    return NextResponse.json({
      ...report,
      // Built here rather than in the card, so the push, the chat tool and this
      // screen cannot end up asking three subtly different questions.
      question: driftQuestion(report),
    })
  } catch (e) {
    console.error("[api/insights/drift] failed:", e)
    return NextResponse.json({ error: "Couldn't compare those two months." }, { status: 500 })
  }
}
