import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FitKeyManager } from "@/components/settings/FitKeyManager"
import { Activity, CheckCircle, XCircle, ExternalLink } from "lucide-react"
import Link from "next/link"

export default async function SettingsPage() {
  const session = await auth()
  const userId = session!.user.id

  // Tables may not exist yet if migration hasn't run — fail gracefully
  let fitToken = null
  let keys: { id: string; name: string; token: string; createdAt: Date }[] = []
  let dbMissing = false
  try {
    ;[fitToken, keys] = await Promise.all([
      prisma.fitToken.findUnique({ where: { userId }, select: { updatedAt: true, scope: true } }),
      prisma.mcpApiKey.findMany({
        where: { userId },
        select: { id: true, name: true, token: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ])
  } catch {
    dbMissing = true
  }

  const isConnected = !!fitToken
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

      {/* Google Fit connection */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-medium flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Google Fit
            </CardTitle>
            {isConnected ? (
              <Badge className="bg-green-500/15 text-green-400 border-green-500/30 gap-1">
                <CheckCircle className="h-3 w-3" /> Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                <XCircle className="h-3 w-3" /> Not connected
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isConnected ? (
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Your Google Fit account is linked. Claude can read your health data via the MCP server.
              </p>
              <p className="text-xs text-muted-foreground">
                Last updated: {fitToken?.updatedAt.toLocaleDateString()}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Connect your Google Fit account so Claude can access your health data (steps, sleep, heart rate, etc.).
            </p>
          )}
          <Button asChild size="sm" variant={isConnected ? "outline" : "default"}>
            <Link href="/api/mcp/fit-auth">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
              {isConnected ? "Reconnect Google Fit" : "Connect Google Fit"}
            </Link>
          </Button>
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

      {/* Key manager (client component) */}
      <FitKeyManager initialKeys={keyRows} />
    </div>
  )
}
