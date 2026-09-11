import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"

// A synthetic sixty days built to break the panel in the three ways it can be
// broken, each of which produced a real wrong answer before this existed:
//
//   1. Correcting a gatekept test against the whole run. Late caffeine came
//      back at p=0.008 on this account's own data and was filed as "could be
//      chance", because thirty-five tests in one family put the rank-one bar
//      at 0.0029. The panel's aspects are corrected among themselves.
//
//   2. Reading a silent day as a zero. Caffeine is logged on 26 days here,
//      something-but-no-caffeine on 6, and nothing at all on 58. Counted as
//      caffeine-free, those 58 turn the comparison into "days I used the app
//      against days I didn't". They are excluded and said out loud.
//
//   3. Three spellings of one café. "Kaviareň Vták", "Kaviaren Vtak" and
//      "Kaviareň vták" are eleven days that read as nine, one and one — two of
//      them too small to test, the third missing a fifth of its evidence.
//
// The planted history, day i of 0..59:
//   i % 4 === 0  caffeine at 18:00           → that night: score 60, latency 45
//   i % 4 === 1  caffeine at 08:00           → that night: score 85, latency 10
//   i % 4 === 2  water logged, no caffeine   → that night: score 85, latency 10
//   i % 4 === 3  nothing logged at all       → that night: score 10, latency 90
//
// The last row is the trap. Those nights are catastrophic, so any reading that
// lets them into a caffeine comparison moves every number in it.

const { healthLogs, caffeineLogs, waterLogs, placeCheckIns } = vi.hoisted(() => {
  const DAYS = 60
  const dates: string[] = []
  const now = new Date()
  for (let i = DAYS; i >= 0; i--) {
    dates.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10))
  }
  // dates[0..59] are the behaviour days; dates[60] carries the last night.
  const kind = (i: number) => i % 4

  // The night recorded on morning i describes the night after day i-1.
  const healthLogs = dates.map((ds, i) => {
    const k = i === 0 ? null : kind(i - 1)
    const bad = k === 0
    const missing = k === 3
    return {
      date: new Date(ds + "T00:00:00Z"),
      sleepScore: k == null ? null : missing ? 10 : bad ? 60 : 85,
      sleepDuration: k == null ? null : missing ? 180 : bad ? 360 : 480,
      readinessScore: null,
      restingHR: null,
      stressHigh: null,
      hrv: null,
      steps: null,
      activityScore: null,
      deepSleep: null,
      remSleep: null,
      sleepLatency: k == null ? null : missing ? 90 : bad ? 45 : 10,
      sleepEfficiency: k == null ? null : missing ? 70 : bad ? 82 : 94,
      sleepStart: null,
      restlessPeriods: null,
    }
  })

  const caffeineLogs = dates.slice(0, DAYS).flatMap((ds, i) => {
    if (kind(i) === 0) return [{ loggedAt: new Date(ds + "T18:00:00Z"), caffeineMg: 200 }]
    if (kind(i) === 1) return [{ loggedAt: new Date(ds + "T08:00:00Z"), caffeineMg: 200 }]
    return []
  })

  // Water only on the "logged, no caffeine" days — these are the genuine
  // controls, and the only thing separating them from the silent days.
  const waterLogs = dates.slice(0, DAYS)
    .filter((_, i) => kind(i) === 2)
    .map(ds => ({ loggedAt: new Date(ds + "T12:00:00Z"), amountMl: 500, type: "water" }))

  // Eight café days, spelled two ways, four each. Four is below the engine's
  // five-a-side floor, so neither spelling can produce an insight alone: the
  // café only exists if the names are folded together.
  const cafeDays = dates.slice(0, DAYS).map((ds, i) => ({ ds, i })).filter(({ i }) => kind(i) === 0).slice(0, 8)
  const placeCheckIns = [
    ...cafeDays.map(({ ds }, n) => ({
      checkedAt: new Date(ds + "T17:00:00Z"),
      place: n % 2 === 0 ? "Kaviareň Vták" : "Kaviaren Vtak",
      isAuto: true,
    })),
    // Somewhere else, on days that also checked in. Without these the café has
    // no counterpart: a day with no check-in at all is not a day you were
    // elsewhere, so it is not allowed to be the control.
    ...dates.slice(0, DAYS).filter((_, i) => kind(i) === 2).map(ds => ({
      checkedAt: new Date(ds + "T13:00:00Z"),
      place: "Home",
      isAuto: true,
    })),
  ]

  return { healthLogs, caffeineLogs, waterLogs, placeCheckIns }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn().mockResolvedValue(healthLogs) },
    habitCompletion: { findMany: vi.fn().mockResolvedValue([]) },
    weatherLog: { findMany: vi.fn().mockResolvedValue([]) },
    screenTimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    deviceCalendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
    intakeLog: { findMany: vi.fn((args: { where?: { type?: unknown } }) => Promise.resolve(args?.where?.type === "alcohol" ? [] : waterLogs)) },
    caffeineLog: { findMany: vi.fn().mockResolvedValue(caffeineLogs) },
    foodLog: { findMany: vi.fn().mockResolvedValue([]) },
    ouraTag: { findMany: vi.fn().mockResolvedValue([]) },
    moodLog: { findMany: vi.fn().mockResolvedValue([]) },
    stravaActivity: { findMany: vi.fn().mockResolvedValue([]) },
    symptomLog: { findMany: vi.fn().mockResolvedValue([]) },
    focusSession: { findMany: vi.fn().mockResolvedValue([]) },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    activitySpan: { findMany: vi.fn().mockResolvedValue([]) },
    rescuetimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    bloodPressureLog: { findMany: vi.fn().mockResolvedValue([]) },
    bodyMeasurement: { findMany: vi.fn().mockResolvedValue([]) },
    userPreference: { findUnique: vi.fn().mockResolvedValue({ value: "UTC" }) },
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      const sql = strings.join("?")
      // MorningCheckIn first — its table name contains "CheckIn".
      if (sql.includes("MorningCheckIn")) return Promise.resolve([])
      if (sql.includes('"CheckIn"')) return Promise.resolve(placeCheckIns)
      return Promise.resolve([])
    }),
  },
}))

import { computeCorrelations, assignTiers, foldPlace, type InsightResult } from "@/lib/correlations"

describe("the sleep panel", () => {
  it("asks one gate question per cause, then the aspects behind it", async () => {
    const { insights } = await computeCorrelations("user_panel", 90)
    const byId = Object.fromEntries(insights.map(i => [i.id, i]))

    const gate = byId["sleep_panel_late_caffeine"]
    expect(gate, "the gate is one test in the main battery").toBeDefined()
    expect(gate.pool, "the gate competes with everything else, so it has no pool").toBeUndefined()
    expect(gate.highGroupAvg).toBe(60)
    expect(gate.lowGroupAvg).toBe(85)

    const latency = byId["sleep_panel_late_caffeine_latency"]
    expect(latency, "a passed gate opens the aspects").toBeDefined()
    expect(latency.pool).toBe("sleep_panel_late_caffeine")
    expect(latency.highGroupAvg).toBe(45)
    expect(latency.lowGroupAvg).toBe(10)
    // Longer is worse for latency, so a rise has to read as a negative delta.
    expect(latency.delta).toBeLessThan(0)

    expect(byId["sleep_panel_late_caffeine_duration"]).toBeDefined()
    expect(byId["sleep_panel_late_caffeine_efficiency"]).toBeDefined()
  })

  it("holds the aspects to their own family, not the whole run", async () => {
    const { insights } = await computeCorrelations("user_panel", 90)
    const pooled = insights.filter(i => i.pool === "sleep_panel_late_caffeine")
    expect(pooled.length).toBeGreaterThanOrEqual(3)
    // The whole point: corrected among six rather than among ninety-odd, a
    // real effect of this size is allowed to be called real.
    expect(pooled.some(i => i.tier === "strong")).toBe(true)
  })

  it("compares timing against caffeine days, never against no-caffeine days", async () => {
    const { insights } = await computeCorrelations("user_panel", 90)
    const gate = insights.find(i => i.id === "sleep_panel_late_caffeine")!
    // Both sides had caffeine — 15 late, 15 early. Anything larger means the
    // control group has quietly become "days without coffee", which answers a
    // different question in the same words.
    expect(gate.highGroupN).toBe(15)
    expect(gate.lowGroupN).toBe(15)
  })
})

describe("a day with nothing logged is unknown, not a zero", () => {
  it("keeps silent days out of the caffeine comparison", async () => {
    const { insights } = await computeCorrelations("user_panel", 90)
    const caffeine = insights.find(i => i.id === "sleep_panel_caffeine")!
    expect(caffeine).toBeDefined()
    // 15 days logged water and no caffeine. The other 15 logged nothing at
    // all, and their nights score 10 — if they were counted as caffeine-free
    // controls the low group would be 30 days averaging 47.5.
    expect(caffeine.lowGroupN).toBe(15)
    expect(caffeine.lowGroupAvg).toBe(85)
    expect(caffeine.highGroupN).toBe(30)
  })

  it("says how many days it had to set aside", async () => {
    const { insights } = await computeCorrelations("user_panel", 90)
    const caffeine = insights.find(i => i.id === "sleep_panel_caffeine")!
    expect(caffeine.coverage).toMatch(/nothing at all was logged/)
  })

  it("produces no alcohol card at all rather than one built on silence", async () => {
    const { insights } = await computeCorrelations("user_panel", 90)
    // Not one drink logged in the window. Read as zeroes, the silent days
    // would have made every day a "no alcohol" day and the card would have
    // been a comparison of nothing against everything.
    expect(insights.find(i => i.id === "sleep_panel_alcohol")).toBeUndefined()
  })
})

describe("places", () => {
  it("is one café however it was spelled", () => {
    expect(foldPlace("Kaviareň Vták")).toBe("kaviaren vtak")
    expect(foldPlace("Kaviaren Vtak")).toBe("kaviaren vtak")
    expect(foldPlace("Kaviareň vták")).toBe("kaviaren vtak")
    expect(foldPlace("Bratislava, Bratislava")).toBe("bratislava bratislava")
  })

  it("tests the café as a moderator on caffeine, not as a cause of its own", async () => {
    const { insights } = await computeCorrelations("user_panel", 90)
    const gate = insights.find(i => i.id === "sleep_panel_caffeine_at_kaviaren_vtak")
    // Eight days, four under each spelling. Neither spelling reaches the
    // engine's five-a-side floor, so this card exists only because the names
    // were folded.
    expect(gate, "folding is what makes this testable at all").toBeDefined()
    expect(gate!.highGroupN).toBe(8)
    // Both sides had caffeine — "every time I was there I had coffee" is
    // exactly why a plain there-vs-elsewhere test would credit the room with
    // what the cup did.
    expect(gate!.lowGroupN).toBe(22)
  })

  it("puts places through the same gates as everything else", async () => {
    const { insights } = await computeCorrelations("user_panel", 90)
    const place = insights.find(i => i.id === "place_sleep_kaviaren_vtak")
    expect(place).toBeDefined()
    expect(place!.category).toBe("places")
    expect(place!.pValue).toBeLessThanOrEqual(1)
    expect(typeof place!.confident).toBe("boolean")
    // Eight café days against the fifteen that checked in somewhere else —
    // never against the thirty-eight that checked in nowhere, which say
    // nothing about where you were.
    expect(place!.highGroupN).toBe(8)
    expect(place!.lowGroupN).toBe(15)
  })
})

describe("assignTiers", () => {
  const mk = (id: string, pValue: number, pool?: string): InsightResult => ({
    id, category: "sleep", emoji: "🌙", title: id, finding: "",
    delta: 10, highGroupLabel: "a", lowGroupLabel: "b",
    highGroupAvg: 1, lowGroupAvg: 2, highGroupN: 20, lowGroupN: 20,
    confident: true, pValue, tier: "noise", pool,
  })

  it("corrects inside a pool, not across the run", () => {
    // p=0.012 against thirty other tests is rank-one at a bar of 0.0033 and
    // loses. Inside a family of three the bar is 0.033 and it wins. Same
    // number, two different questions — which is the whole design.
    const battery = Array.from({ length: 30 }, (_, i) => mk(`main_${i}`, 0.5))
    const pooled = [mk("p1", 0.012, "panel"), mk("p2", 0.4, "panel"), mk("p3", 0.6, "panel")]

    assignTiers([...battery, ...pooled])
    expect(pooled[0].tier).toBe("strong")

    const unpooled = [mk("p1", 0.012), mk("p2", 0.4), mk("p3", 0.6)]
    assignTiers([...battery, ...unpooled])
    expect(unpooled[0].tier).toBe("suggestive")
  })
})

describe("standing guards", () => {
  const engine = readFileSync("src/lib/correlations.ts", "utf8")
  const locRoute = readFileSync("src/app/api/location-correlations/route.ts", "utf8")

  it("gates the panel rather than letting every aspect into the main battery", () => {
    // Removing the gate is a one-line change that would double the main
    // family's size and quietly weaken every other card in the app.
    expect(engine).toContain("SLEEP_GATE_P")
    expect(engine).toMatch(/permutationsOn && gateIns\.pValue > SLEEP_GATE_P/)
  })

  it("reads places from check-ins, and only falls back to the old import", () => {
    expect(locRoute).toContain('FROM "CheckIn"')
    // The import is a fallback for an account that never checked in anywhere,
    // never a second opinion mixed into live data.
    expect(locRoute).toMatch(/checkIns\.length > 0/)
    expect(locRoute).toContain('source = "timeline-import"')
  })

  it("scores a night against the day before it, on the places page too", () => {
    // HRV, readiness, resting HR and both sleep figures are measured while you
    // sleep; the row dated the same day as an evening out describes the night
    // BEFORE it. This page was the last one still comparing an afternoon to
    // the sleep that preceded it.
    expect(locRoute).toContain("NIGHT_METRICS")
    expect(locRoute).toMatch(/NIGHT_METRICS\.has\(metric\) \? nextDay\(day\) : day/)
  })
})
