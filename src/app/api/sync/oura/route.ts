import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getDailySleep, getDailySleepScores, getDailyActivity, getDailyReadiness, getDailySpo2, getDailyStress, getOuraTags } from "@/lib/oura"
import { format, subDays } from "date-fns"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const userId = session.user.id
  const ouraToken = await prisma.ouraToken.findUnique({ where: { userId } })
  if (!ouraToken) return NextResponse.json({ error: "Oura Ring not connected" }, { status: 503 })

  try {
    const endDate = format(new Date(), "yyyy-MM-dd")
    const startDate = format(subDays(new Date(), 29), "yyyy-MM-dd")

    // Auto-provision sleepScore column (added after initial deploy)
    await prisma.$executeRaw`ALTER TABLE "HealthLog" ADD COLUMN IF NOT EXISTS "sleepScore" INTEGER`

    const [sleepData, sleepScoreData, activityData, readinessData, spo2Data, stressData] = await Promise.allSettled([
      getDailySleep(userId, startDate, endDate),
      getDailySleepScores(userId, startDate, endDate),
      getDailyActivity(userId, startDate, endDate),
      getDailyReadiness(userId, startDate, endDate),
      getDailySpo2(userId, startDate, endDate),
      getDailyStress(userId, startDate, endDate),
    ])

    const byDate = <T extends { date: string }>(result: PromiseSettledResult<T[]>): Record<string, T> =>
      result.status === "fulfilled"
        ? Object.fromEntries(result.value.map(r => [r.date, r]))
        : {}

    const sleep      = byDate(sleepData)
    const sleepScore = byDate(sleepScoreData)
    const activity   = byDate(activityData)
    const readiness  = byDate(readinessData)
    const spo2       = byDate(spo2Data)
    const stress     = byDate(stressData)

    const allDates = new Set([
      ...Object.keys(sleep),
      ...Object.keys(sleepScore),
      ...Object.keys(activity),
      ...Object.keys(readiness),
      ...Object.keys(spo2),
      ...Object.keys(stress),
    ])

    const upserts = Array.from(allDates).map(dateStr => {
      const date = new Date(dateStr + "T00:00:00.000Z")
      const s = sleep[dateStr]
      const sc = sleepScore[dateStr]
      const a = activity[dateStr]
      const r = readiness[dateStr]
      const o = spo2[dateStr]
      const t = stress[dateStr]

      const fields = {
        // Sleep core
        ...(s?.totalSleepSeconds  != null && { sleepDuration:        Math.round(s.totalSleepSeconds / 60) }),
        ...(s?.deepSleepSeconds   != null && { deepSleep:            Math.round(s.deepSleepSeconds / 60) }),
        ...(s?.remSleepSeconds    != null && { remSleep:             Math.round(s.remSleepSeconds / 60) }),
        ...(s?.lightSleepSeconds  != null && { lightSleep:           Math.round(s.lightSleepSeconds / 60) }),
        ...(s?.avgRestingHR       != null && { restingHR:            Math.round(s.avgRestingHR) }),
        ...(s?.hrv                != null && { hrv:                  s.hrv }),
        ...(s?.efficiency         != null && { sleepEfficiency:      s.efficiency }),
        ...(s?.latencySeconds     != null && { sleepLatency:         Math.round(s.latencySeconds / 60) }),
        // Sleep extended
        ...(s?.breathRate         != null && { breathingRate:        s.breathRate }),
        ...(s?.awakeTimeSeconds   != null && { awakeTime:            Math.round(s.awakeTimeSeconds / 60) }),
        ...(s?.timeInBedSeconds   != null && { timeInBed:            Math.round(s.timeInBedSeconds / 60) }),
        ...(s?.restlessPeriods    != null && { restlessPeriods:      s.restlessPeriods }),
        ...(s?.bedtimeStart       != null && { sleepStart:           new Date(s.bedtimeStart) }),
        ...(s?.bedtimeEnd         != null && { sleepEnd:             new Date(s.bedtimeEnd) }),
        // Activity core
        ...(a?.steps              != null && { steps:                a.steps }),
        ...(a?.activeCalories     != null && { caloriesBurned:       a.activeCalories }),
        ...(a?.totalCalories      != null && { totalCalories:        a.totalCalories }),
        ...(a?.distanceKm         != null && { distanceKm:           a.distanceKm }),
        ...(a?.activeMinutes      != null && { activeMinutes:        a.activeMinutes }),
        // Activity extended
        ...(a?.activityScore      != null && { activityScore:        a.activityScore }),
        ...(a?.sedentaryTimeSeconds != null && { sedentaryTime:      Math.round(a.sedentaryTimeSeconds / 60) }),
        // Readiness
        ...(r?.score              != null && { readinessScore:       r.score }),
        ...(r?.skinTemp           != null && { skinTemp:             r.skinTemp }),
        // SpO2
        ...(o?.spo2               != null && { spo2:                 o.spo2 }),
        ...(o?.breathingDisturbance != null && { breathingDisturbance: o.breathingDisturbance }),
        // Sleep score (from /daily_sleep, separate from /sleep metrics)
        ...(sc?.score             != null && { sleepScore:           sc.score }),
        // Stress
        ...(t?.stressHighMin      != null && { stressHigh:           t.stressHighMin }),
        ...(t?.recoveryHighMin    != null && { recoveryHigh:         t.recoveryHighMin }),
        syncedAt: new Date(),
      }

      return prisma.healthLog.upsert({
        where: { userId_date: { userId, date } },
        create: { userId, date, ...fields },
        update: fields,
      })
    })

    const results = await Promise.all(upserts)

    // Sync Oura tags (best-effort — table may not exist yet)
    let tagsSynced = 0
    try {
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "OuraTag" (
          "id"        TEXT PRIMARY KEY,
          "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
          "day"       TEXT NOT NULL,
          "timestamp" TIMESTAMPTZ NOT NULL,
          "text"      TEXT,
          "tags"      TEXT[] NOT NULL DEFAULT '{}'
        )
      `
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OuraTag_userId_day_idx" ON "OuraTag"("userId","day")`
      const tagData = await getOuraTags(userId, startDate, endDate)
      for (const t of tagData) {
        await prisma.$executeRaw`
          INSERT INTO "OuraTag"("id","userId","day","timestamp","text","tags")
          VALUES (${t.id},${userId},${t.day},${new Date(t.timestamp)},${t.text},${t.tags})
          ON CONFLICT("id") DO UPDATE SET "text"=EXCLUDED."text","tags"=EXCLUDED."tags"
        `
      }
      tagsSynced = tagData.length
    } catch {
      // silently skip if tag scope not granted yet
    }

    return NextResponse.json({ success: true, synced: results.length, tagsSynced })
  } catch (e) {
    console.error("Oura sync error:", e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
