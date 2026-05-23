import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Sidebar } from "@/components/layout/Sidebar"
import { TogglPanel } from "@/components/toggl/TogglPanel"
import { AutoSync } from "@/components/layout/AutoSync"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/signin")

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        {children}
      </main>
      <TogglPanel />
      <AutoSync />
    </div>
  )
}
