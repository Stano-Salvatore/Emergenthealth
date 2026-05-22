import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent } from "@/components/ui/card"
import { FitKeyManager } from "@/components/settings/FitKeyManager"
import { OuraManager } from "@/components/settings/OuraManager"
import { MigrateButton } from "@/components/settings/MigrateButton"
import { GoalsEditor } from "@/components/settings/GoalsEditor"
import { ThemeSwitcher } from "@/components/ui/ThemeSwitcher"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ oura_connected?: string; oura_error?: string }>
}) {
  const session = await auth()
  const userId = session!.user.id
  const params = await searchParams
  const ouraConnected = params.oura_connected === "1"
  const ouraError = params.oura_error

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

  const isOuraConnected = !!ouraToken
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.AUTH_URL ?? ""

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

      {/* Theme */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <ThemeSwitcher />
        </CardContent>
      </Card>

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

      {/* Personal goals */}
      <GoalsEditor />

      {/* Key manager (client component) */}
      <FitKeyManager initialKeys={keyRows} />
    </div>
  )
}
