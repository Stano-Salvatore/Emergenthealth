import { describe, it, expect, vi, beforeEach } from "vitest"

// "What meds did I take today" read every Oura tag of the day as a dose, so a
// Coffee and a Water tagged in the Oura app came back as "Today: Coffee,
// Water, Atarax." — and "what have I logged today" listed the coffee under
// drinks (the sync mirrors it into IntakeLog) and again under doses. The
// briefing's "Taken today" line reads the same list. A dose is a tag the
// shared classifier calls a med, named the way the dashboard and body load
// name it: "Atarax - half" with ½ tablet is Atarax ½ tablet, not the half twice.

const db = {
  tags: [] as { tagName: string | null; text: string | null; day: string; timestamp: Date; doseAmount: number | null; doseUnit: string | null }[],
  intake: [] as { type: string; amountMl: number; note: string | null; loggedAt: Date }[],
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ouraTag: {
      findMany: async ({ where }: { where: { day: string } }) =>
        db.tags.filter(t => t.day === where.day),
    },
    intakeLog: { findMany: async () => db.intake },
  },
}))
vi.mock("@/lib/user-timezone", () => ({ getUserTimezone: async () => "Europe/Bratislava" }))

import { runQuickAnswer } from "@/lib/quick-answer-run"

const tag = (tagName: string, at: string, doseAmount: number | null = null, doseUnit: string | null = null) =>
  ({ tagName, text: null, day: "2026-09-30", timestamp: new Date(at), doseAmount, doseUnit })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-09-30T16:00:00Z"))
  db.tags = [
    tag("Coffee", "2026-09-30T06:30:00Z"),
    tag("Water", "2026-09-30T07:00:00Z"),
    tag("Kofola", "2026-09-30T11:00:00Z"),
    tag("Atarax - half", "2026-09-30T08:00:00Z", 0.5, "tablet"),
  ]
  db.intake = [
    { type: "coffee", amountMl: 200, note: "Coffee (Oura)", loggedAt: new Date("2026-09-30T06:30:00Z") },
    { type: "water", amountMl: 300, note: "Water (Oura)", loggedAt: new Date("2026-09-30T07:00:00Z") },
  ]
})

describe("today's doses are doses, not drinks", () => {
  it("answers 'what meds did I take today' with the med alone", async () => {
    const a = await runQuickAnswer("u1", "what meds did I take today")
    expect(a!.reply).toBe("Today: Atarax ½ tablet.")
  })

  it("lists the coffee once, under drinks, when asked what was logged", async () => {
    const a = await runQuickAnswer("u1", "what have I logged today")
    expect(a!.reply).toMatch(/\*\*1\*\* dose: Atarax ½ tablet/)
    expect(a!.reply).not.toMatch(/doses:/)
  })

  it("says nothing was taken when the day holds only drink tags", async () => {
    db.tags = db.tags.filter(t => !/atarax/i.test(t.tagName!))
    const a = await runQuickAnswer("u1", "what meds did I take today")
    expect(a!.reply).toBe("Nothing logged today.")
  })
})
