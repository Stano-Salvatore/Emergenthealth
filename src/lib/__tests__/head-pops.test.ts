import { describe, it, expect } from "vitest"
import { buildPops } from "@/lib/native/notifications"

// What Emergy pops out to say, and when.
//
// The first version of this took only notifications with a concrete `at`,
// which excluded the repeating daily nudges. For an account with no timed
// reminders — no to-dos with a time, no habit reminder time, no medication —
// the daily nudges are the *only* thing scheduled, so the feature armed
// nothing and truthfully reported "0 reminders armed". A correct number and a
// useless feature.
//
// The case below with no one-shots at all is that account. It is the test that
// matters here; the rest guard the edges around it.

const PREFS = { morningHour: 8, noon: true, evening: true }
const NOON = new Date(2026, 7, 24, 12, 0, 0)   // a Monday, midday

describe("buildPops", () => {
  it("arms the daily nudges when nothing else is scheduled", () => {
    const pops = buildPops([], PREFS, NOON)
    expect(pops.length).toBeGreaterThan(0)
    // Hydration at 13:00 is still ahead of a midday "now", so it comes first.
    expect(pops[0].message).toContain("Hydration")
  })

  it("skips occurrences that have already passed today", () => {
    // 08:00 morning check-in is behind a midday now, so today's is not armed;
    // the next six days are.
    const morning = buildPops([], PREFS, NOON).filter(p => p.message.includes("Morning"))
    expect(morning).toHaveLength(6)
    expect(morning.every(p => p.at > NOON.getTime())).toBe(true)
  })

  it("carries one-shot notifications across with their body", () => {
    const at = new Date(2026, 7, 24, 18, 30)
    const pops = buildPops(
      [{ id: 5, title: "Call the dentist", body: "before they close", schedule: { at } }],
      { morningHour: 8, noon: false, evening: false },
      NOON,
    )
    const one = pops.find(p => p.message.startsWith("Call the dentist"))
    expect(one).toBeDefined()
    expect(one!.at).toBe(at.getTime())
    expect(one!.message).toBe("Call the dentist — before they close")
  })

  it("ignores a repeating notification's own entry, having expanded it already", () => {
    const pops = buildPops(
      [{ id: 910001, title: "🌅 Morning check-in", schedule: { on: { hour: 8, minute: 0 }, repeats: true } }],
      { morningHour: 8, noon: false, evening: false },
      NOON,
    )
    // Six, not seven: no duplicate from the repeating entry itself.
    expect(pops).toHaveLength(6)
  })

  it("arms nothing from nudges when they are switched off", () => {
    expect(buildPops([], PREFS, NOON, false)).toEqual([])
  })

  it("gives every pop a distinct id", () => {
    const pops = buildPops(
      [{ id: 1, title: "One", schedule: { at: new Date(2026, 7, 24, 19, 0) } }],
      PREFS,
      NOON,
    )
    expect(new Set(pops.map(p => p.id)).size).toBe(pops.length)
  })

  it("returns them in the order they will happen", () => {
    const pops = buildPops([], PREFS, NOON)
    const times = pops.map(p => p.at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})
