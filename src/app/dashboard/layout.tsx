import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/layout/DashboardShell"
import { TogglPanel } from "@/components/toggl/TogglPanel"
import { AutoSync } from "@/components/layout/AutoSync"
import { prisma } from "@/lib/prisma"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/signin")

  try {
    const prefs = await prisma.$queryRaw<{ value: string }[]>`
      SELECT value FROM "UserPreference" WHERE "userId" = ${session.user.id} AND key = 'onboarding_completed' LIMIT 1
    `
    if (!prefs.length) redirect("/onboarding")
  } catch {
    // table not yet created, let user through
  }

  return (
    <>
      <DashboardShell>{children}</DashboardShell>
      <TogglPanel />
      <AutoSync />
    </>
  )
}
