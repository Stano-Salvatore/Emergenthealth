import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { DashboardShell } from "@/components/layout/DashboardShell"
import { EmergyPanel } from "@/components/emergy/EmergyPanel"
import { AutoSync } from "@/components/layout/AutoSync"
import { HealthConnectAutoSync } from "@/components/HealthConnectAutoSync"
import { DeviceCalendarAutoSync } from "@/components/DeviceCalendarAutoSync"
import { NativeBridge } from "@/components/NativeBridge"
import { NotificationsHealthBanner } from "@/components/NotificationsHealthBanner"
import { FeedbackButton } from "@/components/dashboard/FeedbackButton"
import { TimezoneSync } from "@/components/TimezoneSync"
import { WidgetAutoActivate } from "@/components/WidgetAutoActivate"
import { MorningBriefPopup } from "@/components/dashboard/MorningBriefPopup"
import { UpdateAvailableBanner } from "@/components/UpdateAvailableBanner"
import { ClientErrorReporter } from "@/components/layout/ClientErrorReporter"
import { needsOnboarding } from "@/lib/onboarding"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/signin")

  if (await needsOnboarding(session.user.id)) redirect("/onboarding")

  return (
    <>
      <DashboardShell>{children}</DashboardShell>
      <MorningBriefPopup name={session.user.name?.split(" ")[0] ?? "there"} />
      <EmergyPanel />
      <TimezoneSync />
      <AutoSync />
      <HealthConnectAutoSync />
      <DeviceCalendarAutoSync />
      <NativeBridge />
      <WidgetAutoActivate />
      <NotificationsHealthBanner />
      <UpdateAvailableBanner />
      {/* What the page itself throws on a phone, reported to the feedback
          inbox — the only trace a blank WebView leaves. */}
      <ClientErrorReporter />
      {/* The whole compose → /api/feedback → owner-notification pipeline
          existed but nothing rendered this button, so the only way to send
          feedback was the mailto link in Settings. */}
      <FeedbackButton />
    </>
  )
}
