import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest"

// Two ways the Health Connect read went wrong on a real phone.
//
// The plugin's readRecords runs inside the activity's coroutine scope with no
// catch and no reject: when Health Connect refuses a type, the
// SecurityException is thrown there, never reaches the JS promise, and takes
// the app down (or leaves the promise hanging for ever). So the try/catch
// around each read never saw a refusal. Someone who allowed seven of the eight
// types lost the app on every sync instead of seeing "not granted: SpO2". The
// only safe read is one that never asks for a type the phone has not granted.
//
// Steps and calories were added up across every app that writes them.
// Samsung Health and the Oura app both write steps into Health Connect, so a
// 9,000-step day arrived as 17,000 — Health Connect removes duplicates only in
// its aggregate API, never in readRecords. Each app's own total is a real
// count; the sum of two of them is a number nobody walked.

const hc = vi.hoisted(() => ({
  granted: new Set<string>(),
  records: {} as Record<string, unknown[]>,
  reads: [] as string[],
}))

vi.mock("@/lib/native/shell", () => ({ isNativeShell: () => true }))
vi.mock("@kiwi-health/capacitor-health-connect", () => ({
  HealthConnect: {
    checkHealthPermissions: async ({ read }: { read: string[] }) => ({
      hasAllPermissions: read.every(t => hc.granted.has(t)),
    }),
    readRecords: ({ type }: { type: string }) => {
      hc.reads.push(type)
      // What the native side does with a refused type: nothing comes back.
      if (!hc.granted.has(type)) return new Promise(() => {})
      return Promise.resolve({ records: hc.records[type] ?? [] })
    },
  },
}))

import { readLast30Days, READ_TYPES } from "@/lib/health-connect-service"

const ORIGINAL_TZ = process.env.TZ
beforeAll(() => {
  process.env.TZ = "Europe/Bratislava"
  // The service refuses to touch the plugin without a window, as in SSR.
  vi.stubGlobal("window", {})
})
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ
  vi.unstubAllGlobals()
})

const within = <T>(p: Promise<T>, ms = 1000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(
      "readLast30Days never finished: it asked the plugin for a type the phone refused, and the plugin " +
      "has no way to answer that.",
    )), ms)),
  ])

const DAY = new Date()
DAY.setHours(12, 0, 0, 0)
const iso = (h: number) => { const d = new Date(DAY); d.setHours(h); return d.toISOString() }
const from = (origin: string) => ({ metadata: { dataOrigin: origin } })

describe("readLast30Days never asks for a type the phone refused", () => {
  beforeEach(() => {
    hc.granted = new Set(READ_TYPES.filter(t => t !== "OxygenSaturation"))
    hc.records = {}
    hc.reads = []
  })

  it("finishes, skips the refused type, and names it", async () => {
    const out = await within(readLast30Days())
    expect(hc.reads).not.toContain("OxygenSaturation")
    expect(out.failedTypes).toContain("OxygenSaturation")
  })

  it("with nothing granted, reads nothing at all", async () => {
    hc.granted = new Set()
    const out = await within(readLast30Days())
    expect(hc.reads).toEqual([])
    expect(out.days).toEqual([])
  })
})

describe("steps and calories are one app's count, not every app's added", () => {
  beforeEach(() => {
    hc.granted = new Set(READ_TYPES)
    hc.reads = []
  })

  it("keeps the largest single-app total for the day", async () => {
    hc.records = {
      Steps: [
        { ...from("com.sec.android.app.shealth"), startTime: iso(9), endTime: iso(10), count: 5000 },
        { ...from("com.sec.android.app.shealth"), startTime: iso(17), endTime: iso(18), count: 4000 },
        { ...from("com.ouraring.oura"), startTime: iso(10), endTime: iso(20), count: 8000 },
      ],
      ActiveCaloriesBurned: [
        { ...from("com.sec.android.app.shealth"), startTime: iso(9), endTime: iso(10), energy: { unit: "kilocalories", value: 300 } },
        { ...from("com.ouraring.oura"), startTime: iso(9), endTime: iso(20), energy: { unit: "kilocalories", value: 420 } },
      ],
      TotalCaloriesBurned: [
        { ...from("com.sec.android.app.shealth"), startTime: iso(0), endTime: iso(12), energy: { unit: "kilocalories", value: 1100 } },
        { ...from("com.sec.android.app.shealth"), startTime: iso(12), endTime: iso(23), energy: { unit: "kilocalories", value: 1200 } },
        { ...from("com.ouraring.oura"), startTime: iso(0), endTime: iso(23), energy: { unit: "kilocalories", value: 2250 } },
      ],
    }
    const { days } = await within(readLast30Days())
    expect(days).toHaveLength(1)
    expect(days[0].steps).toBe(9000)
    expect(days[0].caloriesBurned).toBe(420)
    expect(days[0].totalCalories).toBe(2300)
  })

  it("one app alone is still summed across its own records", async () => {
    hc.records = {
      Steps: [
        { ...from("com.sec.android.app.shealth"), startTime: iso(9), endTime: iso(10), count: 1200 },
        { ...from("com.sec.android.app.shealth"), startTime: iso(11), endTime: iso(12), count: 800 },
      ],
    }
    const { days } = await within(readLast30Days())
    expect(days[0].steps).toBe(2000)
  })
})
