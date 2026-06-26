import type { Metadata } from "next"
export const metadata: Metadata = { title: "Settings" }

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent } from "@/components/ui/card"
import { FitKeyManager } from "@/components/settings/FitKeyManager"
import { OuraManager } from "@/components/settings/OuraManager"
import { HealthConnectManager } from "@/components/settings/HealthConnectManager"
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
import { getUserPlan } from "@/lib/plan"
import { isStripeConfigured } from "@/lib/stripe"
import Link from "next/link"

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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? ""
  const plan = await getUserPlan(userId)
  const stripeReady = isStripeConfigured()

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
        <p className="text-muted-foreground text-sm mt-0.5">Manage integrations and API access</p>
      </div>

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
            <p className="text-sm font-medium text-yellow-400">Database migration needed</p>
            <p className="text-xs text-muted-foreground">
              The MCP tables haven&apos;t been created in your database yet. Run the SQL migration in your Neon dashboard, then reload this page.
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

      {/* Plan & subscription */}
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
            ) : (
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

      {/* Theme */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-5">
          <ThemeSwitcher />
          <div className="border-t border-border/50" />
          <ZoomControl />
          <div className="border-t border-border/50" />
          <LayoutModeControl />
        </CardContent>
      </Card>

      {/* Passkeys / biometric login */}
      <PasskeyManager />

      {/* Push notifications */}
      <PushNotifications />

      {/* Android home screen widget */}
      <WidgetSetupCapacitor />

      <TimezoneDetector />
      <WeatherLocation />

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

      {/* DB migration */}
      <MigrateButton />

      {/* Oura Ring connection (client component) */}
      <OuraManager isConnected={isOuraConnected} hasOauthConfig={!!(process.env.OURA_CLIENT_ID && process.env.OURA_CLIENT_SECRET)} />

      {/* Health Connect — Android only, syncs from Garmin/Fitbit/Samsung/etc */}
      <HealthConnectManager lastSync={hcLastSync} />

      {/* Samsung Health — one-time CSV import for historical data */}
      <SamsungHealthImporter />

      {/* Google Timeline — location visit history for health correlations */}
      <TimelineImporter />

      {/* CSV import */}
      <CsvImport />

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

      {/* Strava */}
      <StravaManager isConnected={isStravaConnected} />

      {/* GitHub */}
      <GitHubManager username={githubUsername} />

      {/* RescueTime */}
      <RescuetimeManager hasKey={hasRescuetimeKey} />

      {/* Last.fm */}
      <LastfmManager />

      {/* Personal goals */}
      <GoalsEditor />

      {/* Key manager (client component) */}
      <FitKeyManager initialKeys={keyRows} />

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
            <div className="rounded-lg bg-secondary/50 px-3 py-2 font-mono text-[11px] break-all select-all">
              {appUrl}/api/location/track?token={keys[0].token}
            </div>
            <p className="text-[10px] text-muted-foreground/60">
              Set update interval to 60–300 s. Your path appears on the dashboard Location card automatically.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Feedback inbox */}
      <FeedbackInbox />

      {/* Data: digest + export */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Data</p>
          <DigestPreferences />
          <div className="border-t border-border/50" />
          <DigestSchedule />
          <div className="border-t border-border/50" />
          <DigestButton />
          <div className="border-t border-border/50" />
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

      {/* Help & Support */}
      <HelpCard />

      {/* Danger zone */}
      <DeleteAccount />

      <p className="text-center text-[11px] text-muted-foreground/40 pb-2">
        Emergenthealth v1.10.0 · Built with ♥
      </p>
    </div>
  )
}
