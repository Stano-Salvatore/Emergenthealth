// The cycle's own colours. Not the domain palette: these name phases, and a
// phase is not a domain. Fixed across themes so a phase is always its colour.

import type { Phase } from "@/lib/cycle"

export const PHASE_HEX: Record<Phase, string> = {
  menstrual: "#f43f5e",
  follicular: "#34d399",
  ovulation: "#f59e0b",
  luteal: "#818cf8",
}

/** A non-period day under hormonal contraception: no phase to name. */
export const NEUTRAL_HEX = "#94a3b8"
