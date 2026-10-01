// Whether this account still has the onboarding wizard ahead of it.

import { prisma } from "@/lib/prisma"

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
