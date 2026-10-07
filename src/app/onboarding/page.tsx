// The first-run wizard's server half: everything already known about the
// account is read here, so the wizard paints with the user's own name, saved
// answers and connections from the first frame instead of filling in a beat
// later. The steps themselves are OnboardingWizard.

import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getGoals } from "@/lib/goals"
import { getCycleSettings } from "@/lib/cycle-load"
import { onboardingConnections } from "@/lib/onboarding"
import { readyShortcutUrl } from "@/lib/apple-shortcut"
import { OnboardingWizard } from "./OnboardingWizard"

export const dynamic = "force-dynamic"

type Search = { step?: string; oura_error?: string; strava_error?: string }

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await auth()
  if (!session?.user?.id) redirect("/signin")
  const userId = session.user.id
  const sp = await searchParams

  const [goals, cycle, connections] = await Promise.all([
    getGoals(userId).catch(() => null),
    getCycleSettings(userId).catch(() => null),
    onboardingConnections(userId),
  ])

  // Coming back from Oura or Strava lands on the connect step. A success
  // shows as the row's own "Connected"; a failure needs saying.
  const connectError = sp.oura_error ? "oura"
    : sp.strava_error === "closed" ? "strava_closed"
    : sp.strava_error ? "strava" : null

  return (
    <OnboardingWizard
      firstName={session.user.name?.trim().split(/\s+/)[0] || null}
      initial={{
        sex: goals?.sex ?? null,
        birthYear: goals?.birthYear ?? null,
        weightKg: goals?.weightKg ?? null,
        heightCm: goals?.heightCm ?? null,
        // Only a "yes" already given is carried back in; the absence of one is
        // not a "no", so nothing is preselected.
        tracksCycle: cycle?.settings.enabled ? true : null,
        lastStart: cycle?.settings.lastStart ?? null,
        contraception: cycle?.settings.contraception ?? "none",
      }}
      connections={connections}
      startAt={sp.step === "connect" ? "connect" : "welcome"}
      connectError={connectError}
      shortcutUrl={readyShortcutUrl()}
    />
  )
}
