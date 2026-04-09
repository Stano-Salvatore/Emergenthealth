import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { fetchExistHealthData } from "@/lib/exist-io"

// Debug: GET returns all attribute names from exist.io (paginated)
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const token = process.env.EXIST_IO_TOKEN
  if (!token) return NextResponse.json({ error: "EXIST_IO_TOKEN not configured" }, { status: 503 })
  try {
    const all: { name: string; label: string; value: unknown }[] = []
    let url: string | null = "https://exist.io/api/2/attributes/with-values/?limit=1"
    while (url) {
      const res = await fetch(url, { headers: { Authorization: `Token ${token}` }, cache: "no-store" })
      const raw = await res.json()
      for (const r of raw.results ?? []) {
        all.push({ name: r.name, label: r.label, value: r.values?.[0]?.value ?? null })
      }
      url = raw.next ?? null
    }
    return NextResponse.json(all)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const token = process.env.EXIST_IO_TOKEN
  if (!token) {
    return NextResponse.json({ error: "EXIST_IO_TOKEN not configured in environment variables" }, { status: 503 })
  }

  try {
    const dataByDate = await fetchExistHealthData(token, 7)
    const dates = Object.keys(dataByDate)

    if (dates.length === 0) {
      return NextResponse.json({ success: true, synced: 0, message: "No data returned from exist.io" })
    }

    const upserts = dates.map((dateStr) => {
      const attrs = dataByDate[dateStr]
      const date = new Date(dateStr + "T00:00:00.000Z")

      // exist.io sleep is in minutes, steps, heartrate, steps_active_min, calories_active
      const sleepDuration = attrs["sleep"] ?? undefined
      const deepSleep = attrs["deep_sleep"] ?? undefined
      const remSleep = attrs["rem_sleep"] ?? undefined
      const lightSleep = attrs["light_sleep"] ?? undefined
      const steps = attrs["steps"] ?? undefined
      const restingHR = attrs["heartrate_resting"] ?? attrs["heartrate"] ?? undefined
      const activeMinutes = attrs["steps_active_min"] ?? undefined
      const caloriesBurned = attrs["active_energy"] ?? attrs["calories_active"] ?? undefined

      return prisma.healthLog.upsert({
        where: { userId_date: { userId: session.user.id, date } },
        create: {
          userId: session.user.id,
          date,
          sleepDuration,
          deepSleep,
          remSleep,
          lightSleep,
          steps,
          restingHR,
          activeMinutes,
          caloriesBurned,
          syncedAt: new Date(),
        },
        update: {
          ...(sleepDuration != null && { sleepDuration }),
          ...(deepSleep != null && { deepSleep }),
          ...(remSleep != null && { remSleep }),
          ...(lightSleep != null && { lightSleep }),
          ...(steps != null && { steps }),
          ...(restingHR != null && { restingHR }),
          ...(activeMinutes != null && { activeMinutes }),
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
