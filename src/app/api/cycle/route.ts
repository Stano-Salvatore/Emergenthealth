import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { latestFerritin, loadCycle, loadPhaseAverages } from "@/lib/cycle-load"

export const dynamic = "force-dynamic"

// Everything the cycle page shows, worked out on the server with the user's
// own timezone and the ring's temperature: the logged days, today's phase and
// predictions, the averages by phase, and the latest ferritin from Labs.
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const userId = session.user.id
  try {
    const load = await loadCycle(userId)
    const [averages, ferritin] = await Promise.all([
      load.visibility === "on" ? loadPhaseAverages(userId, load) : null,
      load.visibility === "on" ? latestFerritin(userId) : null,
    ])
    return NextResponse.json({
      settings: load.settings,
      visibility: load.visibility,
      todayStr: load.todayStr,
      logs: load.logs,
      today: load.today,
      // The current cycle's nights only: enough to draw the temperature shift.
      temps: load.today.currentStart ? load.temps.filter(t => t.date >= load.today.currentStart!) : [],
      averages,
      ferritin,
    })
  } catch (e) {
    console.error("[cycle] load failed:", e)
    return NextResponse.json({ error: "Couldn't load the cycle just now." }, { status: 500 })
  }
}
