// The onboarding wizard's steps, decided by what is known about the person.
// The cycle question is asked of everyone except someone who said male —
// people who menstruate are not only those who picked "female".

export type OnboardingStep = "welcome" | "about" | "cycle" | "connect" | "notify" | "done"

export function onboardingSteps(known: { sex: "male" | "female" | null }): OnboardingStep[] {
  return ["welcome", "about", ...(known.sex === "male" ? [] : ["cycle" as const]), "connect", "notify", "done"]
}
