import { prisma } from "@/lib/prisma"
import { plausibleBreathRate, plausibleHeartRate, plausibleHrv, plausibleSpo2 } from "@/lib/vitals"
import {
  getDailySleep, getDailySleepScores, getDailyActivity, getDailyReadiness, getDailySpo2,
  getDailyStress, getOuraTags, getDailyCardiovascularAge, getVo2Max, getDailyResilience,
} from "@/lib/oura"
import { classifyOuraTag, INTAKE_KINDS } from "@/lib/oura-tag-classify"
import { estimateCaffeine } from "@/lib/caffeine"
import { format, subDays } from "date-fns"
import { isMeasuredNight } from "@/lib/sleep-quality"
import type { EndpointOutcome } from "@/lib/sync-status"

export type OuraSyncResult =
  | { ok: true; synced: number; tagsSynced: number; tagsError?: string; endpoints: Record<string, EndpointOutcome> }
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

    // allSettled, not all: these three are newer endpoints, and a plan or scope
    // that does not include one of them must not take the whole sync down with
    // it. A rejected promise simply contributes no days.
    const [
      sleepData, sleepScoreData, activityData, readinessData, spo2Data, stressData,
      cardioAgeData, vo2Data, resilienceData,
    ] = await Promise.allSettled([
      getDailySleep(userId, startDate, endDate),
      getDailySleepScores(userId, startDate, endDate),
      getDailyActivity(userId, startDate, endDate),
      getDailyReadiness(userId, startDate, endDate),
      getDailySpo2(userId, startDate, endDate),
      getDailyStress(userId, startDate, endDate),
      getDailyCardiovascularAge(userId, startDate, endDate),
      getVo2Max(userId, startDate, endDate),
      getDailyResilience(userId, startDate, endDate),
    ])

    // A rejected endpoint contributes no days — and used to do so in complete
    // silence, which left "Oura has no VO2 max for you" and "this token was
    // never granted that scope" looking identical from the outside: an empty
    // column either way, with nothing in the logs to tell them apart.
    //
    // warnIfEmpty covers the document that arrives and maps to nothing. This
    // covers the document that never arrives, which is the other half of the
    // same question and the one that actually bit: three new endpoints shipped,
    // three columns stayed empty, and the logs had no opinion about why.
    //
    // The outcomes are kept, not just logged. `console.warn` is the right place
    // for a developer reading a live tail; it is the wrong place for the answer
    // to "why is this column empty", because on Hobby the line is gone within
    // the hour and the column is still empty a week later.
    const endpoints: Record<string, EndpointOutcome> = {}

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byDate = (endpoint: string, result: PromiseSettledResult<any[]>): Record<string, any> => {
      if (result.status === "rejected") {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
        console.warn(`[oura] ${endpoint} request failed: ${reason}`)
        endpoints[endpoint] = { state: "failed", reason: reason.slice(0, 120) }
        return {}
      }
      endpoints[endpoint] = result.value.length === 0
        ? { state: "empty" }
        : { state: "ok", days: result.value.length }
      if (result.value.length === 0) {
        // Not an error. Oura publishes some of these on its own cadence, and a
        // plan or scope that excludes one returns an empty list rather than a
        // failure — so "no rows" is worth saying out loud before anyone spends
        // an afternoon deciding a key name was wrong.
        console.warn(`[oura] ${endpoint} returned no days for this window`)
      }
      return Object.fromEntries(result.value.map((r: any) => [r.date, r])) // eslint-disable-line @typescript-eslint/no-explicit-any
    }

    /**
     * What to write for SpO2: the value when it is plausible, an explicit null
     * when Oura sent an impossible one, and nothing at all when it sent none.
     */
    const spo2Correction = (value: number | null | undefined): { spo2?: number | null } => {
      if (value == null) return {}
      return plausibleSpo2(value) != null ? { spo2: value } : { spo2: null }
    }

    const sleep      = byDate("daily_sleep", sleepData)
    const sleepScore = byDate("daily_sleep_scores", sleepScoreData)
    const activity   = byDate("daily_activity", activityData)
    const readiness  = byDate("daily_readiness", readinessData)
    const spo2       = byDate("daily_spo2", spo2Data)
    const stress     = byDate("daily_stress", stressData)
    const cardioAge  = byDate("daily_cardiovascular_age", cardioAgeData)
    const vo2        = byDate("vO2_max", vo2Data)
    const resilience = byDate("daily_resilience", resilienceData)

    const allDates = new Set([
      ...Object.keys(sleep),
      ...Object.keys(sleepScore),
      ...Object.keys(activity),
      ...Object.keys(readiness),
      ...Object.keys(spo2),
      ...Object.keys(stress),
      ...Object.keys(cardioAge),
      ...Object.keys(vo2),
      ...Object.keys(resilience),
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
      const ca = cardioAge[dateStr]
      const v = vo2[dateStr]
      const res = resilience[dateStr]

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
        ...(plausibleHeartRate(s?.avgRestingHR) != null && { restingHR: Math.round(s!.avgRestingHR!) }),
        ...(plausibleHrv(s?.hrv)  != null && { hrv:                  s!.hrv }),
        ...(s?.efficiency         != null && { sleepEfficiency:      s.efficiency }),
        ...(s?.latencySeconds     != null && { sleepLatency:         Math.round(s.latencySeconds / 60) }),
        // Sleep extended
        ...(plausibleBreathRate(s?.breathRate) != null && { breathingRate: s!.breathRate }),
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
        // Not `!= null`: two days in this database hold an SpO2 of 0, which
        // that check waves through as a reading. See lib/vitals.
        // A number that arrived and failed the plausibility check is not the
        // same as no number at all, and the difference decides whether a bad
        // value already in the row survives.
        //
        // 21 nights in this database hold an SpO2 of exactly 0 — impossible,
        // written before the guard above existed, each one still drawn on the
        // Health chart as a plunge to zero. The guard stopped new ones and
        // could never repair those, because omitting the field leaves whatever
        // is already stored untouched. Writing null does repair them, on the
        // next sync that covers the day.
        //
        // Only when Oura actually sent something implausible, though. A day it
        // simply has no reading for must leave the stored value alone, or a
        // 30-day window would wipe every figure older than its own reach.
        ...(spo2Correction(o?.spo2)),
        ...(o?.breathingDisturbance != null && { breathingDisturbance: o.breathingDisturbance }),
        // Sleep score (from /daily_sleep, separate from /sleep metrics)
        ...(sc?.score             != null && { sleepScore:           sc.score }),
        // Stress
        ...(t?.stressHighMin      != null && { stressHigh:           t.stressHighMin }),
        ...(t?.recoveryHighMin    != null && { recoveryHigh:         t.recoveryHighMin }),
        ...(t?.summary            != null && { stressSummary:        t.summary }),

        // The long-range scores. Each updates on its own cadence — VO2 max
        // monthly at best — so a day without one is normal, not a gap, and the
        // spread keeps the previous value rather than nulling it.
        ...(ca?.vascularAge       != null && { cardiovascularAge:    ca.vascularAge }),
        ...(ca?.pulseWaveVelocity != null && { pulseWaveVelocity:    ca.pulseWaveVelocity }),
        ...(v?.vo2Max             != null && { vo2Max:               v.vo2Max }),
        ...(res?.level            != null && { resilienceLevel:      res.level }),
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

    return { ok: true, synced: results.length, tagsSynced, tagsError, endpoints }
  } catch (e) {
    console.error("[oura-sync] error:", e)
    return { ok: false, error: "Internal server error" }
  }
}
