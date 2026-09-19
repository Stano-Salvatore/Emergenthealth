import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { experimentSuggestion, COMBO_CONDITION, COMBO_OUTCOME } from "@/lib/experiment-suggest"

describe("experimentSuggestion", () => {
  it("turns a caffeine → sleep finding into an abstention experiment on sleep score", () => {
    const s = experimentSuggestion({ id: "sleep_panel_caffeine", highGroupLabel: "200mg+ of caffeine" })
    expect(s).toEqual({ name: "No caffeine over 200mg → sleep score", action: "No caffeine over 200mg", outcome: "sleepScore", outcomeLabel: "sleep score" })
  })

  // The panel's ids end in the cause (gates) or the aspect, not "_sleep", so
  // none of its cards had a "Test this" button while the older duplicates did.
  it("offers an experiment on the sleep panel's cards, but not its place cards", () => {
    expect(experimentSuggestion({ id: "sleep_panel_alcohol", highGroupLabel: "days with a drink" })?.name).toBe("No alcohol → sleep score")
    expect(experimentSuggestion({ id: "sleep_panel_caffeine_deep", highGroupLabel: "150mg+ of caffeine" })?.outcome).toBe("deepSleep")
    expect(experimentSuggestion({ id: "sleep_panel_alcohol_rem", highGroupLabel: "days with a drink" })?.outcome).toBe("remSleep")
    expect(experimentSuggestion({ id: "caffeine_deep_sleep", highGroupLabel: "150mg+ of caffeine" })?.action).toBe("No caffeine over 150mg")
    // Both sides of a place card had caffeine; abstaining tests nothing it measured.
    expect(experimentSuggestion({ id: "sleep_panel_caffeine_at_kaviaren", highGroupLabel: "caffeine at Kaviareň" })).toBeNull()
  })

  // The rule correlations.ts states beside `balancedCut` — a card never claims
  // a threshold it did not use — reaching the file one import away from it.
  // These actions were fixed strings, so the suggestion under a 16:00 card
  // said 14:00, and under a 1.5L cut it said two litres.
  it("never names a number the card in front of the user did not", () => {
    const cases: [string, string, string][] = [
      ["sleep_panel_caffeine", "150mg+ of caffeine", "150mg"],
      ["sleep_panel_late_caffeine", "caffeine after 16:00", "16:00"],
      ["water_energy", "1.5L+ water days", "1.5L"],
      ["food_late_meal_sleep", "last meal after 20:00", "20:00"],
      ["screen_sleep", "high screen days (4.2h+)", "4.2h"],
      ["fasting_sleep", "14h+ fast days", "14h"],
    ]
    for (const [id, highGroupLabel, threshold] of cases) {
      const action = experimentSuggestion({ id, highGroupLabel })!.action
      expect(action, `${id} should carry the card's own ${threshold}`).toContain(threshold)
    }
  })

  it("says nothing about a threshold when the card shows none", () => {
    // Better a vaguer experiment than a confidently wrong number.
    const action = experimentSuggestion({ id: "water_energy", highGroupLabel: "well-hydrated days" })!.action
    expect(action).toBe("More water")
    expect(action).not.toMatch(/\d/)
  })
  it("offers an earlier bedtime at the card's own hour", () => {
    const s = experimentSuggestion({ id: "sleep_panel_bedtime", highGroupLabel: "nights begun after 23:30" })!
    expect(s).toEqual({ name: "Lights out before 23:30 → sleep score", action: "Lights out before 23:30", outcome: "sleepScore", outcomeLabel: "sleep score" })
    // The cut is personal when the borrowed 23:30 fails to split the nights,
    // and the suggestion has to follow it rather than name a bedtime here.
    expect(experimentSuggestion({ id: "sleep_panel_bedtime", highGroupLabel: "nights begun after 01:15" })?.action).toBe("Lights out before 01:15")
    expect(experimentSuggestion({ id: "sleep_panel_bedtime_deep", highGroupLabel: "nights begun after 23:30" })?.outcome).toBe("deepSleep")
  })
  it("turns a supplement finding into a take-it experiment, but never a prescription", () => {
    expect(experimentSuggestion({ id: "supplement_magnesium_hrv", highGroupLabel: "Magnesium days" })?.action).toBe("Take Magnesium")
    expect(experimentSuggestion({ id: "supplement_frontin_deep", highGroupLabel: "Frontin still on board (12h half-life)" })).toBeNull()
  })
  // The interaction cards name the outcome FIRST — `combo_hrv_alcohol_...` —
  // so the suffix table read a condition where the outcome should be and every
  // one of them came back null. These are the cards the weekly email leads
  // with, and not one of them had a button.
  describe("combination cards", () => {
    it("tests the whole conjunction, on the outcome the id names", () => {
      expect(experimentSuggestion({ id: "combo_hrv_alcohol_short_night", highGroupLabel: "days with alcohol and a short night before" }))
        .toEqual({ name: "No alcohol and a full night → HRV", action: "No alcohol and a full night", outcome: "hrv", outcomeLabel: "HRV" })
    })

    it("carries each ingredient's own threshold, from the card's own label", () => {
      const s = experimentSuggestion({ id: "combo_readiness_caffeine_hydrated", highGroupLabel: "days with 150mg+ of caffeine and 2L+ of fluid" })!
      expect(s.action).toBe("No caffeine over 150mg and 2L of fluid")
      expect(s.outcome).toBe("readiness")
    })

    it("handles a triple, and a label it cannot line up", () => {
      expect(experimentSuggestion({ id: "combo_sleep_alcohol_caffeine_late_meal", highGroupLabel: "days with alcohol, 200mg+ of caffeine and a late meal" })?.action)
        .toBe("No alcohol, no caffeine over 200mg and an earlier last meal")
      // Label and id out of step: an action without figures beats a wrong one.
      expect(experimentSuggestion({ id: "combo_sleep_alcohol_caffeine", highGroupLabel: "some other phrasing entirely" })?.action)
        .toBe("No alcohol and no caffeine")
    })

    it("offers nothing when one ingredient is not the user's to switch off", () => {
      // Half the conjunction is not the card. Testing "no caffeine" under a
      // caffeine-AND-stress card would answer a question it never asked.
      expect(experimentSuggestion({ id: "combo_readiness_caffeine_stress", highGroupLabel: "days with 150mg+ of caffeine and 150+ min high stress" })).toBeNull()
      expect(experimentSuggestion({ id: "combo_sleep_alcohol_away", highGroupLabel: "days with alcohol and a day away from home" })).toBeNull()
    })

    it("abandons an id it cannot read rather than guessing at it", () => {
      expect(experimentSuggestion({ id: "combo_sleep_moon_phase", highGroupLabel: "days with a full moon" })).toBeNull()
      expect(experimentSuggestion({ id: "combo_bedtime_alcohol", highGroupLabel: "days with alcohol" })).toBeNull()
    })

    // Both tables above are copies of arrays that live inside a function in
    // correlations.ts, where nothing imports them. This is what makes the copy
    // a guard instead of a second place to forget.
    it("knows every condition and outcome the engine actually builds ids from", () => {
      const src = readFileSync(join(process.cwd(), "src/lib/correlations.ts"), "utf8")
      const keysIn = (name: string): string[] => {
        const start = src.indexOf(`const ${name}`)
        expect(start, `${name} should still exist in correlations.ts`).toBeGreaterThan(-1)
        const body = src.slice(start, src.indexOf("\n    ]", start))
        return [...body.matchAll(/key: "([a-z_]+)"/g)].map(m => m[1])
      }
      expect(keysIn("COMBO_CONDITIONS")).toEqual(COMBO_CONDITION.map(([k]) => k))
      expect(keysIn("COMBO_OUTCOMES")).toEqual(Object.keys(COMBO_OUTCOME))
    })
  })
  it("has nothing to offer for exposures nobody controls", () => {
    expect(experimentSuggestion({ id: "rain_sleep", highGroupLabel: "rainy days" })).toBeNull()
    expect(experimentSuggestion({ id: "weekend_mood", highGroupLabel: "weekend days" })).toBeNull()
    expect(experimentSuggestion({ id: "calendar_load_sleep", highGroupLabel: "busy days" })).toBeNull()
  })
})
