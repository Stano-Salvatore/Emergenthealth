import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "node:fs"

// The clinical report is the one document this app produces for someone other
// than its user, and every number in it is read across a desk by a doctor who
// cannot ask the app what it meant. These tests build the whole report over a
// fake database and check the numbers a clinician would act on.

type Where = { date?: { gte?: Date; lte?: Date }; weight?: unknown; weightKg?: unknown }

const db = vi.hoisted(() => ({
  health: [] as Record<string, unknown>[],
  body: [] as Record<string, unknown>[],
  doses: [] as Record<string, unknown>[],
  schedules: [] as Record<string, unknown>[],
  labs: [] as Record<string, unknown>[],
  insights: null as string | null,
}))

/** Range and not-null filters, the only parts of a where clause these queries use. */
function filterRows(rows: Record<string, unknown>[], where: Where | undefined) {
  return rows.filter(r => {
    const d = r.date as Date
    if (where?.date?.gte && d < where.date.gte) return false
    if (where?.date?.lte && d > where.date.lte) return false
    if (where?.weight && r.weight == null) return false
    if (where?.weightKg && r.weightKg == null) return false
    return true
  })
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async () => ({ name: "Sam Reyes", email: null }) },
    healthLog: {
      findMany: async (args: { where?: Where }) =>
        filterRows(db.health, args.where).sort((a, b) => (a.date as Date).getTime() - (b.date as Date).getTime()),
    },
    bodyMeasurement: {
      findMany: async (args: { where?: Where }) =>
        filterRows(db.body, args.where).sort((a, b) => (b.date as Date).getTime() - (a.date as Date).getTime()),
    },
    medSchedule: { findMany: async () => db.schedules },
    symptomLog: { findMany: async () => [] },
    labResult: {
      findMany: async () => [...db.labs].sort((a, b) => (b.date as Date).getTime() - (a.date as Date).getTime()),
    },
    userPreference: { findUnique: async () => (db.insights ? { value: db.insights } : null) },
    $queryRaw: async (strings: TemplateStringsArray) =>
      strings.join("").includes("OuraTag") ? db.doses : [],
  },
}))
vi.mock("@/lib/user-timezone", () => ({ getUserTimezone: async () => "Europe/Bratislava" }))
vi.mock("@/lib/model-spend", () => ({ recordModelTurn: () => {} }))

import { buildHealthReport } from "@/lib/health-report"
import { renderReportEmail } from "@/lib/health-report-email"

// 09:00 in Bratislava on 27 Sept: today has barely started.
const NOW = new Date("2026-09-27T07:00:00Z")
const TODAY = "2026-09-27"

const day = (iso: string) => new Date(iso + "T00:00:00Z")
function daysBack(n: number): string {
  const d = new Date(TODAY + "T00:00:00Z")
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

let savedKey: string | undefined

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
  savedKey = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  db.health = []
  db.body = []
  db.doses = []
  db.schedules = []
  db.labs = []
  db.insights = null
})

afterEach(() => {
  vi.useRealTimers()
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey
})

const schedule = (id: string, name: string, times = ["08:00"]) => ({
  id, name, times, daysOfWeek: [], active: true, startDate: null, endDate: null, dose: null, note: null,
})
const dose = (dayStr: string, tagName: string | null, text: string | null = null, at?: string) => ({
  tagName, text, day: dayStr, timestamp: new Date(at ?? dayStr + "T06:00:00Z"), doseAmount: null, doseUnit: null,
})

describe("weight", () => {
  it("reads weigh-ins from chat and the quick box, not only the Body page", async () => {
    // One Body-page entry in March, then a weigh-in logged through chat most
    // weeks. The report used to show only the March figure as "latest" and
    // no weight trend at all.
    db.body = [{ date: day("2026-03-12"), weightKg: 81.0, bodyFatPct: null }]
    for (const [n, kg] of [[20, 81.0], [13, 80.1], [6, 79.2], [1, 78.4]] as const) {
      db.health.push({ date: day(daysBack(n)), weight: kg })
    }
    const r = await buildHealthReport("u1", 30)
    expect(r.body.weightKg).toBe(78.4)
    expect(r.body.date).toBe(daysBack(1))
    expect(r.weightTrend).toMatchObject({ first: 81, last: 78.4, changeKg: -2.6, readings: 4 })
    expect(r.weightTrend?.firstDate).toBe(daysBack(20))
    expect(r.weightTrend?.lastDate).toBe(daysBack(1))
  })

  it("still shows a Body-page weight older than a year, with its date", async () => {
    db.body = [
      { date: day("2025-02-01"), weightKg: 82.5, bodyFatPct: 21 },
      { date: day("2024-11-01"), weightKg: 84.0, bodyFatPct: null },
    ]
    const r = await buildHealthReport("u1", 30)
    expect(r.body).toMatchObject({ weightKg: 82.5, prevWeightKg: 84, date: "2025-02-01", bodyFatPct: 21 })
    expect(r.weightTrend).toBeNull()
  })
})

describe("medications", () => {
  it("dates the last dose as the user's day, which the email can print", async () => {
    // 00:30 in Bratislava on the 21st is 22:30 UTC on the 20th. The email
    // used to print "last Invalid Date" for every medication with a dose.
    db.schedules = [schedule("s1", "Atarax", ["22:00"])]
    db.doses = [dose("2026-09-21", "Atarax", null, "2026-09-20T22:30:00Z")]
    const r = await buildHealthReport("u1", 30)
    expect(r.meds[0].lastTaken).toBe("2026-09-21")
    const html = renderReportEmail(r)
    expect(html).not.toContain("Invalid Date")
    expect(html).toMatch(/last 21 Sept? 2026/)
  })

  it("matches doses the way the Medications page does, capped per scheduled time", async () => {
    db.schedules = [
      schedule("vd", "Vitamin D"),
      schedule("d3", "D3"),
      schedule("mg", "Magnesium"),
      schedule("fe", "Iron"),
    ]
    for (let n = 1; n <= 5; n++) {
      const d = daysBack(n)
      db.doses.push(
        dose(d, "Vitamin C"),        // not vitamin D, though it shares a first word
        dose(d, "Multivitamin"),
        dose(d, "Vitamin D 2000IU"), // is vitamin D, and is D3
        dose(d, "Horčík"),           // Slovak magnesium
        dose(d, null, "stressful work environment"), // a note, not iron
      )
    }
    // Two vitamin D on one day against a once-a-day schedule counts once.
    db.doses.push(dose(daysBack(2), "D3"))
    const r = await buildHealthReport("u1", 30)
    const by = (n: string) => r.meds.find(m => m.name === n)!
    expect(by("Vitamin D").loggedDoses).toBe(5)
    expect(by("D3").loggedDoses).toBe(5)
    expect(by("Magnesium").loggedDoses).toBe(5)
    expect(by("Iron").loggedDoses).toBe(0)
    for (const m of r.meds) expect(m.loggedDoses).toBeLessThanOrEqual(m.expectedDoses)
  })

  it("still counts the recorded doses of an as-needed medication", async () => {
    // No times means adherenceOver expects nothing and counts nothing; the
    // doctor still needs to see how often it was reached for.
    db.schedules = [schedule("prn", "Atarax", [])]
    for (const n of [1, 3, 4, 9]) db.doses.push(dose(daysBack(n), "Atarax ½"))
    db.doses.push(dose(daysBack(3), "Atarax"))
    const r = await buildHealthReport("u1", 30)
    expect(r.meds[0].expectedDoses).toBe(0)
    expect(r.meds[0].loggedDoses).toBe(5)
  })

  it("does not count today, whose evening dose has not happened yet", async () => {
    db.schedules = [schedule("s1", "Atarax", ["22:00"])]
    const r = await buildHealthReport("u1", 30)
    expect(r.meds[0].expectedDoses).toBe(29)
  })
})

describe("medicines outside a schedule", () => {
  // Frontin ½ taken as needed 18 times in 90 days, and a daily medicine
  // paused last week: neither had an active schedule, so neither reached the
  // report, and the doctor read an incomplete medication list.

  it("lists doses of medicines that have no schedule, with how often and when last", async () => {
    db.schedules = [schedule("s1", "Elicea", ["08:00"])]
    for (const n of [2, 5, 9]) db.doses.push(dose(daysBack(n), "Frontin ½"))
    for (const n of [1, 4]) db.doses.push(dose(daysBack(n), "Stillnox"))
    for (const n of [1, 2, 3]) db.doses.push(dose(daysBack(n), "Elicea"))
    const r = await buildHealthReport("u1", 30)
    const other = Object.fromEntries(r.otherDoses.map(o => [o.name, o]))
    expect(other["Frontin ½"]?.count ?? other["Frontin"]?.count).toBe(3)
    expect(Object.values(other).find(o => /stil+nox/i.test(o.name))?.count).toBe(2)
    expect(r.otherDoses.some(o => /elicea/i.test(o.name))).toBe(false)
    expect(Object.values(other).find(o => /stil+nox/i.test(o.name))?.lastTaken).toBe(daysBack(1))
  })

  it("leaves drinks and non-medicine tags out of it", async () => {
    db.doses.push(dose(daysBack(1), "Coldbrew 300ml"), dose(daysBack(2), "Water 250ml"), dose(daysBack(2), "Sauna"))
    const r = await buildHealthReport("u1", 30)
    expect(r.otherDoses).toEqual([])
  })

  it("shows a stopped schedule that still had doses in the period, marked as stopped", async () => {
    db.schedules = [
      { ...schedule("s2", "Atarax", ["22:00"]), active: false },
      { ...schedule("s3", "Mirzaten", ["22:00"]), active: false },
    ]
    for (const n of [8, 9, 10, 11]) db.doses.push(dose(daysBack(n), "Atarax"))
    const r = await buildHealthReport("u1", 30)
    expect(r.meds.map(m => [m.name, m.stopped, m.loggedDoses])).toEqual([["Atarax", true, 4]])
  })

  it("puts both into what the narrative is written from", () => {
    const src = readFileSync("src/lib/health-report.ts", "utf8")
    expect(src).toMatch(/OTHER DOSES LOGGED/)
    expect(src).toMatch(/stopped or paused/)
  })
})

describe("vitals", () => {
  it("leaves today's running step count and ring-off days out of the steps line", async () => {
    for (let n = 1; n <= 20; n++) db.health.push({ date: day(daysBack(n)), steps: 8000 + n * 10, restingHR: 55 })
    db.health.push({ date: day(daysBack(21)), steps: 55, restingHR: null })
    db.health.push({ date: day(daysBack(22)), steps: 487, restingHR: null })
    db.health.push({ date: day(TODAY), steps: 640, restingHR: 54 })
    const r = await buildHealthReport("u1", 30)
    const steps = r.metrics.find(m => m.key === "steps")!
    expect(steps.min).toBeGreaterThanOrEqual(1000)
    expect(steps.days).toBe(20)
    expect(steps.excludedDays).toBe(2)
    // Resting heart rate is a morning reading: today's is complete.
    expect(r.metrics.find(m => m.key === "rhr")!.days).toBe(21)
  })

  it("will not set a previous-period mean from a handful of nights beside a full one", async () => {
    for (let n = 1; n <= 29; n++) db.health.push({ date: day(daysBack(n)), restingHR: 56 })
    for (let n = 30; n < 35; n++) db.health.push({ date: day(daysBack(n)), restingHR: 51 })
    const r = await buildHealthReport("u1", 30)
    const rhr = r.metrics.find(m => m.key === "rhr")!
    expect(rhr.prevDays).toBe(5)
    expect(rhr.prevAvg).toBeNull()
  })

  it("counts a wearable day only when the ring measured something", async () => {
    // Three weeks of the ring in a drawer, Health Connect writing phone steps daily.
    for (let n = 0; n < 30; n++) {
      db.health.push(n < 21
        ? { date: day(daysBack(n)), steps: 4000 }
        : { date: day(daysBack(n)), steps: 9000, sleepScore: 80, restingHR: 55 })
    }
    const r = await buildHealthReport("u1", 30)
    expect(r.coverage.daysWithWearable).toBe(9)
    expect(r.coverage.longestGapDays).toBe(21)
  })
})

describe("labs", () => {
  it("compares a previous result in the new unit, and calls a move inside lab noise flat", async () => {
    db.labs = [
      { marker: "Cholesterol", value: 200, unit: "mg/dL", referenceMin: null, referenceMax: null, date: day("2026-03-10") },
      { marker: "Cholesterol", value: 5.2, unit: "mmol/L", referenceMin: 3, referenceMax: 5.2, date: day("2026-09-10") },
      { marker: "Ferritin", value: 41, unit: "ug/L", referenceMin: 30, referenceMax: 400, date: day("2026-03-10") },
      { marker: "Ferritin", value: 42, unit: "ug/L", referenceMin: 30, referenceMax: 400, date: day("2026-09-10") },
      { marker: "Mystery", value: 3, unit: "blips", referenceMin: null, referenceMax: null, date: day("2026-03-10") },
      { marker: "Mystery", value: 4, unit: "zorps", referenceMin: null, referenceMax: null, date: day("2026-09-10") },
    ]
    const r = await buildHealthReport("u1", 30)
    const chol = r.labs.find(l => l.marker === "Cholesterol")!
    expect(chol.previous?.valueInLatestUnit).toBeCloseTo(5.17, 2)
    expect(chol.previous?.direction).toBe("flat")
    expect(chol.previous?.unitMismatch).toBe(false)
    expect(r.labs.find(l => l.marker === "Ferritin")!.previous?.direction).toBe("flat")
    const odd = r.labs.find(l => l.marker === "Mystery")!
    expect(odd.previous?.unitMismatch).toBe(true)
    expect(odd.previous?.direction).toBeNull()
    const html = renderReportEmail(r)
    expect(html).not.toContain("↓ 200")
  })
})

describe("observed associations", () => {
  it("keep their confound, coverage and day counts, and a confounded one is never solid", async () => {
    db.insights = JSON.stringify({
      at: Date.parse("2026-09-20T10:00:00Z"),
      payload: {
        insights: [{
          id: "mag_sleep", finding: "With magnesium, sleep score averages 82; without, 76",
          tier: "strong", highGroupN: 21, lowGroupN: 40,
          confounded: "Bedtime does not hold still here: 40 minutes later on those nights",
          coverage: "caffeine unknown on 6 days",
        }],
      },
    })
    const r = await buildHealthReport("u1", 30)
    expect(r.patterns[0]).toMatchObject({
      confidence: "tentative",
      confounded: expect.stringContaining("Bedtime"),
      coverage: "caffeine unknown on 6 days",
      days: { with: 21, without: 40 },
    })
    expect(r.patternsAsOf).toBe("2026-09-20")
    const html = renderReportEmail(r)
    expect(html).toContain("Bedtime does not hold still")
  })
})

describe("the printable page reads the same fields the email does", () => {
  const page = readFileSync("src/app/dashboard/report/page.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")

  it("does not parse a local day as a UTC instant", () => {
    // new Date("2026-09-21") is UTC midnight, which is the 20th anywhere west
    // of Greenwich; the page has fmtDay for exactly this.
    expect(page).not.toMatch(/new Date\(m\.lastTaken\)/)
  })

  it("takes a lab's direction from the builder, not a raw comparison across units", () => {
    expect(page).not.toMatch(/l\.value [<>] l\.previous\.value/)
    expect(page).toMatch(/previous\.direction/)
  })

  it("shows how many days the previous-period mean rests on", () => {
    expect(page).toMatch(/m\.prevDays/)
  })

  it("keeps a pattern's confound under it", () => {
    expect(page).toMatch(/p\.confounded/)
  })
})
