import { describe, it, expect } from "vitest"
import { sleepDebt, sleepRegularity, type RhythmNight } from "@/lib/sleep-rhythm"

describe("sleep debt", () => {
  it("lets a long night pay some of it back", () => {
    // Six nights at 6h against a 7.5h goal, then one at 12h.
    const week = [360, 360, 360, 360, 360, 360, 720]
    const d = sleepDebt(week, 7.5)!
    // 7 x 450 = 3150 against 2880 slept.
    expect(d.shortfallMin).toBe(270)
    expect(d.nights).toBe(7)
    // The clamped sum the Week page used to compute, on the same week. It
    // cannot see the Saturday at all, so it reports nearly twice the debt and
    // could never report none.
    const clamped = week.reduce((s, n) => s + Math.max(0, 450 - n), 0)
    expect(clamped).toBe(540)
    expect(clamped).toBeGreaterThan(d.shortfallMin)
  })

  it("can say you are ahead", () => {
    const d = sleepDebt([480, 480, 480, 480], 7.5)!
    expect(d.shortfallMin).toBe(-120)
  })

  it("counts a night nobody measured as unknown, not as no sleep", () => {
    // Three real nights at the goal, four nights the ring sat in a drawer.
    const d = sleepDebt([450, 450, 450, null, null, undefined, 0], 7.5)!
    expect(d.nights, "only the measured nights").toBe(3)
    expect(d.shortfallMin, "an unworn ring is not eight hours of debt").toBe(0)
  })

  it("says nothing on a single night", () => {
    expect(sleepDebt([300], 7.5)).toBeNull()
    expect(sleepDebt([], 7.5)).toBeNull()
  })
})

// Nights are built by their END date, which is how the ring files them: the
// night dated the 10th began on the evening of the 9th.
function night(date: string, from: string, to: string): RhythmNight {
  // An evening start belongs to the day before; an after-midnight one to the
  // same date the night is filed under. Noon is the split, the same place
  // `bedtimeMinutesLate` puts it.
  const prev = new Date(`${date}T00:00:00Z`)
  prev.setUTCDate(prev.getUTCDate() - 1)
  const startDay = Number(from.slice(0, 2)) >= 12 ? prev.toISOString().slice(0, 10) : date
  return {
    date,
    sleepStart: new Date(`${startDay}T${from}:00Z`),
    sleepEnd: new Date(`${date}T${to}:00Z`),
  }
}

const days = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `2026-03-${String(from + i).padStart(2, "0")}`)

describe("sleep regularity", () => {
  it("scores a metronome at 100", () => {
    const nights = days(14).map(d => night(d, "23:00", "07:00"))
    expect(sleepRegularity(nights, "UTC")).toEqual({ sri: 100, pairs: 12 })
  })

  it("scores a fortnight of flipped shifts near the floor", () => {
    // Alternating nights and days: asleep 23:00-07:00, then 11:00-19:00.
    const nights = days(14).map((d, i) =>
      i % 2 === 0 ? night(d, "23:00", "07:00") : night(d, "11:00", "19:00"))
    const r = sleepRegularity(nights, "UTC")!
    expect(r.sri).toBeLessThan(0)
  })

  it("puts an hour of nightly drift between the two", () => {
    const nights = days(14).map((d, i) => {
      const h = 22 + i   // 22:00, 23:00, 00:00 … creeping round the clock
      return night(d, `${String(h % 24).padStart(2, "0")}:00`, `${String((h + 8) % 24).padStart(2, "0")}:00`)
    })
    const r = sleepRegularity(nights, "UTC")!
    expect(r.sri).toBeGreaterThan(0)
    expect(r.sri).toBeLessThan(90)
  })

  // The one that matters. A gap must not read as agreement.
  it("never scores a gap as a pair of identical days", () => {
    // A week of one bedtime, three nights missing, then a week of a very
    // different one. If the missing nights counted as "awake all day" the two
    // of them in the middle would agree perfectly with each other.
    const early = days(7).map(d => night(d, "22:00", "06:00"))
    const late = days(7, 11).map(d => night(d, "02:00", "10:00"))
    const withGap = sleepRegularity([...early, ...late], "UTC")!
    // Every pair it can still form is inside one of the two stretches, both of
    // which are metronomes — so the honest answer is 100, not a number pulled
    // down or up by three nights nobody recorded.
    expect(withGap.sri).toBe(100)
    // And it is based on fewer pairs than a solid fortnight would give.
    expect(withGap.pairs).toBeLessThan(12)
  })

  it("waits for a week of pairs before saying anything", () => {
    expect(sleepRegularity(days(5).map(d => night(d, "23:00", "07:00")), "UTC")).toBeNull()
    expect(sleepRegularity([], "UTC")).toBeNull()
  })

  it("ignores a night with no window recorded", () => {
    const nights: RhythmNight[] = days(14).map(d => night(d, "23:00", "07:00"))
    nights[5] = { date: nights[5].date, sleepStart: null, sleepEnd: null }
    const r = sleepRegularity(nights, "UTC")!
    expect(r.sri).toBe(100)
    expect(r.pairs).toBeLessThan(12)
  })
})
