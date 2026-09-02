import { describe, it, expect } from "vitest"
import { experimentSuggestion } from "@/lib/experiment-suggest"

describe("experimentSuggestion", () => {
  it("turns a caffeine → sleep finding into an abstention experiment on sleep score", () => {
    const s = experimentSuggestion({ id: "caffeine_sleep", highGroupLabel: "200mg+ caffeine days" })
    expect(s).toEqual({ name: "No caffeine after 14:00 → sleep score", action: "No caffeine after 14:00", outcome: "sleepScore", outcomeLabel: "sleep score" })
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
