import type { Metadata } from "next"
export const metadata: Metadata = { title: "Settings" }

import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent } from "@/components/ui/card"
import { FitKeyManager } from "@/components/settings/FitKeyManager"
import { OuraManager } from "@/components/settings/OuraManager"
import { MigrateButton } from "@/components/settings/MigrateButton"
import { GoalsEditor } from "@/components/settings/GoalsEditor"
import { ThemeSwitcher } from "@/components/ui/ThemeSwitcher"
import { YnabManager } from "@/components/settings/YnabManager"
import { TruelayerManager } from "@/components/settings/TruelayerManager"
import { SaltedgeManager } from "@/components/settings/SaltedgeManager"
import { GocardlessManager } from "@/components/settings/GocardlessManager"
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
import { TimezoneDetector } from "@/components/settings/TimezoneDetector"
import { WeatherLocation } from "@/components/settings/WeatherLocation"
import { PasskeyManager } from "@/components/settings/PasskeyManager"
import { ManageBillingButton } from "@/components/settings/ManageBillingButton"
import { getUserPlan } from "@/lib/plan"
import { isStripeConfigured } from "@/lib/stripe"
import Link from "next/link"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    oura_connected?: string
    oura_error?: string
    ynab_connected?: string
    ynab_error?: string
    ynab_reason?: string
    strava_connected?: string
    strava_error?: string
    tl_connected?: string
    tl_error?: string
    tl_reason?: string
    se_connected?: string
    se_error?: string
    se_reason?: string
    gc_connected?: string
    gc_error?: string
    gc_reason?: string
    upgraded?: string
  }>
}) {
  const session = await auth()
  if (!session?.user?.id) return null
  const userId = session.user.id
  const params = await searchParams
  const ouraConnected = params.oura_connected === "1"
  const ouraError = params.oura_error
  const ynabConnected = params.ynab_connected === "1"
  const ynabError = params.ynab_error
  const ynabReason = params.ynab_reason
  const stravaConnected = params.strava_connected === "1"
  const stravaError = params.strava_error
  const tlConnected = params.tl_connected === "1"
  const tlError = params.tl_error
  const tlReason = params.tl_reason
  const seConnected = params.se_connected === "1"
  const seError = params.se_error
  const seReason = params.se_reason
  const gcConnected = params.gc_connected === "1"
  const gcError = params.gc_error
  const gcReason = params.gc_reason
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? ""
  const plan = await getUserPlan(userId)
  const stripeReady = isStripeConfigured()

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
                {plan === "pro"
                  ? "You have access to all Pro features."
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

      {/* Theme */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <ThemeSwitcher />
        </CardContent>
      </Card>

      {/* Passkeys / biometric login */}
      <PasskeyManager />

      {/* Push notifications */}
      <PushNotifications />
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

      {ynabConnected && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-green-400">YNAB connected successfully!</p>
            <p className="text-xs text-muted-foreground mt-0.5">Your budget is now syncing. Hit "Sync now" to pull your latest transactions.</p>
          </CardContent>
        </Card>
      )}

      {ynabError && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-red-400">YNAB connection failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {ynabError === "token_error"
                ? "YNAB rejected the authorisation code — the redirect URI in your YNAB app settings may not match. Expected: " + (process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? "") + "/api/ynab/callback"
                : ynabError === "db_error"
                  ? "Tokens were received but could not be saved. Please try again."
                  : ynabError === "state_invalid"
                    ? "The sign-in state expired or was tampered with. Please try connecting again."
                    : ynabError === "missing_code"
                      ? "YNAB did not return an authorisation code. Please try again."
                      : `Error: ${ynabError}. Please try again.`}
            </p>
            {ynabReason && (
              <p className="text-[11px] text-muted-foreground/60 mt-1 font-mono break-all">{ynabReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* YNAB */}
      <YnabManager hasOauthConfig={!!(process.env.YNAB_CLIENT_ID && process.env.YNAB_CLIENT_SECRET)} />

      {tlConnected && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-green-400">Bank connected successfully!</p>
            <p className="text-xs text-muted-foreground mt-0.5">Choose your account below, then hit "Sync now" to pull transactions.</p>
          </CardContent>
        </Card>
      )}

      {tlError && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-red-400">Bank connection failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {tlError === "token_error"
                ? "TrueLayer rejected the authorisation code — check the redirect URI in your TrueLayer console."
                : tlError === "state_invalid"
                  ? "The sign-in state expired. Please try connecting again."
                  : tlError === "missing_code"
                    ? "TrueLayer did not return an authorisation code. Please try again."
                    : `Error: ${tlError}. Please try again.`}
            </p>
            {tlReason && (
              <p className="text-[11px] text-muted-foreground/60 mt-1 font-mono break-all">{tlReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* TrueLayer / Revolut */}
      <TruelayerManager />

      {seConnected && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-green-400">Bank connected via Salt Edge!</p>
            <p className="text-xs text-muted-foreground mt-0.5">Choose your account below, then hit "Sync now" to pull transactions.</p>
          </CardContent>
        </Card>
      )}

      {seError && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-red-400">Salt Edge connection failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {seError === "state_invalid"
                ? "The sign-in state expired. Please try connecting again."
                : seError === "missing_connection"
                  ? "Salt Edge did not return a connection ID. Please try again."
                  : seError === "session_error"
                    ? "Could not create a Salt Edge session — check your SALTEDGE_APP_ID and SALTEDGE_SECRET."
                    : `Error: ${seError}. Please try again.`}
            </p>
            {seReason && (
              <p className="text-[11px] text-muted-foreground/60 mt-1 font-mono break-all">{seReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Salt Edge bank connection */}
      <SaltedgeManager />

      {gcConnected && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-green-400">Bank connected via GoCardless!</p>
            <p className="text-xs text-muted-foreground mt-0.5">Choose your account below, then hit "Sync now" to pull transactions.</p>
          </CardContent>
        </Card>
      )}

      {gcError && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm font-medium text-red-400">GoCardless connection failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {gcError === "state_invalid"
                ? "The sign-in state expired. Please try connecting again."
                : gcError === "missing_ref"
                  ? "GoCardless did not return a requisition ID. Please try again."
                  : gcError === "requisition_error"
                    ? "Could not create a GoCardless requisition — check your GOCARDLESS_SECRET_ID and GOCARDLESS_SECRET_KEY."
                    : `Error: ${gcError}. Please try again.`}
            </p>
            {gcReason && (
              <p className="text-[11px] text-muted-foreground/60 mt-1 font-mono break-all">{gcReason}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* GoCardless bank connection */}
      <GocardlessManager />

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
            <ExportButton />
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <DeleteAccount />
    </div>
  )
}
