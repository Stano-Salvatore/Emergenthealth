import { describe, it, expect, vi } from "vitest"

// The phone lays down "💊 Time for your dose" alarms from GET /api/med-schedule
// and skips today's first `takenToday` slots — the dose already taken covers
// them. The route computed that count for its own "today" chips and never
// sent it, so the phone always read 0: Atarax taken at 21:40 still rang
// "Time for your dose — Atarax" at 22:00, an invitation to a second dose of
// a sedative.

vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/user-timezone", () => ({ getUserTimezone: async () => "UTC" }))
vi.mock("@/lib/prisma", () => {
  const today = new Date().toISOString().slice(0, 10)
  return {
    prisma: {
      medSchedule: {
        findMany: async () => [{
          id: "m1", userId: "u1", name: "Atarax", dose: "25 mg", times: ["08:00", "22:00"], daysOfWeek: [],
          active: true, remind: true, note: null, startDate: null, endDate: null, createdAt: new Date(0),
        }],
      },
      $queryRaw: () => Promise.resolve([{ day: today, tagName: "Atarax", text: null }]),
    },
  }
})

import { GET } from "@/app/api/med-schedule/route"

describe("GET /api/med-schedule", () => {
  it("tells the phone how many of today's doses are already taken", async () => {
    const res = await GET()
    const data = await res.json()
    expect(data.items).toHaveLength(1)
    expect(data.items[0].takenToday, "the phone's alarms have no way to know a dose was taken").toBe(1)
  })
})
