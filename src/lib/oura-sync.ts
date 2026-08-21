import { prisma } from "@/lib/prisma"
import { getDailySleep, getDailySleepScores, getDailyActivity, getDailyReadiness, getDailySpo2, getDailyStress, getOuraTags } from "@/lib/oura"
import { classifyOuraTag, INTAKE_KINDS } from "@/lib/oura-tag-classify"
import { estimateCaffeine } from "@/lib/caffeine"
import { format, subDays } from "date-fns"
import { isMeasuredNight } from "@/lib/sleep-quality"

export type OuraSyncResult =
  | { ok: true; synced: number; tagsSynced: number; tagsError?: string }
  | { ok: false; error: string; notConnected?: boolean }

/**
 * Pull the last 30 days of Oura data for a user and upsert it into HealthLog
 * (+ OuraTag). Pure server-side — works from an API route or a cron, no
 * session required. Returns a result object instead of an HTTP response.
 */
export async function syncOuraForUser(userId: string): Promise<OuraSyncResult> {
  const ouraToken = await prisma.ouraToken.findUnique({ where: { userId } })
  if (!ouraToken) return { ok: false, error: "Oura Ring not connected", notConnected: true }

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byDate = (result: PromiseSettledResult<any[]>): Record<string, any> =>
      result.status === "fulfilled"
        ? Object.fromEntries(result.value.map((r: any) => [r.date, r])) // eslint-disable-line @typescript-eslint/no-explicit-any
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
      // A session the ring wasn't awake for isn't a night. Dropping it here
      // means the day reads as "not measured" — a dash — rather than as a
      // nine-minute night that drags the averages and hands the correlation
      // engine evidence for a pattern that never happened.
      const rawSleep = sleep[dateStr]
      const s = rawSleep && isMeasuredNight(rawSleep) ? rawSleep : undefined
      const sc = sleepScore[dateStr]
      const a = activity[dateStr]
      const r = readiness[dateStr]
      const o = spo2[dateStr]
      const t = stress[dateStr]

      // When Oura published a session for this day but it fails the test, the
      // values already stored came from that same fragment — so clearing them
      // is correcting our own bad write, not clobbering another source. A day
      // with no session at all is left untouched: that one might be Samsung's.
      const unmeasuredNight = rawSleep != null && s == null
      const clearedSleep = unmeasuredNight ? {
        sleepDuration: null, deepSleep: null, remSleep: null, lightSleep: null,
        restingHR: null, hrv: null, sleepEfficiency: null, sleepLatency: null,
        breathingRate: null, awakeTime: null, timeInBed: null,
        restlessPeriods: null, sleepStart: null, sleepEnd: null,
      } : {}

      const fields = {
        ...clearedSleep,
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
    let tagsError: string | undefined
    // A token authorized before the "tag" scope joined the OAuth request keeps
    // its old permissions forever: sleep syncs fine while every tag request
    // 403s. That's worth explaining rather than surfacing a bare API error —
    // but it's a diagnosis for a failure, not a reason to skip the attempt.
    //
    // Refusing up front on a string comparison meant a freshly reconnected
    // account with `tag` granted was told its connection "predates tag
    // permission" and never tried, because the scope Oura echoes back doesn't
    // have to match the wording we asked for. The API is the authority on what
    // the token can do; the stored scope is a hint used to phrase the error.
    const storedScope = ouraToken.scope?.trim()
    const scopeLooksMissingTag = !!storedScope && !storedScope.split(/[\s,]+/).includes("tag")
    try {
      await prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS "OuraTag" (
          "id"        TEXT PRIMARY KEY,
          "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
          "day"       TEXT NOT NULL,
          "timestamp" TIMESTAMPTZ NOT NULL,
          "tagName"   TEXT,
          "text"      TEXT,
          "tags"      TEXT[] NOT NULL DEFAULT '{}'
        )
      `
      await prisma.$executeRaw`CREATE INDEX IF NOT EXISTS "OuraTag_userId_day_idx" ON "OuraTag"("userId","day")`
      await prisma.$executeRaw`ALTER TABLE "OuraTag" ADD COLUMN IF NOT EXISTS "tagName" TEXT`
      const tagData = await getOuraTags(userId, startDate, endDate)
      for (const t of tagData) {
        // A tag with no resolvable date can't be stored (the column is NOT
        // NULL) and would abort the whole loop — skip it rather than lose the
        // rest of the batch.
        if (!t.day || !t.id) continue
        const tagsLiteral = `{${t.tags.join(",")}}`
        const tagName = t.tagName || null
        const text = t.comment || null
        await prisma.$executeRaw`
          INSERT INTO "OuraTag"("id","userId","day","timestamp","tagName","text","tags")
          VALUES (${t.id},${userId},${t.day},${new Date(t.timestamp)},${tagName},${text},${tagsLiteral}::text[])
          ON CONFLICT("id") DO UPDATE
            SET "tagName"=EXCLUDED."tagName","text"=EXCLUDED."text","tags"=EXCLUDED."tags"
        `
      }

      // Auto-create TagAlias for any UUID that has a resolved name, without
      // overriding aliases the user already set manually via the rename modal.
      const uuidNameMap = new Map<string, string>()
      for (const t of tagData) {
        if (t.uuid && t.tagName && !uuidNameMap.has(t.uuid)) {
          uuidNameMap.set(t.uuid, t.tagName)
        }
      }
      if (uuidNameMap.size > 0) {
        const existing = await prisma.$queryRaw<{ tagTypeUuid: string }[]>`
          SELECT "tagTypeUuid" FROM "TagAlias" WHERE "userId" = ${userId}
        `
        const existingUuids = new Set(existing.map(r => r.tagTypeUuid))
        for (const [uuid, name] of uuidNameMap.entries()) {
          if (!existingUuids.has(uuid)) {
            await prisma.$executeRaw`
              INSERT INTO "TagAlias"("userId","tagTypeUuid","name")
              VALUES (${userId}, ${uuid}, ${name})
              ON CONFLICT DO NOTHING
            `
          }
        }
      }

      // Mirror drink tags into IntakeLog so water/coffee/alcohol logged in the
      // Oura app show up everywhere intake does (Intake page, dashboard,
      // Emergy) from one source. Deterministic ids make the upsert idempotent.
      for (const t of tagData) {
        const label = [t.tagName, t.comment].filter(Boolean).join(" ").trim()
        if (!label) continue
        const { kind, ml } = classifyOuraTag(label)
        if (!INTAKE_KINDS.has(kind) || ml <= 0) continue
        await prisma.intakeLog.upsert({
          where: { id: `oura_${t.id}` },
          create: {
            id: `oura_${t.id}`,
            userId,
            type: kind,
            amountMl: ml,
            note: `${t.tagName || label} (Oura)`,
            loggedAt: new Date(t.timestamp),
          },
          update: { type: kind, amountMl: ml },
        }).catch(() => null)

        // ring-logged coffee/tea/matcha auto-feeds the caffeine tracker too
        const est = estimateCaffeine(kind, label, ml)
        if (est) {
          await prisma.caffeineLog.upsert({
            where: { id: `oura_caf_${t.id}` },
            create: {
              id: `oura_caf_${t.id}`,
              userId,
              compound: est.compound,
              caffeineMg: est.mg,
              loggedAt: new Date(t.timestamp),
            },
            update: { compound: est.compound, caffeineMg: est.mg },
          }).catch(() => null)
        }
      }

      tagsSynced = tagData.length
    } catch (tagErr) {
      console.error("[oura-sync] tag sync error:", tagErr)
      // Surface instead of silently skipping — an Oura connection made before
      // the "tag" scope was requested can sync sleep fine while every tag
      // fetch 403s, which looks like the user's tags are being ignored.
      const raw = tagErr instanceof Error ? tagErr.message : "Tag sync failed"
      const denied = /\b(401|403)\b|unauthor|forbidden|scope/i.test(raw)
      tagsError = denied
        ? (scopeLooksMissingTag
            ? `Oura refused the tag request and this connection's stored permissions don't include "tag" — disconnect and reconnect Oura below to grant it. (${raw})`
            : `Oura refused the tag request: ${raw}. If reconnecting doesn't help, check the Tag scope is enabled on the app at cloud.ouraring.com.`)
        : raw
    }

    return { ok: true, synced: results.length, tagsSynced, tagsError }
  } catch (e) {
    console.error("[oura-sync] error:", e)
    return { ok: false, error: "Internal server error" }
  }
}
