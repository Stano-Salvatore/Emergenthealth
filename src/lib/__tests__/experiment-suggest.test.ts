import { describe, it, expect } from "vitest"
import { experimentSuggestion } from "@/lib/experiment-suggest"

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
  it("turns a supplement finding into a take-it experiment, but never a prescription", () => {
    expect(experimentSuggestion({ id: "supplement_magnesium_hrv", highGroupLabel: "Magnesium days" })?.action).toBe("Take Magnesium")
    expect(experimentSuggestion({ id: "supplement_frontin_deep", highGroupLabel: "Frontin still on board (12h half-life)" })).toBeNull()
  })
  it("has nothing to offer for exposures nobody controls", () => {
    expect(experimentSuggestion({ id: "rain_sleep", highGroupLabel: "rainy days" })).toBeNull()
    expect(experimentSuggestion({ id: "weekend_mood", highGroupLabel: "weekend days" })).toBeNull()
    expect(experimentSuggestion({ id: "calendar_load_sleep", highGroupLabel: "busy days" })).toBeNull()
  })
})
