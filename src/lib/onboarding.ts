// Whether this account still has the onboarding wizard ahead of it.

import { prisma } from "@/lib/prisma"
import type { OnboardingConnections } from "@/lib/onboarding-steps"
import { stravaOffered } from "@/lib/strava-access"

/**
 * True for an account that has neither finished nor skipped onboarding and
 * has no data yet. Someone with data from before the wizard existed is marked
 * done instead of being sent through it. A database error lets them through:
 * a wizard is not worth locking anyone out of their dashboard.
 *
 * Kept out of the layout's try/catch on purpose — redirect() works by
 * throwing, and the catch around it used to swallow the redirect, so no new
 * account ever saw the wizard.
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
  try {
    const done = await prisma.userPreference.findUnique({
      where: { userId_key: { userId, key: "onboarding_completed" } },
      select: { value: true },
    })
    if (done) return false
    const hasData = await prisma.healthLog.count({ where: { userId }, take: 1 })
    if (hasData === 0) return true
    await prisma.userPreference.upsert({
      where: { userId_key: { userId, key: "onboarding_completed" } },
      create: { userId, key: "onboarding_completed", value: "true" },
      update: { value: "true" },
    }).catch(() => null)
    return false
  } catch {
    return false
  }
}

/**
 * What is already connected, for the connect step — on first paint, and again
 * when it comes back from Oura or Strava, so a finished connection shows as
 * done rather than as a fresh button. Each lookup fails to "not connected" on
 * its own; none of them is worth failing the wizard over.
 */
export async function onboardingConnections(userId: string): Promise<OnboardingConnections> {
  const [oura, strava, google, offered, apple] = await Promise.all([
    prisma.ouraToken.findUnique({ where: { userId }, select: { userId: true } }).catch(() => null),
    prisma.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM "StravaToken" WHERE "userId" = ${userId} LIMIT 1`.catch(() => []),
    // The calendar comes with a Google sign-in, so it is connected exactly
    // when this account holds a Google grant that includes it. An account
    // that never signed in with Google — the seeded demo a store reviewer
    // gets through the password form — has none, and must not be told
    // otherwise. A row from before scopes were recorded is the sign-in that
    // always asked for it.
    prisma.account.findFirst({ where: { userId, provider: "google" }, select: { scope: true } }).catch(() => null),
    stravaOffered(userId),
    prisma.appleHealthKey.findUnique({ where: { userId }, select: { lastUsedAt: true } }).catch(() => null),
  ])
  return {
    oura: !!oura,
    strava: strava.length > 0,
    stravaOffered: offered,
    appleHealth: apple?.lastUsedAt != null,
    calendar: !!google && (google.scope == null || google.scope.includes("calendar")),
  }
}
