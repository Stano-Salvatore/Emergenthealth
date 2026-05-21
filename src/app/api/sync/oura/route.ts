import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getDailySleep, getSteps, getCalories } from "@/lib/oura"
import { format, subDays } from "date-fns"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id

  const ouraToken = await prisma.ouraToken.findUnique({ where: { userId } })
  if (!ouraToken) {
    return NextResponse.json({ error: "Oura Ring not connected" }, { status: 503 })
  }

  try {
    const endDate = format(new Date(), "yyyy-MM-dd")
    const startDate = format(subDays(new Date(), 29), "yyyy-MM-dd")

    const [sleepData, stepsData, caloriesData] = await Promise.all([
      getDailySleep(userId, startDate, endDate),
      getSteps(userId, startDate, endDate),
      getCalories(userId, startDate, endDate),
    ])

    const sleepByDate = Object.fromEntries(sleepData.map(s => [s.date, s]))
    const stepsByDate = Object.fromEntries(stepsData.map(s => [s.date as string, s]))
    const caloriesByDate = Object.fromEntries(caloriesData.map(s => [s.date as string, s]))

    const allDates = new Set([
      ...sleepData.map(s => s.date),
      ...stepsData.map(s => s.date as string),
      ...caloriesData.map(s => s.date as string),
    ])

    const upserts = Array.from(allDates).map(dateStr => {
      const date = new Date(dateStr + "T00:00:00.000Z")
      const sleep = sleepByDate[dateStr]
      const steps = stepsByDate[dateStr]
      const cals = caloriesByDate[dateStr]

      const sleepDuration  = sleep?.totalSleepSeconds  != null ? Math.round(sleep.totalSleepSeconds / 60)  : undefined
      const deepSleep      = sleep?.deepSleepSeconds   != null ? Math.round(sleep.deepSleepSeconds / 60)   : undefined
      const remSleep       = sleep?.remSleepSeconds    != null ? Math.round(sleep.remSleepSeconds / 60)    : undefined
      const lightSleep     = sleep?.lightSleepSeconds  != null ? Math.round(sleep.lightSleepSeconds / 60)  : undefined
      const restingHR      = sleep?.avgRestingHR       != null ? Math.round(sleep.avgRestingHR)            : undefined
      const stepCount      = steps?.steps              != null ? (steps.steps as number)                   : undefined
      const caloriesBurned = cals?.calories            != null ? (cals.calories as number)                 : undefined

      const fields = {
        ...(sleepDuration  != null && { sleepDuration }),
        ...(deepSleep      != null && { deepSleep }),
        ...(remSleep       != null && { remSleep }),
        ...(lightSleep     != null && { lightSleep }),
        ...(restingHR      != null && { restingHR }),
        ...(stepCount      != null && { steps: stepCount }),
        ...(caloriesBurned != null && { caloriesBurned }),
        syncedAt: new Date(),
      }

      return prisma.healthLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, ...fields },
        update: fields,
      })
    })

    const results = await Promise.all(upserts)
    return NextResponse.json({ success: true, synced: results.length })
  } catch (e) {
    console.error("Oura sync error:", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
