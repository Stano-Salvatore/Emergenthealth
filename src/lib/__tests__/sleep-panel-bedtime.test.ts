import { describe, it, expect, vi } from "vitest"

// The panel measured bedtime from the day it was written, and never asked
// about it. Every other cause is checked against it — "nights with caffeine
// after 16:00 typically began 90 minutes later, so some of this gap is
// bedtime" — while the biggest lever on this account's sleep score had no card
// of its own. It could not simply be added as a combination condition either:
// there a night with no ring reads as "went to bed early" rather than as
// unknown, and the triples grow from that.
//
// Two planted histories, told apart by user id, because the interesting
// question is not whether the card appears but whether it admits what else
// moved with it:
//
//   user_clean   late nights are LATE only — same 7h either way.
//   user_short   late nights are late AND an hour shorter, which is how late
//                nights usually happen, the alarm not having moved.
//
// Both score the same: 60 after a late start, 85 after an early one. So the
// card is the same card, and only the sentence under it should differ.

const { clean, short } = vi.hoisted(() => {
  const DAYS = 61
  const dates: string[] = []
  const now = new Date()
  for (let i = DAYS; i >= 0; i--) dates.push(new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10))

  // Five late nights, then five early ones. Not alternating: a block
  // permutation can reproduce a strictly periodic signal by accident, and the
  // gate is a permutation test.
  const late = (j: number) => Math.floor(j / 5) % 2 === 0

  const build = (shorten: boolean) => dates.map((ds, j) => {
    const isLate = late(j)
    return {
      date: new Date(ds + "T00:00:00Z"),
      // 01:30 and 22:30 — either side of any cut between them.
      sleepStart: new Date(ds + (isLate ? "T01:30:00Z" : "T22:30:00Z")),
      sleepDuration: isLate && shorten ? 360 : 420,
      sleepScore: isLate ? 60 : 85,
      deepSleep: isLate ? 50 : 90,
      remSleep: null,
      sleepLatency: null,
      sleepEfficiency: null,
      restlessPeriods: null,
      readinessScore: null,
      restingHR: null,
      stressHigh: null,
      hrv: null,
      steps: null,
      activityScore: null,
    }
  })
  return { clean: build(false), short: build(true) }
})

vi.mock("@/lib/prisma", () => {
  const empty = { findMany: vi.fn().mockResolvedValue([]) }
  return {
    prisma: {
      healthLog: {
        findMany: vi.fn((args: { where?: { userId?: string } }) =>
          Promise.resolve(args?.where?.userId === "user_short" ? short : clean)),
      },
      habitCompletion: empty, weatherLog: empty, screenTimeLog: empty, deviceCalendarEvent: empty,
      intakeLog: empty, caffeineLog: empty, foodLog: empty, ouraTag: empty, moodLog: empty,
      stravaActivity: empty, symptomLog: empty, focusSession: empty, transaction: empty,
      activitySpan: empty, rescuetimeLog: empty, bloodPressureLog: empty, bodyMeasurement: empty,
      userPreference: { findUnique: vi.fn().mockResolvedValue({ value: "UTC" }) },
      $queryRaw: vi.fn().mockResolvedValue([]),
    },
  }
})

import { computeCorrelations } from "@/lib/correlations"

describe("the sleep panel asks about bedtime", () => {
  it("compares the nights that began late against the ones that did not", async () => {
    const { insights } = await computeCorrelations("user_clean", 90)
    const gate = insights.find(i => i.id === "sleep_panel_bedtime")
    expect(gate, "bedtime is a cause like any other").toBeDefined()
    expect(gate!.highGroupAvg).toBe(60)
    expect(gate!.lowGroupAvg).toBe(85)
    // The chip carries the cut, so the card never claims a time it did not use.
    expect(String(gate!.highGroupLabel)).toMatch(/\d{2}:\d{2}/)
  })

  it("opens its aspects once the gate clears, like every other cause", async () => {
    const { insights } = await computeCorrelations("user_clean", 90)
    const deep = insights.find(i => i.id === "sleep_panel_bedtime_deep")
    expect(deep, "a cleared gate is the licence to look closer").toBeDefined()
    expect(deep!.pool).toBe("sleep_panel_bedtime")
    expect(deep!.highGroupAvg).toBe(50)
    expect(deep!.lowGroupAvg).toBe(90)
  })

  it("says nothing about length when length held still", async () => {
    const { insights } = await computeCorrelations("user_clean", 90)
    const gate = insights.find(i => i.id === "sleep_panel_bedtime")!
    // Seven hours either side. A note here would be a warning about nothing,
    // and the panel's warnings are only worth reading if they are rare.
    expect(gate.confounded).toBeUndefined()
  })

  it("admits it when the late nights were also the short ones", async () => {
    const { insights } = await computeCorrelations("user_short", 90)
    const gate = insights.find(i => i.id === "sleep_panel_bedtime")!
    expect(gate.confounded, "the hour lost at the start is usually an hour of sleep").toBeDefined()
    expect(gate.confounded).toMatch(/60 minutes shorter/)
    // Named on the late side, which is the side that lost the hour.
    expect(gate.confounded).toMatch(/after \d{2}:\d{2}/)
  })

  it("never reports that late nights begin late", async () => {
    // The check every other cause gets is bedtime, and on this card that
    // sentence would be a tautology dressed as a caveat.
    for (const user of ["user_clean", "user_short"]) {
      const { insights } = await computeCorrelations(user, 90)
      const gate = insights.find(i => i.id === "sleep_panel_bedtime")!
      expect(gate.confounded ?? "").not.toMatch(/began/)
    }
  })
})
