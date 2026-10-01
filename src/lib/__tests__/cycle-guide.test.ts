import { describe, it, expect } from "vitest"
import { PHASE_GUIDE, CONTRACEPTION_GUIDE, DOCTOR_SIGNS, PREMENSTRUAL } from "@/lib/cycle-guide"
import { PHASES, CONTRACEPTION } from "@/lib/cycle"

const everyLine = (): string[] => [
  ...Object.values(PHASE_GUIDE).flatMap(g => [g.summary, g.hormones, ...g.expect, ...g.food, ...g.movement, ...g.sleep, ...g.medicines]),
  ...PREMENSTRUAL.expect, ...PREMENSTRUAL.helps,
  ...Object.values(CONTRACEPTION_GUIDE).flatMap(g => [g.summary, ...g.notes]),
  ...DOCTOR_SIGNS,
]

describe("the phase guide", () => {
  it("covers every phase with every section filled", () => {
    for (const p of PHASES) {
      const g = PHASE_GUIDE[p]
      expect(g, p).toBeDefined()
      for (const k of ["expect", "food", "movement", "sleep", "medicines"] as const) {
        expect(g[k].length, `${p}.${k}`).toBeGreaterThan(0)
      }
    }
  })

  it("covers every contraception choice the settings offer", () => {
    for (const c of CONTRACEPTION) expect(CONTRACEPTION_GUIDE[c], c).toBeDefined()
  })

  it("informs rather than prescribes: no doses, no orders", () => {
    for (const line of everyLine()) {
      expect(line, line).not.toMatch(/\d+\s?(mg|mcg|µg|iu|g)\b/i)
      expect(line, line).not.toMatch(/\byou (should|must)\b|\bmake sure\b/i)
    }
  })

  it("sends medicine questions to the people who can answer them", () => {
    const meds = Object.values(PHASE_GUIDE).flatMap(g => g.medicines).join(" ")
    expect(meds).toMatch(/pharmacist/)
    expect(meds).toMatch(/label|leaflet/)
    const pill = CONTRACEPTION_GUIDE.combined_pill.notes.join(" ")
    expect(pill).toMatch(/leaflet/)
    expect(pill).toMatch(/St John's wort/)
  })

  it("never presents the fertile window as contraception", () => {
    expect(CONTRACEPTION_GUIDE.none.summary).toMatch(/not (a method of )?contraception/i)
  })
})
