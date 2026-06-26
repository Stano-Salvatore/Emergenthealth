import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/layout/DashboardShell"
import { EmergyPanel } from "@/components/emergy/EmergyPanel"
import { AutoSync } from "@/components/layout/AutoSync"
import { HealthConnectAutoSync } from "@/components/HealthConnectAutoSync"
import { NativeBridge } from "@/components/NativeBridge"
import { prisma } from "@/lib/prisma"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/signin")

  try {
    const prefs = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM "UserPreference" WHERE "userId" = ${session.user.id} AND key = 'onboarding_completed' LIMIT 1
    `
    if (!prefs.length) {
      // Check if this is an existing user with data
      const hasData = await prisma.healthLog.count({ where: { userId: session.user.id }, take: 1 }).catch(() => 0)
      if (hasData > 0) {
        // Auto-mark as onboarded — existing user
        await prisma.$executeRaw`
          INSERT INTO "UserPreference" ("userId", key, value)
          VALUES (${session.user.id}, 'onboarding_completed', 'true')
          ON CONFLICT ("userId", key) DO UPDATE SET value = 'true'
        `.catch(() => {})
      } else {
        redirect("/onboarding")
      }
    }
  } catch {
    // table not yet created, let user through
  }

  return (
    <>
      <DashboardShell>{children}</DashboardShell>
      <EmergyPanel />
      <AutoSync />
      <HealthConnectAutoSync />
      <NativeBridge />
    </>
  )
}
