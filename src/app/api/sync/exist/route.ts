import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { fetchExistHealthData } from "@/lib/exist-io"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const token = process.env.EXIST_IO_TOKEN
  if (!token) {
    return NextResponse.json({ error: "EXIST_IO_TOKEN not configured" }, { status: 503 })
  }

  try {
    // Fetch 30 days to keep charts well-populated
    const dataByDate = await fetchExistHealthData(token, 30)
    const dates = Object.keys(dataByDate)

    if (dates.length === 0) {
      return NextResponse.json({ success: true, synced: 0, message: "No data from exist.io" })
    }

    const upserts = dates.map((dateStr) => {
      const a = dataByDate[dateStr]
      const date = new Date(dateStr + "T00:00:00.000Z")

      const sleepDuration  = a["sleep"]                                     ?? undefined
      const deepSleep      = a["deep_sleep"]                                 ?? undefined
      const remSleep       = a["rem_sleep"]                                  ?? undefined
      const lightSleep     = a["light_sleep"]                                ?? undefined
      const steps          = a["steps"]                                      ?? undefined
      const restingHR      = a["heartrate_resting"] ?? a["heartrate"]        ?? undefined
      const activeMinutes  = a["steps_active_min"]                           ?? undefined
      const caloriesBurned = a["active_energy"] ?? a["calories_active"]      ?? undefined
      const weight         = a["weight"]                                     ?? undefined

      return prisma.healthLog.upsert({
        where: { userId_date: { userId: session.user.id, date } },
        create: {
          userId: session.user.id,
          date,
          ...(sleepDuration  != null && { sleepDuration }),
          ...(deepSleep      != null && { deepSleep }),
          ...(remSleep       != null && { remSleep }),
          ...(lightSleep     != null && { lightSleep }),
          ...(steps          != null && { steps }),
          ...(restingHR      != null && { restingHR }),
          ...(activeMinutes  != null && { activeMinutes }),
          ...(caloriesBurned != null && { caloriesBurned }),
          ...(weight         != null && { weight }),
          syncedAt: new Date(),
        },
        update: {
          ...(sleepDuration  != null && { sleepDuration }),
          ...(deepSleep      != null && { deepSleep }),
          ...(remSleep       != null && { remSleep }),
          ...(lightSleep     != null && { lightSleep }),
          ...(steps          != null && { steps }),
          ...(weight         != null && { weight }),
          ...(restingHR      != null && { restingHR }),
          ...(activeMinutes  != null && { activeMinutes }),
          ...(caloriesBurned != null && { caloriesBurned }),
          syncedAt: new Date(),
        },
      })
    })

    const results = await Promise.all(upserts)
    return NextResponse.json({ success: true, synced: results.length })
  } catch (e) {
    console.error("exist.io sync error:", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
