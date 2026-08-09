import type { Metadata } from "next"
export const metadata: Metadata = { title: "Settings" }

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent } from "@/components/ui/card"
import { FitKeyManager } from "@/components/settings/FitKeyManager"
import { OuraManager } from "@/components/settings/OuraManager"
import { HealthConnectManager } from "@/components/settings/HealthConnectManager"
import { DeviceCalendarManager } from "@/components/settings/DeviceCalendarManager"
import { DeviceCalendarColors } from "@/components/settings/DeviceCalendarColors"
import { ScreenTimeManager } from "@/components/settings/ScreenTimeManager"
import { NotificationNudges } from "@/components/settings/NotificationNudges"
import { MorningBriefToggle } from "@/components/settings/MorningBriefToggle"
import { SamsungHealthImporter } from "@/components/settings/SamsungHealthImporter"
import { TimelineImporter } from "@/components/settings/TimelineImporter"
import { MigrateButton } from "@/components/settings/MigrateButton"
import { GoalsEditor } from "@/components/settings/GoalsEditor"
import { ThemeSwitcher } from "@/components/ui/ThemeSwitcher"
import { ZoomControl } from "@/components/settings/ZoomControl"
import { LayoutModeControl } from "@/components/settings/LayoutModeControl"
import { CsvImport } from "@/components/settings/CsvImport"
import { ExportButton } from "@/components/settings/ExportButton"
import { DigestButton } from "@/components/settings/DigestButton"
import { DigestPreferences } from "@/components/settings/DigestPreferences"
import { DigestSchedule } from "@/components/settings/DigestSchedule"
import { StravaManager } from "@/components/settings/StravaManager"
import { GitHubManager } from "@/components/settings/GitHubManager"
import { RescuetimeManager } from "@/components/settings/RescuetimeManager"
import { LastfmManager } from "@/components/settings/LastfmManager"
import { FeedbackInbox } from "@/components/settings/FeedbackInbox"
import { WidgetSetup } from "@/components/settings/WidgetSetup"
import { DeleteAccount } from "@/components/settings/DeleteAccount"
import { PushNotifications } from "@/components/settings/PushNotifications"
import { WidgetSetupCapacitor } from "@/components/settings/WidgetSetupCapacitor"
import { TimezoneDetector } from "@/components/settings/TimezoneDetector"
import { WeatherLocation } from "@/components/settings/WeatherLocation"
import { PasskeyManager } from "@/components/settings/PasskeyManager"
import { ManageBillingButton } from "@/components/settings/ManageBillingButton"
import { HelpCard } from "@/components/settings/HelpCard"
import { InviteCard } from "@/components/settings/InviteCard"
import { SettingsSection } from "@/components/settings/SettingsSection"
import { SignOutCard } from "@/components/settings/SignOutCard"
import { SecretUrl } from "@/components/settings/SecretUrl"
import { APP_VERSION } from "@/lib/version"
import { getUserPlan } from "@/lib/plan"
import { isStripeConfigured } from "@/lib/stripe"
import Link from "next/link"
import { headers } from "next/headers"
import { isFeatureEnabled } from "@/lib/features"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    oura_connected?: string
    oura_error?: string
    strava_connected?: string
    strava_error?: string
    upgraded?: string
  }>
}) {
  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id
  const params = await searchParams
  const ouraConnected = params.oura_connected === "1"
  const ouraError = params.oura_error
  const stravaConnected = params.strava_connected === "1"
  const stravaError = params.strava_error
  const upgraded = params.upgraded === "1"

  // Tables may not exist yet if migration hasn't run — fail gracefully
  let ouraToken = null
  let keys: { id: string; name: string; token: string; createdAt: Date }[] = []
  let dbMissing = false
  try {
    ;[ouraToken, keys] = await Promise.all([
      prisma.ouraToken.findUnique({ where: { userId }, select: { updatedAt: true, scope: true } }),
      prisma.mcpApiKey.findMany({
        where: { userId },
        select: { id: true, name: true, token: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ])
  } catch {
    dbMissing = true
  }

  // Strava token check — table may not exist yet
  const stravaTokenRows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "StravaToken" WHERE "userId" = ${userId} LIMIT 1
  `.catch(() => [] as { userId: string }[])
  const isStravaConnected = stravaTokenRows.length > 0

  // GitHub profile check — table may not exist yet
  const githubRows = await prisma.$queryRaw<{ username: string }[]>`
    SELECT "username" FROM "GitHubProfile" WHERE "userId" = ${userId} LIMIT 1
  `.catch(() => [] as { username: string }[])
  const githubUsername = githubRows[0]?.username ?? null

  const rescuetimeRows = await prisma.$queryRaw<{ userId: string }[]>`
    SELECT "userId" FROM "RescuetimeKey" WHERE "userId" = ${userId} LIMIT 1
  `.catch(() => [] as { userId: string }[])
  const hasRescuetimeKey = rescuetimeRows.length > 0

  const lastfmRows = await prisma.$queryRaw<{ username: string }[]>`
    SELECT "username" FROM "LastfmKey" WHERE "userId" = ${userId} LIMIT 1
  `.catch(() => [] as { username: string }[])
  const lastfmUsername = lastfmRows[0]?.username ?? null

  const isOuraConnected = !!ouraToken

  // Health Connect last sync
  const hcSyncRows = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "health_connect_last_sync" } },
    select: { value: true },
  }).catch(() => null)
  const hcLastSync = hcSyncRows?.value ?? null

  // Device calendar (Samsung / local) last sync
  const deviceCalSyncRows = await prisma.userPreference.findUnique({
    where: { userId_key: { userId, key: "device_calendar_last_sync" } },
    select: { value: true },
  }).catch(() => null)
  const deviceCalLastSync = deviceCalSyncRows?.value ?? null
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? ""
  const plan = await getUserPlan(userId)
  // Google Play billing policy: no external purchase links inside the Android app
  const ua = (await headers()).get("user-agent") ?? ""
  const isCapacitorApp = ua.includes("Emergenthealth-Capacitor")
  const stripeReady = isStripeConfigured() && !isCapacitorApp
  // Owner-only tooling: the migrate endpoint 403s for everyone else, so showing
  // the button to normal users only ever produced a red error.
  const ownerEmail = process.env.FEEDBACK_NOTIFY_EMAIL ?? process.env.OWNER_EMAIL
  const isOwner = !!ownerEmail && session.user.email === ownerEmail

  const sub = await prisma.subscription.findUnique({
    where: { userId },
    select: { status: true, currentPeriodEnd: true, cancelAtPeriodEnd: true },
  }).catch(() => null)
  const isTrialing = sub?.status === "trialing"
  const trialDaysLeft = isTrialing && sub.currentPeriodEnd
    ? Math.max(0, Math.ceil((sub.currentPeriodEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null

  const keyRows = keys.map((k) => ({
    id: k.id,
    name: k.name,
    tokenPreview: `${k.token.slice(0, 8)}...${k.token.slice(-4)}`,
    createdAt: k.createdAt.toISOString(),
  }))

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Your account, devices and preferences</p>
      </div>

      {/* ── Alerts (connection results & warnings) ── */}
      {upgraded && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-green-400">Welcome to Pro! 🎉</p>
            <p className="text-xs text-muted-foreground mt-0.5">Your subscription is active. All Pro features are now unlocked.</p>
          </CardContent>
        </Card>
      )}

      {dbMissing && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-4 pb-3 space-y-1">
            <p className="text-sm font-medium text-yellow-400">Some settings are unavailable</p>
            <p className="text-xs text-muted-foreground">
              {isOwner
                ? "The MCP tables haven't been created yet — run the migration below, then reload this page."
                : "We're finishing a maintenance update. Everything else works normally; please check back shortly."}
            </p>
          </CardContent>
        </Card>
      )}

      {ouraConnected && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-green-400">Oura Ring connected successfully!</p>
            <p className="text-xs text-muted-foreground mt-0.5">Your health data is now accessible via the MCP server. Generate an API key below to connect Claude.</p>
          </CardContent>
        </Card>
      )}

      {ouraError && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-red-400">Oura Ring connection failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ouraError === "invalid_grant"
                ? "The authorisation code expired or was already used. Please try connecting again."
                : ouraError === "db_error"
                  ? "Tokens were received but could not be saved. Run the OuraToken SQL migration in Neon, then try again."
                  : `Error: ${ouraError}. Please try again.`}
            </p>
          </CardContent>
        </Card>
      )}

      {stravaConnected && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-green-400">Strava connected successfully!</p>
            <p className="text-xs text-muted-foreground mt-0.5">Hit &quot;Sync now&quot; to pull your recent activities.</p>
          </CardContent>
        </Card>
      )}

      {stravaError && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-red-400">Strava connection failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {stravaError === "invalid_grant"
                ? "The authorisation code expired or was already used. Please try connecting again."
                : stravaError === "db_error"
                  ? "Tokens were received but could not be saved. Please try again."
                  : `Error: ${stravaError}. Please try again.`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ══ Account & plan ══ */}
      <SettingsSection title="Account & Plan" emoji="👤">
      <Card className={plan === "pro" ? "border-primary/30 bg-primary/5" : ""}>
        <CardContent className="pt-4 pb-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">
                  {plan === "pro" ? "Pro plan" : "Free plan"}
                </p>
                {plan === "pro" && (
                  <span className="rounded-full bg-primary/20 text-primary text-[10px] font-bold px-2 py-0.5 uppercase tracking-wide">
                    Pro
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isTrialing && trialDaysLeft !== null
                  ? trialDaysLeft > 0
                    ? `Free trial — ${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} remaining. Add payment to keep Pro.`
                    : "Trial ended. Add payment to keep Pro features."
                  : plan === "pro"
                  ? sub?.cancelAtPeriodEnd
                    ? `Cancels ${sub.currentPeriodEnd ? sub.currentPeriodEnd.toLocaleDateString() : "soon"}.`
                    : "You have access to all Pro features."
                  : "Upgrade to unlock unlimited history, daily AI insights, and more."}
              </p>
            </div>
            {plan === "pro" ? (
              stripeReady ? (
                <ManageBillingButton />
              ) : null
            ) : isCapacitorApp ? null : (
              <Link
                href="/pricing"
                className="shrink-0 rounded-lg bg-primary/15 text-primary text-xs font-semibold px-3 py-1.5 hover:bg-primary/25 transition-colors"
              >
                {stripeReady ? "Upgrade →" : "View plans →"}
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Invite friends */}
      <InviteCard />

      {/* Passkeys / biometric login */}
      <PasskeyManager />

      {/* Help & Support */}
      <HelpCard />

      {/* Sign out */}
      <SignOutCard email={session.user.email} />
      </SettingsSection>

      {/* ══ Appearance ══ */}
      <SettingsSection title="Appearance" emoji="🎨">
      <Card>
        <CardContent className="pt-4 pb-4 space-y-5">
          <ThemeSwitcher />
          <div className="border-t border-border/50" />
          <ZoomControl />
          <div className="border-t border-border/50" />
          <LayoutModeControl />
        </CardContent>
      </Card>
      </SettingsSection>

      {/* ══ Notifications ══ */}
      <SettingsSection title="Notifications" emoji="🔔">
      {/* Push notifications */}
      <PushNotifications />
      {/* Daily nudge notifications — Android only */}
      <NotificationNudges />
      <MorningBriefToggle />
      </SettingsSection>

      {/* ══ Connected apps & devices ══ */}
      <SettingsSection title="Connected apps & devices" emoji="🔗">
      {/* Oura Ring connection (client component) */}
      <OuraManager isConnected={isOuraConnected} hasOauthConfig={!!(process.env.OURA_CLIENT_ID && process.env.OURA_CLIENT_SECRET)} />
      {/* Health Connect — Android only, syncs from Garmin/Fitbit/Samsung/etc */}
      <HealthConnectManager lastSync={hcLastSync} />

      <DeviceCalendarManager lastSync={deviceCalLastSync} />

      <DeviceCalendarColors />
      {/* Screen Time — Android only, reads native UsageStats */}
      {isFeatureEnabled("screentime") && <ScreenTimeManager />}
      {/* Strava */}
      {isFeatureEnabled("strava") && <StravaManager isConnected={isStravaConnected} />}
      {/* GitHub */}
      <GitHubManager username={githubUsername} />
      {/* RescueTime */}
      {isFeatureEnabled("rescuetime") && <RescuetimeManager hasKey={hasRescuetimeKey} />}
      {/* Last.fm */}
      {isFeatureEnabled("lastfm") && <LastfmManager />}
      </SettingsSection>

      {/* ══ Widgets & location ══ */}
      <SettingsSection title="Widgets & Location" emoji="📱">
      {/* Android home screen widget */}
      <WidgetSetupCapacitor />
      {/* Home screen & lock screen widgets */}
      <WidgetSetup appUrl={appUrl} apiKey={keys[0]?.token} />
      {/* OwnTracks live location */}
      {keys[0]?.token && (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">OwnTracks · Live Location</p>
            <p className="text-xs text-muted-foreground">
              Open OwnTracks → Preferences → Connection → Mode: <strong>HTTP</strong>. Paste the URL below.
            </p>
            <SecretUrl
              url={`${appUrl}/api/location/track?token=${keys[0].token}`}
              secret={keys[0].token}
              label="contains your API key"
            />
            <p className="text-[10px] text-muted-foreground/60">
              Set update interval to 60–300 s. Your path appears on the dashboard Location card automatically.
            </p>
          </CardContent>
        </Card>
      )}
      <TimezoneDetector />
      <WeatherLocation />
      </SettingsSection>

      {/* ══ Goals & reports ══ */}
      <SettingsSection title="Goals & reports" emoji="🎯">
      {/* Personal goals */}
      <GoalsEditor />

      <Card>
        <CardContent className="pt-4 pb-4 space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Daily digest</p>
          <DigestPreferences />
          <div className="border-t border-border/50" />
          <DigestSchedule />
          <div className="border-t border-border/50" />
          <DigestButton />
        </CardContent>
      </Card>
      </SettingsSection>

      {/* ══ Import & export ══ */}
      <SettingsSection title="Import & export" emoji="💾">
      {/* Samsung Health — one-time CSV import for historical data */}
      <SamsungHealthImporter />
      {/* Google Timeline — location visit history for health correlations */}
      <TimelineImporter />
      {/* CSV import */}
      <CsvImport />

      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Export CSV</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last 90 days of health data as a CSV file.
              </p>
            </div>
            <ExportButton isPro={plan === "pro"} />
          </div>
        </CardContent>
      </Card>
      </SettingsSection>

      {/* ══ Developer ══ Power-user tooling: API keys for the MCP server and
          home-screen widgets. Kept last and collapsed — nobody needs it to use
          the app. */}
      <SettingsSection title="Developer" emoji="🧪">
      {/* Key manager (client component) */}
      <FitKeyManager initialKeys={keyRows} />

      {/* MCP server info */}
      <Card className="border-dashed">
        <CardContent className="pt-4 pb-3 space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">MCP Server URL</p>
          <code className="block text-xs bg-secondary rounded px-3 py-2 break-all">
            {appUrl}/api/mcp
          </code>
          <p className="text-[11px] text-muted-foreground">
            Add this URL + a Bearer token to Claude Code or Claude.ai mobile → Settings → MCP Servers.
          </p>
        </CardContent>
      </Card>

      {/* Feedback inbox */}
      <FeedbackInbox />

      {/* DB migration — owner only; the endpoint 403s for everyone else */}
      {isOwner && <MigrateButton />}
      </SettingsSection>

      {/* ══ Danger zone ══ */}
      <SettingsSection title="Danger Zone" emoji="⚠️" defaultOpen={false}>
      <DeleteAccount />
      </SettingsSection>

      <p className="text-center text-[11px] text-muted-foreground/40 pb-2">
        Emergenthealth v{APP_VERSION} · Built with ♥
      </p>
    </div>
  )
}
