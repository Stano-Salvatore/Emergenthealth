import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/layout/DashboardShell"
import { TogglPanel } from "@/components/toggl/TogglPanel"
import { AutoSync } from "@/components/layout/AutoSync"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/signin")

  return (
    <>
      <DashboardShell>{children}</DashboardShell>
      <TogglPanel />
      <AutoSync />
    </>
  )
}
