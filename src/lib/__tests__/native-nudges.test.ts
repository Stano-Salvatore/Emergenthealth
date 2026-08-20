import { describe, it, expect } from "vitest"
import { buildNudges } from "@/lib/native/notifications"

// A hydration reminder that opens the dashboard has asked a question and then
// hidden the answer. Every nudge names the page it is about, and the ids stay
// fixed because copies scheduled by older builds repeat forever on the phone
// and are routed by id until they are replaced.

describe("buildNudges", () => {
  it("gives every nudge a destination", () => {
    const nudges = buildNudges({ morningHour: 8, noon: true, evening: true })
    expect(nudges).toHaveLength(3)
    expect(nudges.every(n => n.url.startsWith("/dashboard/"))).toBe(true)
    expect(nudges.find(n => n.id === 910001)?.url).toBe("/dashboard/checkin")
    expect(nudges.find(n => n.id === 910002)?.url).toBe("/dashboard/intake")
    expect(nudges.find(n => n.id === 910003)?.url).toBe("/dashboard/habits")
  })

  it("honours the morning hour and the noon/evening toggles", () => {
    const nudges = buildNudges({ morningHour: 6, noon: false, evening: false })
    expect(nudges).toHaveLength(1)
    expect(nudges[0].hour).toBe(6)
    expect(nudges[0].url).toBe("/dashboard/checkin")
  })
})
