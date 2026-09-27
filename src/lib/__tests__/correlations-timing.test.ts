import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"

// Which night belongs to which day, and which days can answer at all.
//
// The ring's record dated D is the night that ENDED on morning D, and the
// check-in dated D is the morning of D. So anything that happens during day D
// — a drink, a late meal, a busy calendar, a sunny afternoon, a stressful
// day — can only show up in the record dated D+1. Several cards read the
// record dated D instead and scored the day against the night BEFORE it:
// a bad night followed by a boozy evening turned into "late meals cost more
// sleep when there was a drink".
//
// The second half is the other recurring bug: a day with nothing recorded for
// a condition was filed under "the condition was off" — a drinking day with no
// meal logged became a "late dinner", a day before symptom tracking began
// became a symptom-free day, a day before the first focus session a
// zero-minute focus day.
//
// Every scenario here plants its effect on the NEXT record and nothing on the
// same-day one, so a card joined to the wrong night finds a different number.

const state = vi.hoisted(() => {
  // The alcohol set is the `{ in: [...] }` without water in it; the hydration
  // query is also an `in`, and asks for beer and wine too.
  const isAlcoholQuery = (t: unknown) => {
    const list = (t as { in?: unknown } | undefined)?.in
    return Array.isArray(list) && list.includes("beer") && !list.includes("water")
  }

  const DAYS = 90
  const dates: string[] = []
  const now = new Date()
  for (let i = DAYS; i >= 1; i--) dates.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10))

  const coins = (seed: number, p = 0.5) => {
    let s = seed
    return dates.map(() => {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      return s / 0x7fffffff < p
    })
  }

  type Health = Record<string, unknown> & { date: Date }
  type Fixture = {
    healthLogs: Health[]
    foodLogs: { loggedAt: Date; calories: number; proteinG: number | null; sugarG: number | null }[]
    alcoholLogs: { loggedAt: Date; amountMl: number; type: string; note: null }[]
    waterLogs: { loggedAt: Date; amountMl: number; type: string }[]
    caffeineLogs: { loggedAt: Date; caffeineMg: number }[]
    weatherLogs: Record<string, unknown>[]
    events: { title: string; start: Date }[]
    checkIns: { date: string; energy: number | null; mood: number | null }[]
    ouraTags: { day: string; tagName: string; text: null }[]
    symptomRows: { day: string; name: string; severity: number }[]
    /** The first symptom ever logged, from before the window if there was one. */
    symptomFirst: string | null
    focusRows: { endedAt: Date; durationMin: number }[]
    fastHistory: { endedAt: string; durationH: number }[]
  }

  // Every day has a glass of water logged, so every day is a diary day and
  // only the planted condition decides which side a day falls on.
  const blank = (): Fixture => ({
    healthLogs: dates.map(ds => ({ date: new Date(ds + "T00:00:00Z") })),
    foodLogs: [],
    alcoholLogs: [],
    waterLogs: dates.map(ds => ({ loggedAt: new Date(ds + "T11:00:00Z"), amountMl: 1500, type: "water" })),
    caffeineLogs: [],
    weatherLogs: [],
    events: [],
    checkIns: [],
    ouraTags: [],
    symptomRows: [],
    symptomFirst: null,
    focusRows: [],
    fastHistory: [],
  })

  /** The record that describes the night after day i. */
  const nightAfter = (f: Fixture, i: number) => f.healthLogs[i + 1]

  const lateMealAlcohol = () => {
    const f = blank()
    const late = coins(11)
    const drank = coins(29)
    dates.forEach((ds, i) => {
      f.foodLogs.push({ loggedAt: new Date(ds + (late[i] ? "T21:30:00Z" : "T12:00:00Z")), calories: 1800, proteinG: null, sugarG: null })
      if (drank[i]) f.alcoholLogs.push({ loggedAt: new Date(ds + "T19:00:00Z"), amountMl: 500, type: "beer", note: null })
      const night = nightAfter(f, i)
      if (night) night.sleepScore = late[i] && drank[i] ? 60 : late[i] ? 80 : 85
    })
    return f
  }

  // Meals are logged on about half the days. A drinking day with no meal
  // logged has no dinner time at all — it is neither early nor late.
  const earlyDinnerGaps = () => {
    const f = blank()
    const drank = coins(5)
    const ate = coins(17)
    const early = coins(23)
    let drinkingDaysWithMeal = 0
    dates.forEach((ds, i) => {
      if (drank[i]) f.alcoholLogs.push({ loggedAt: new Date(ds + "T19:00:00Z"), amountMl: 500, type: "beer", note: null })
      if (ate[i]) f.foodLogs.push({ loggedAt: new Date(ds + (early[i] ? "T18:00:00Z" : "T21:30:00Z")), calories: 1800, proteinG: null, sugarG: null })
      const night = nightAfter(f, i)
      if (!night) return
      if (drank[i] && ate[i]) drinkingDaysWithMeal++
      night.sleepScore = !drank[i] ? 85 : !ate[i] ? 70 : early[i] ? 80 : 60
    })
    return { f, drinkingDaysWithMeal }
  }

  const caffeineLatency = () => {
    const f = blank()
    const heavy = coins(41)
    dates.forEach((ds, i) => {
      f.caffeineLogs.push({ loggedAt: new Date(ds + "T09:00:00Z"), caffeineMg: heavy[i] ? 300 : 50 })
      const night = nightAfter(f, i)
      if (night) night.sleepLatency = heavy[i] ? 30 : 10
    })
    return f
  }

  const stressAndSun = () => {
    const f = blank()
    const stressed = coins(53)
    const sunny = coins(67)
    dates.forEach((ds, i) => {
      f.healthLogs[i].stressHigh = stressed[i] ? 120 : 10
      f.weatherLogs.push({ date: ds, precipMm: null, tempMaxC: null, weatherCode: null, uvIndex: sunny[i] ? 7 : 2, pressureMslHpa: null })
      const night = nightAfter(f, i)
      if (night) { night.hrv = stressed[i] ? 35 : 50; night.readinessScore = sunny[i] ? 85 : 65 }
    })
    return f
  }

  // Busy days are followed by BETTER mornings here — the direction no
  // template expected.
  const busyButFine = () => {
    const f = blank()
    dates.forEach((ds, i) => {
      const busy = i % 2 === 0
      for (let k = 0; k < (busy ? 6 : 2); k++) f.events.push({ title: `Meeting ${k}`, start: new Date(ds + `T${String(9 + k).padStart(2, "0")}:00:00Z`) })
      f.checkIns.push({ date: ds, energy: i === 0 ? 3 : (i - 1) % 2 === 0 ? 4 : 3, mood: i === 0 ? 3 : (i - 1) % 2 === 0 ? 4 : 3 })
    })
    return f
  }

  // Symptom tracking begins on day 60, the same week a supplement does.
  // Nausea turns up on half the days after that.
  const symptomOnset = (firstEver: string | null) => {
    const f = blank()
    dates.forEach((ds, i) => {
      if (i < 60) return
      f.ouraTags.push({ day: ds, tagName: "Magnesium", text: null })
      if (i % 2 === 0) f.symptomRows.push({ day: ds, name: "Nausea", severity: 3 })
    })
    f.symptomFirst = firstEver ?? dates[60]
    return f
  }

  // Focus sessions and fasts only in the last thirty days: the app feature
  // was found on day 60. Mood is better on focus days; nights after a fast
  // score better.
  const lateFeatures = () => {
    const f = blank()
    dates.forEach((ds, i) => {
      const focused = i >= 60 && i % 2 === 0
      if (focused) f.focusRows.push({ endedAt: new Date(ds + "T10:00:00Z"), durationMin: 50 })
      f.checkIns.push({ date: ds, energy: 3, mood: focused ? 4 : 3 })
      const fasted = i >= 60 && i % 3 === 0
      if (fasted) f.fastHistory.push({ endedAt: ds + "T12:00:00.000Z", durationH: 16 })
      const night = nightAfter(f, i)
      if (night) night.sleepScore = fasted ? 85 : 75
    })
    return f
  }

  return {
    DAYS, dates, isAlcoholQuery,
    current: blank(),
    lateMealAlcohol, earlyDinnerGaps, caffeineLatency, stressAndSun, busyButFine, symptomOnset, lateFeatures,
  }
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    healthLog: { findMany: vi.fn(() => Promise.resolve(state.current.healthLogs)) },
    foodLog: { findMany: vi.fn(() => Promise.resolve(state.current.foodLogs)) },
    intakeLog: {
      findMany: vi.fn((args: { where?: { type?: unknown } }) =>
        Promise.resolve(state.isAlcoholQuery(args?.where?.type) ? state.current.alcoholLogs : state.current.waterLogs)),
    },
    caffeineLog: { findMany: vi.fn(() => Promise.resolve(state.current.caffeineLogs)) },
    weatherLog: { findMany: vi.fn(() => Promise.resolve(state.current.weatherLogs)) },
    deviceCalendarEvent: { findMany: vi.fn(() => Promise.resolve(state.current.events)) },
    ouraTag: { findMany: vi.fn(() => Promise.resolve(state.current.ouraTags)) },
    symptomLog: {
      findMany: vi.fn(() => Promise.resolve(state.current.symptomRows)),
      findFirst: vi.fn(() => Promise.resolve(state.current.symptomFirst ? { day: state.current.symptomFirst } : null)),
    },
    focusSession: {
      findMany: vi.fn(() => Promise.resolve(state.current.focusRows)),
      findFirst: vi.fn(() => Promise.resolve(state.current.focusRows[0] ?? null)),
    },
    bodyMeasurement: { findMany: vi.fn().mockResolvedValue([]) },
    bodyMeasurementLog: { findMany: vi.fn().mockResolvedValue([]) },
    stravaActivity: { findMany: vi.fn().mockResolvedValue([]) },
    habitCompletion: { findMany: vi.fn().mockResolvedValue([]) },
    screenTimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    moodLog: { findMany: vi.fn().mockResolvedValue([]) },
    transaction: { findMany: vi.fn().mockResolvedValue([]) },
    activitySpan: { findMany: vi.fn().mockResolvedValue([]) },
    rescuetimeLog: { findMany: vi.fn().mockResolvedValue([]) },
    bloodPressureLog: { findMany: vi.fn().mockResolvedValue([]) },
    userPreference: {
      findUnique: vi.fn((args: { where?: { userId_key?: { key?: string } } }) =>
        Promise.resolve(args?.where?.userId_key?.key === "fast:history"
          ? { value: JSON.stringify(state.current.fastHistory) }
          : { value: "UTC" })),
    },
    $queryRaw: vi.fn((strings: TemplateStringsArray) =>
      Promise.resolve(strings.join("?").includes("MorningCheckIn") ? state.current.checkIns : [])),
  },
}))

import { computeCorrelations, type InsightResult } from "@/lib/correlations"
import { lintSentence, describeProblems } from "./insight-lint"

const run = async (userId: string) => {
  const { insights } = await computeCorrelations(userId, 90)
  return { insights, byId: new Map(insights.map(i => [i.id, i])) }
}

const NO_EFFECT = /\b(?:doesn't|don't) (?:change|show up|move)\b/

function expectReads(insights: InsightResult[]) {
  for (const ins of insights) {
    for (const [field, text] of [["finding", ins.finding], ["title", ins.title]] as const) {
      const problems = lintSentence(text)
      expect(problems, describeProblems(`${ins.id} ${field}`, text, problems)).toEqual([])
    }
  }
}

describe("interaction cards read the night after the day", () => {
  it("scores a late meal with a drink against the night that followed it", async () => {
    state.current = state.lateMealAlcohol()
    const { insights, byId } = await run("user_late_meal")
    const card = byId.get("interaction_late_meal_sleep_by_alcohol")
    expect(card, "the planted late-meal-plus-drink night never surfaced").toBeDefined()
    // 60 after a late meal with a drink, 80 after a dry late meal, 85 otherwise.
    // Joined to the record dated the same day this read the night BEFORE the
    // meal, where nothing was planted.
    expect(card!.highGroupAvg).toBe(60)
    expect(card!.lowGroupAvg).toBe(80)
    expect(card!.finding).toMatch(/drops/)
    expectReads(insights)
  })

  it("leaves a drinking day with no meal logged out of the early-dinner question", async () => {
    const { f, drinkingDaysWithMeal } = state.earlyDinnerGaps()
    state.current = f
    const { byId } = await run("user_early_dinner")
    const card = byId.get("interaction_alcohol_sleep_by_early_dinner")
    expect(card).toBeDefined()
    // The two drinking-day cells hold only days with a dinner time. The
    // drinking days with no meal logged used to fill "when it was later".
    expect(card!.highGroupN + card!.lowGroupN).toBe(drinkingDaysWithMeal)
    expect(card!.highGroupAvg).toBe(60) // late dinner and a drink
    expect(card!.lowGroupAvg).toBe(80)  // early dinner and a drink
  })
})

describe("caffeine and the time it takes to fall asleep", () => {
  it("is asked as a plain comparison against the night after", async () => {
    state.current = state.caffeineLatency()
    const { insights, byId } = await run("user_latency")
    // The interaction that used to ask it had "any caffeine" as the predictor
    // and "heavy caffeine" as the moderator — the moderator's on-cell had no
    // days without caffeine in it, so it could never fill and never answered.
    const card = byId.get("caffeine_sleep_latency")
    expect(card, "the planted caffeine → latency effect never surfaced").toBeDefined()
    expect(card!.highGroupAvg).toBe(30)
    expect(card!.lowGroupAvg).toBe(10)
    expect(card!.delta).toBeLessThan(0) // longer to fall asleep is worse
    expect(insights.some(i => i.id.startsWith("interaction_caffeine_"))).toBe(false)
    expectReads(insights)
  })
})

describe("stress and sun are scored against the next morning", () => {
  it("reads HRV and readiness from the night after the day", async () => {
    state.current = state.stressAndSun()
    const { insights, byId } = await run("user_stress_uv")
    // Oura's daytime stress for day D is measured after the HRV of the night
    // ending on morning D. Joined to that HRV, the card presented a bad night
    // raising the next day's stress as stress lowering HRV.
    const stress = byId.get("stress_hrv")
    expect(stress).toBeDefined()
    expect(stress!.highGroupAvg).toBe(35)
    expect(stress!.lowGroupAvg).toBe(50)
    const uv = byId.get("uv_readiness")
    expect(uv).toBeDefined()
    expect(uv!.highGroupAvg).toBe(85)
    expect(uv!.lowGroupAvg).toBe(65)
    expectReads(insights)
  })
})

describe("a card never says 'no change' over a real difference", () => {
  it("describes an effect in the unexpected direction as the effect it is", async () => {
    state.current = state.busyButFine()
    const { insights, byId } = await run("user_busy")
    // Busy days are followed by energy 4 against 3. The template only had a
    // sentence for "busy days cost energy", and for anything else printed
    // "Busy days don't change your next-day energy — 4 vs 3" under a green
    // +33% badge.
    for (const id of ["calendar_load_energy", "calendar_load_mood"]) {
      const card = byId.get(id)
      expect(card, id).toBeDefined()
      expect(card!.highGroupAvg).toBeGreaterThan(card!.lowGroupAvg)
      expect(card!.finding, id).not.toMatch(NO_EFFECT)
    }
    for (const ins of insights) {
      if (ins.highGroupAvg !== ins.lowGroupAvg) expect(ins.finding, ins.id).not.toMatch(NO_EFFECT)
    }
    expectReads(insights)
  })
})

describe("the no-change sentence has one home", () => {
  // The runtime check above covers the cards this fixture can build. This
  // covers the rest: a template may say "doesn't change / show up / move"
  // only as the `same` branch of byDirection, the one reached when the two
  // printed averages are equal.
  it("never prints over two different numbers", () => {
    const src = readFileSync("src/lib/correlations.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
    const sentences = [...src.matchAll(/`[^`]*\b(?:doesn't|don't) (?:change|show up|move)\b[^`]*`/g)]
    expect(sentences.length).toBeGreaterThan(10)
    const loose = sentences
      .filter(m => !/same:\s*$/.test(src.slice(Math.max(0, m.index! - 12), m.index)))
      .map(m => m[0])
    expect(loose, "these print 'no change' whatever the two numbers are").toEqual([])
  })
})

describe("a day before a feature was used is not a zero for it", () => {
  it("does not read the days before symptom tracking began as symptom-free", async () => {
    state.current = state.symptomOnset(null)
    const { byId } = await run("user_symptoms_new")
    // Tracking and the supplement start the same week. Every day before that
    // used to count as nausea 0, so "on Magnesium days nausea averages 1.5
    // vs 0 without it" — a comparison of before-logging against after.
    expect(byId.get("symptom_nausea_med_magnesium")).toBeUndefined()
  })

  it("keeps the zeros when symptoms were being logged long before", async () => {
    state.current = state.symptomOnset("2020-01-01")
    const { byId } = await run("user_symptoms_old")
    const card = byId.get("symptom_nausea_med_magnesium")
    expect(card).toBeDefined()
    expect(card!.lowGroupAvg).toBe(0)
  })

  it("counts focus minutes and fasts only from the day they began", async () => {
    state.current = state.lateFeatures()
    const { byId } = await run("user_late_features")
    const focus = byId.get("focus_mood")
    expect(focus).toBeDefined()
    // Thirty covered days. Before the fix, sixty earlier days read as
    // "days without deep work".
    expect(focus!.highGroupN + focus!.lowGroupN).toBeLessThanOrEqual(30)
    const fast = byId.get("fasting_sleep")
    expect(fast).toBeDefined()
    expect(fast!.highGroupN + fast!.lowGroupN).toBeLessThanOrEqual(30)
  })
})
