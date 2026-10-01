// The onboarding wizard's steps, decided by what is known about the person.
// How patterns work comes before anything is asked: every question after it is
// in service of those patterns, and reads as a request without it.
// The cycle question is asked of everyone except someone who said male —
// people who menstruate are not only those who picked "female".

export type OnboardingStep = "welcome" | "patterns" | "about" | "cycle" | "connect" | "notify" | "done"

export function onboardingSteps(known: { sex: "male" | "female" | null }): OnboardingStep[] {
  return ["welcome", "patterns", "about", ...(known.sex === "male" ? [] : ["cycle" as const]), "connect", "notify", "done"]
}

/** What the connect step shows as already done. */
export interface OnboardingConnections {
  oura: boolean
  strava: boolean
  /** True only for an account holding a Google grant that includes the calendar. */
  calendar: boolean
}
