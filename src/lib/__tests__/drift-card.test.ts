import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { driftQuestion, fmtDrift, renderDrift, type DriftReport } from "@/lib/drift"
import { rollingWindows, calendarWindows } from "@/lib/drift-load"

// The month-on-month comparison is the app's most careful one — every shift
// block-permutation tested at the bar a correlation card clears, every
// candidate cause drawn from the user's own logs — and until now it was shown
// in exactly one place: a push on the 1st. Twelve questions a year, on no
// screen at all.
//
// Putting it on a screen adds a second renderer, which is the risk these
// guard: the push, the chat tool and the card must ask one question and print
// one number format, or they read as three half-built features.

const card = readFileSync("src/components/dashboard/DriftCard.tsx", "utf8")
/** What the card renders. A comment may name the jargon it keeps out. */
const cardText = card.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ")
const route = readFileSync("src/app/api/insights/drift/route.ts", "utf8")
const page = readFileSync("src/app/dashboard/insights/page.tsx", "utf8")

const shift = (over: Partial<DriftReport["shifts"][number]> = {}) => ({
  key: "restingHR", label: "Resting heart rate", unit: "bpm",
  recentMean: 48.3, priorMean: 51.5, recentN: 30, priorN: 30,
  delta: -3.2, p: 0.01, verdict: "better" as const, ...over,
})
const report = (over: Partial<DriftReport> = {}): DriftReport => ({
  recent: { from: "2026-08-15", to: "2026-09-13" },
  prior: { from: "2026-07-16", to: "2026-08-14" },
  judged: 6, shifts: [shift()], factors: [], ...over,
})

describe("one question, asked the same way everywhere", () => {
  it("asks what the app never saw when nothing logged moved", () => {
    expect(driftQuestion(report())).toContain("isn't in the app")
  })

  it("asks them to pick when there are candidates", () => {
    const withFactors = report({ factors: [{ label: "Magnesium", unit: "days", recent: 24, prior: 4 }] })
    expect(driftQuestion(withFactors)).toContain("ring true")
  })

  it("is the same sentence the push and the chat tool end on", () => {
    // The failure this prevents: three surfaces each growing their own
    // phrasing, so the same feature reads as three.
    for (const r of [report(), report({ factors: [{ label: "Magnesium", unit: "days", recent: 24, prior: 4 }] })]) {
      expect(renderDrift(r)!.headline).toContain(driftQuestion(r))
      expect(renderDrift(r)!.detail).toContain(driftQuestion(r))
    }
  })

  it("the card takes the question rather than writing one", () => {
    expect(card).toContain("{question}")
    expect(route).toContain("driftQuestion(report)")
    expect(cardText, "a question written in the card will drift from the other two")
      .not.toMatch(/did something change|ring true/)
  })
})

describe("one number format", () => {
  it("spaces a unit but not an hour or a score", () => {
    expect(fmtDrift(48.3, "bpm")).toBe("48.3 bpm")
    expect(fmtDrift(7.4, "h")).toBe("7.4h")
    expect(fmtDrift(3.8, "/5")).toBe("3.8/5")
    expect(fmtDrift(74, "")).toBe("74")
    // "89 %" is what this printed until sleep efficiency was put on a screen.
    // The monthly push had been saying it for as long as the push existed.
    expect(fmtDrift(89, "%")).toBe("89%")
  })

  it("groups a step count", () => {
    expect(fmtDrift(9120, "")).toBe("9,120")
  })

  it("the card uses it instead of its own", () => {
    expect(card).toContain("fmtDrift(")
    expect(cardText, "a second formatter here is how 48 bpm becomes 48bpm on one screen")
      .not.toMatch(/toFixed\(/)
  })
})

describe("rolling, not calendar", () => {
  // The push compares September to August, which is right for a message that
  // arrives on the 1st and wrong for a screen opened on the 14th: by then
  // "last month" is a fortnight stale and the shift worth asking about is the
  // one happening now.
  it("the card's window ends today", () => {
    const w = rollingWindows("2026-09-13")
    expect(w.recent.to).toBe("2026-09-13")
    expect(w.recent.from).toBe("2026-08-15")
    expect(w.prior.to).toBe("2026-08-14")
    expect(w.prior.from).toBe("2026-07-16")
  })

  it("the two windows are the same length and do not overlap", () => {
    const w = rollingWindows("2026-09-13")
    const days = (a: string, b: string) =>
      Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000) + 1
    expect(days(w.recent.from, w.recent.to)).toBe(30)
    expect(days(w.prior.from, w.prior.to)).toBe(30)
    expect(w.prior.to < w.recent.from).toBe(true)
  })

  it("the route asks for rolling and the monthly push still asks for calendar", () => {
    expect(route).toContain("rollingWindows(")
    expect(route, "a calendar window on a screen you open any day is stale by design")
      .not.toContain("calendarWindows")
    expect(readFileSync("src/app/api/cron/monthly-drift/route.ts", "utf8")).toContain("calendarWindows(")
    // Both still exist and still differ — a guard against someone "tidying"
    // one into the other.
    expect(calendarWindows("2026-09-13").recent).toEqual({ from: "2026-08-01", to: "2026-08-31" })
  })
})

describe("the card on the page", () => {
  it("is rendered where the patterns are", () => {
    expect(page).toContain("<DriftCard />")
  })

  it("sends the answer somewhere it can land", () => {
    // The whole reason this is worth building now: log_tag shipped, so a reply
    // in chat becomes a tag on the days it describes. Without the link the
    // card is a question into the void, which is what it was before.
    expect(card).toContain('href="/dashboard/chat"')
  })

  it("renders nothing rather than an empty card", () => {
    // "No measurable change" is honest and often reassuring, but it is not
    // worth a card on every visit.
    expect(card).toContain("data.shifts.length === 0) return null")
    expect(renderDrift(report({ shifts: [] }))).toBeNull()
  })

  it("keeps the statistics off the screen", () => {
    // The same rule the other five pattern surfaces are held to.
    for (const term of ["permutation", "p-value", "p <", "significan", "Sample size", "(n="]) {
      expect(cardText, `"${term}" is method, not a finding`).not.toContain(term)
    }
  })

  it("calls the factors candidates rather than causes", () => {
    expect(card).toContain("Changed alongside")
    expect(cardText).not.toMatch(/\bbecause\b|\bcaused\b|\bdue to\b/i)
  })
})
