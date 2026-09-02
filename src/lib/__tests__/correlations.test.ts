import { describe, it, expect, vi } from "vitest"

// Synthetic 40-day history with planted effects, served through a mocked
// Prisma client — the engine should rediscover every planted correlation.
//
// Even-index days: late dinner (21:30), high protein/calories/sugar, 2.5L
// water, a 1h Strava workout.
// Odd-index days:  early dinner (18:00), light eating, 1L water, magnesium.
// Next-day recordings: energy 5 after even days / 2 after odd days;
// sleep score 65 after late-meal days / 90 after early dinners (= magnesium
// days); readiness 85 after workout days / 65 after rest days.
// Mood comes only from standalone MoodLog rows (check-ins carry none) to
// prove the engine reads the mood table it used to ignore.

const { DAYS, healthLogs, checkIns, moodLogs, foodLogs, waterLogs, ouraTags, stravaRows, alcoholLogs, caffeineLogs, caffeineLogsLate, symptomRows, rescueRows, lastfmRows, genreRows } = vi.hoisted(() => {
  const DAYS = 40
  const dates: string[] = []
  const now = new Date()
  for (let i = DAYS; i >= 1; i--) {
    const d = new Date(now.getTime() - i * 86400000)
    dates.push(d.toISOString().slice(0, 10))
  }
  const isEven = (i: number) => i % 2 === 0
  // Magnesium days are the odd ones; on every other magnesium day there was
  // also alcohol, and those nights sleep worse (70) than magnesium alone (90).
  const drankOn = (i: number) => !isEven(i) && i % 4 === 1

  return {
    DAYS,
    healthLogs: dates.map((ds, i) => ({
      date: new Date(ds + "T00:00:00Z"),
      // day i records the night after day i-1's dinner
      sleepScore: i === 0 ? null : drankOn(i - 1) ? 70 : isEven(i - 1) ? 65 : 90,
      sleepDuration: null,
      readinessScore: i === 0 ? null : isEven(i - 1) ? 85 : 65,
      restingHR: null,
      stressHigh: null, hrv: i === 0 ? null : isEven(i - 1) ? 40 : 62,
      steps: null, activityScore: null,
      // Deep sleep is suppressed on the nights following a Frontin day
      deepSleep: i === 0 ? null : i - 1 < 20 ? 40 : 80,
      remSleep: null,
    })),
    checkIns: dates.map((ds, i) => ({
      date: ds,
      energy: i === 0 ? 3 : isEven(i - 1) ? 5 : 2,
      mood: null,
    })),
    // Standalone mood logs, same rhythm as energy
    moodLogs: dates.map((ds, i) => ({
      date: new Date(ds + "T00:00:00Z"),
      mood: i === 0 ? 3 : isEven(i - 1) ? 5 : 2,
    })),
    stravaRows: dates.filter((_, i) => isEven(i)).map(ds => ({
      day: ds, movingTimeSec: 3600,
    })),
    // Raw intake rows — the engine sums them per local day itself now
    alcoholLogs: dates.filter((_, i) => drankOn(i)).map(ds => ({ loggedAt: new Date(ds + "T20:00:00Z"), amountMl: 200 })),
    // Strong coffee on the late-dinner days (their nights score 65), a small
    // one otherwise (90) — a planted "caffeine hurts tonight's sleep" that
    // only comes out if the coffee is joined to the night AFTER it, not the
    // record dated the same day (which is the night before)
    caffeineLogs: dates.map((ds, i) => ({ loggedAt: new Date(ds + "T15:00:00Z"), caffeineMg: isEven(i) ? 300 : 50 })),
    // The same doses at 22:30 UTC — which is 00:30 the next day in Prague
    caffeineLogsLate: dates.map((ds, i) => ({ loggedAt: new Date(ds + "T22:30:00Z"), caffeineMg: isEven(i) ? 300 : 50 })),
    // A headache the morning after every drinking day, and nothing otherwise —
    // days with no entry have to count as severity 0 for this to be findable.
    symptomRows: dates
      .map((ds, i) => ({ ds, i }))
      .filter(({ i }) => i > 0 && drankOn(i - 1))
      .map(({ ds }) => ({ day: ds, name: "Headache", severity: 4 })),
    foodLogs: dates.map((ds, i) => ({
      loggedAt: new Date(ds + (isEven(i) ? "T21:30:00Z" : "T18:00:00Z")),
      calories: isEven(i) ? 2200 : 1400,
      proteinG: isEven(i) ? 110 : 40,
      sugarG: isEven(i) ? 85 : 20,
    })),
    waterLogs: dates.map((ds, i) => ({
      loggedAt: new Date(ds + "T12:00:00Z"),
      amountMl: isEven(i) ? 2500 : 1000,
    })),
    // Productive hours track the same rhythm as mood (high on the days mood
    // is 5), so the work family has a planted effect to rediscover.
    rescueRows: dates.map((ds, i) => ({
      date: ds,
      productiveH: i > 0 && isEven(i - 1) ? 6 : 1,
      distractingH: i > 0 && isEven(i - 1) ? 0.5 : 4,
    })),
    // Every day has music; the GENRE tracks the mood rhythm. Ambient tops the
    // days mood lands on 5, black metal the days it lands on 2 — so the genre
    // family has a planted contrast that the volume family can't see (volume
    // is identical everywhere).
    lastfmRows: dates.map((ds, i) => ({
      date: ds,
      listeningMin: 90,
      lateTracks: null,
      topArtist: i > 0 && isEven(i - 1) ? "Ambient Guy" : "DG 307",
    })),
    genreRows: [
      { artist: "ambient guy", genre: "ambient" },
      { artist: "dg 307", genre: "black metal" },
    ],
    ouraTags: [
      ...dates.filter((_, i) => !isEven(i)).map(ds => ({
        day: ds, tagName: "Magnesium", text: null,
      })),
      // A prescription med taken every day for the first 20 days, then a real
      // gap — the adherence pattern the residual model exists for. Frontin's
      // 12 h half-life means it's genuinely washed out a day or two into the
      // gap, so the two halves are a clean on/off contrast.
      ...dates.slice(0, 20).map(ds => ({ day: ds, tagName: "Frontin", text: null })),
    ],
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn().mockResolvedValue(healthLogs) },
    habitCompletion: { findMany: vi.fn().mockResolvedValue([]) },
    weatherLog: { findMany: vi.fn().mockResolvedValue([]) },
    screenTimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    deviceCalendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
    intakeLog: { findMany: vi.fn((args: { where?: { type?: unknown } }) => Promise.resolve(args?.where?.type === "alcohol" ? alcoholLogs : waterLogs)) },
    caffeineLog: { findMany: vi.fn().mockResolvedValue(caffeineLogs) },
    foodLog: { findMany: vi.fn().mockResolvedValue(foodLogs) },
    ouraTag: { findMany: vi.fn().mockResolvedValue(ouraTags) },
    moodLog: { findMany: vi.fn().mockResolvedValue(moodLogs) },
    stravaActivity: { findMany: vi.fn().mockResolvedValue(stravaRows) },
    symptomLog: { findMany: vi.fn().mockResolvedValue(symptomRows) },
    focusSession: { findMany: vi.fn().mockResolvedValue([]) },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    activitySpan: { findMany: vi.fn().mockResolvedValue([]) },
    rescuetimeLog: { findMany: vi.fn().mockResolvedValue(rescueRows) },
    bloodPressureLog: { findMany: vi.fn().mockResolvedValue([]) },
    // Serves both the timezone key and fast:history — "UTC" fails the
    // history's JSON.parse, correctly exercising the malformed-blob guard.
    userPreference: { findUnique: vi.fn().mockResolvedValue({ value: "UTC" }) },
    // Tagged-template queries: route by the table named in the SQL.
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      const sql = strings.join("?")
      if (sql.includes("MorningCheckIn")) return Promise.resolve(checkIns)
      // ArtistGenre first: its query also names LastfmLog in a subselect.
      if (sql.includes("ArtistGenre")) return Promise.resolve(genreRows)
      if (sql.includes("LastfmLog")) return Promise.resolve(lastfmRows)
      return Promise.resolve([])
    }),
  },
}))

import { computeCorrelations, assignTiers, type InsightResult } from "@/lib/correlations"

describe("computeCorrelations — food, hydration, supplements", () => {
  it("rediscovers every planted effect with the right direction", async () => {
    const { insights, totalDays } = await computeCorrelations("user_test", 60)
    expect(totalDays).toBe(DAYS)
    const byId = Object.fromEntries(insights.map(i => [i.id, i]))

    // Late meals → worse sleep that night
    const late = byId["food_late_meal_sleep"]
    expect(late).toBeDefined()
    expect(late.highGroupAvg).toBeLessThan(late.lowGroupAvg) // 65 vs 90
    expect(late.confident).toBe(true)

    // High-protein days → better next-day energy
    const protein = byId["food_protein_energy"]
    expect(protein).toBeDefined()
    expect(protein.highGroupAvg).toBeGreaterThan(protein.lowGroupAvg) // 5 vs 2

    // Calories and sugar comparisons exist (same planted split)
    expect(byId["food_calories_sleep"]).toBeDefined()
    expect(byId["food_sugar_energy"]).toBeDefined()

    // 2L+ water days → better next-day energy
    const water = byId["water_energy"]
    expect(water).toBeDefined()
    expect(water.highGroupAvg).toBeGreaterThan(water.lowGroupAvg)

    // Magnesium days → better sleep and HRV the following morning
    const mgSleep = byId["supplement_magnesium_sleep"]
    expect(mgSleep).toBeDefined()
    expect(mgSleep.highGroupAvg).toBeGreaterThan(mgSleep.lowGroupAvg) // 90 vs 65
    expect(mgSleep.category).toBe("supplements")
    const mgHrv = byId["supplement_magnesium_hrv"]
    expect(mgHrv).toBeDefined()
    expect(mgHrv.highGroupAvg).toBeGreaterThan(mgHrv.lowGroupAvg) // 62 vs 40

    // Caffeine → THAT night's sleep: the 300 mg days are the late-dinner days,
    // whose following night scores 65. Joined to the same-dated record (the
    // night before the coffee) this read the other way round.
    const caffeine = byId["caffeine_sleep"]
    expect(caffeine).toBeDefined()
    expect(caffeine.highGroupAvg).toBe(65)
    // (the light-coffee days include the alcohol nights at 70, so ~80 not 90)
    expect(caffeine.lowGroupAvg).toBeGreaterThan(75)
    expect(caffeine.delta).toBeLessThan(0)

    // Sleep → the SAME morning's energy. In this fixture the 65-score nights
    // are followed by energy-5 mornings (both hang off the late dinner), so
    // the honest same-morning join reads low-sleep/high-energy here. Under
    // the old next-day join it came out positive — a sign flip, not a nuance.
    const sleepEnergy = byId["sleep_score_energy"]
    expect(sleepEnergy).toBeDefined()
    expect(sleepEnergy.highGroupAvg).toBeLessThan(sleepEnergy.lowGroupAvg) // 2 vs 5

    // Workout days → better next-day readiness (planted 85 vs 65)
    const workout = byId["workout_readiness"]
    expect(workout).toBeDefined()
    expect(workout.category).toBe("fitness")
    expect(workout.highGroupAvg).toBeGreaterThan(workout.lowGroupAvg)

    // The week family exists whenever both sides have enough days — the
    // planted even/odd rhythm is independent of the calendar, so only
    // presence and category are stable claims here
    const weekendMood = byId["weekend_mood"]
    expect(weekendMood).toBeDefined()
    expect(weekendMood.category).toBe("week")
    expect(byId["weekend_sleep_score"]).toBeDefined()
    // ...and it can never flag itself as weekend-driven: its weekday-only
    // twin has an empty group by construction
    expect(weekendMood.weekendDriven).toBeUndefined()

    // Genre: ambient tops the good-mood days, black metal the low ones —
    // volume is flat everywhere, so only the genre split can see this
    const ambient = byId["music_genre_ambient_mood"]
    expect(ambient).toBeDefined()
    expect(ambient.category).toBe("music")
    expect(ambient.highGroupAvg).toBeGreaterThan(ambient.lowGroupAvg) // ~5 vs ~2
    expect(byId["music_genre_black_metal_mood"]).toBeDefined()

    // Mood arrives only via standalone MoodLog rows here — if the engine still
    // ignored that table, no mood-outcome insight could exist at all
    const sugarMood = byId["food_sugar_mood"]
    expect(sugarMood).toBeDefined()
    expect(sugarMood.highGroupAvg).toBeGreaterThan(sugarMood.lowGroupAvg) // 5 vs 2

    // A med with a known half-life is compared by how much is still
    // circulating, not by whether a tag exists that day — so the 20-day
    // on-period reads as on, the gap reads as off, and the planted deep-sleep
    // suppression (40 vs 80 min) comes out.
    const frontinDeep = byId["supplement_frontin_deep"]
    expect(frontinDeep).toBeDefined()
    expect(frontinDeep.highGroupAvg).toBe(40)
    expect(frontinDeep.lowGroupAvg).toBe(80)
    expect(frontinDeep.highGroupLabel).toContain("still on board")

    // Magnesium has no single honest half-life, so it keeps the binary
    // took-it-or-didn't comparison and its plain label
    expect(byId["supplement_magnesium_sleep"].highGroupLabel).toBe("Magnesium days")

    // Symptoms run the other way round: the symptom is the outcome and the
    // factors are suspects. Days without a headache count as 0, so "the day
    // after drinking" separates cleanly from every other day.
    const headache = byId["symptom_headache_alcohol"]
    expect(headache).toBeDefined()
    expect(headache.category).toBe("symptoms")
    expect(headache.highGroupAvg).toBe(4)
    expect(headache.lowGroupAvg).toBe(0)
    // more symptom is worse, so the delta must read as negative
    expect(headache.delta).toBeLessThan(0)

    // Interaction: the same supplement lands worse on nights that also had
    // alcohol (70) than on nights with the supplement alone (90)
    const interaction = byId["interaction_magnesium_alcohol_sleep"]
    expect(interaction).toBeDefined()
    expect(interaction.category).toBe("interactions")
    expect(interaction.highGroupAvg).toBe(70)
    expect(interaction.lowGroupAvg).toBe(90)

    // Productive hours track the mood plant — the RescueTime family reads
    // its table and finds the effect with the right sign
    const prodMood = byId["work_productive_mood"]
    expect(prodMood).toBeDefined()
    expect(prodMood.category).toBe("work")
    expect(prodMood.highGroupAvg).toBeGreaterThan(prodMood.lowGroupAvg) // 5 vs 2
    const distMood = byId["work_distracting_mood"]
    expect(distMood).toBeDefined()
    expect(distMood.highGroupAvg).toBeLessThan(distMood.lowGroupAvg) // 2 vs 5

    // Statistics: cleanly planted separations beat chance and survive
    // false-discovery control...
    for (const ins of [late, protein, water, mgSleep, workout]) {
      expect(ins.pValue).toBeLessThan(0.05)
      expect(ins.tier).toBe("strong")
    }
    // ...and an every-other-day pattern is not a weekend artifact
    expect(late.weekendDriven).toBeUndefined()
    expect(workout.weekendDriven).toBeUndefined()
  })

  it("assignTiers separates real p-values from chance-level ones", () => {
    const mk = (id: string, pValue: number): InsightResult => ({
      id, category: "sleep", emoji: "x", title: id, finding: "", delta: 10,
      highGroupLabel: "", lowGroupLabel: "", highGroupAvg: 1, lowGroupAvg: 0,
      highGroupN: 10, lowGroupN: 10, confident: true, pValue, tier: "noise",
    })
    const insights = [mk("real1", 0.001), mk("real2", 0.004), mk("meh", 0.09), mk("chance", 0.6)]
    assignTiers(insights)
    expect(insights.find(i => i.id === "real1")!.tier).toBe("strong")
    expect(insights.find(i => i.id === "real2")!.tier).toBe("strong")
    expect(insights.find(i => i.id === "meh")!.tier).toBe("suggestive")
    expect(insights.find(i => i.id === "chance")!.tier).toBe("noise")
  })

  it("buckets a late-evening dose into the user's day, not the server's", async () => {
    const { prisma } = await import("@/lib/prisma")
    ;(prisma.caffeineLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(caffeineLogsLate)
    ;(prisma.userPreference.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ value: "Europe/Prague" })
    try {
      const { insights } = await computeCorrelations("user_test", 60)
      const caffeine = insights.find(i => i.id === "caffeine_sleep")
      // 22:30 UTC is 00:30 in Prague: the 300 mg dose belongs to the NEXT
      // local day (an early-dinner one, whose night scores 90), so the split
      // flips relative to the 15:00 fixture above. GROUP BY the UTC date
      // used to put it on the day before and read 65 here.
      expect(caffeine).toBeDefined()
      expect(caffeine!.highGroupAvg).toBeGreaterThan(75) // the 90s and the 70 alcohol nights
      expect(caffeine!.lowGroupAvg).toBe(65)
    } finally {
      ;(prisma.userPreference.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ value: "UTC" })
    }
  })

  it("stays silent on food insights when there are too few food days", async () => {
    const { prisma } = await import("@/lib/prisma")
    ;(prisma.foodLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce(foodLogs.slice(0, 5))
    const { insights } = await computeCorrelations("user_test", 60)
    expect(insights.find(i => i.id === "food_late_meal_sleep")).toBeUndefined()
    expect(insights.find(i => i.id === "food_protein_energy")).toBeUndefined()
  })
})
