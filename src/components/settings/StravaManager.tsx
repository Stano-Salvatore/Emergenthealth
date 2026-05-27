"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, LogOut, LogIn, RefreshCw } from "lucide-react"

export function StravaManager({ isConnected }: { isConnected: boolean }) {
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<string | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  function handleConnect() {
    setConnecting(true)
    window.location.href = "/api/strava/auth"
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      const res = await fetch("/api/strava/disconnect", { method: "POST" })
      if (res.ok) window.location.reload()
    } catch {
      setDisconnecting(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncResult(null)
    setSyncError(null)
    try {
      const res = await fetch("/api/sync/strava", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setSyncError(data.error ?? "Sync failed")
      } else {
        setSyncResult(`Synced ${data.synced} activit${data.synced === 1 ? "y" : "ies"}`)
      }
    } catch {
      setSyncError("Network error")
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Strava Connection</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect Strava to sync your workouts, runs, rides, and other activities.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Badge variant="default" className="bg-green-600">Connected</Badge>
          ) : (
            <Badge variant="secondary">Not Connected</Badge>
          )}
          <p className="text-xs text-muted-foreground">
            {isConnected ? "Your Strava data is ready to sync" : "Connect to start syncing activities"}
          </p>
        </div>

        {isConnected ? (
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              className="w-full"
            >
              {syncing ? (
                <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Syncing…</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5 mr-2" />Sync now</>
              )}
            </Button>
            {syncResult && <p className="text-xs text-green-400">{syncResult}</p>}
            {syncError && <p className="text-xs text-red-400">{syncError}</p>}
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="w-full"
            >
              {disconnecting ? (
                <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Disconnecting…</>
              ) : (
                <><LogOut className="h-3.5 w-3.5 mr-2" />Disconnect Strava</>
              )}
            </Button>
          </div>
        ) : (
          <Button onClick={handleConnect} disabled={connecting} className="w-full" size="sm">
            {connecting ? (
              <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Connecting…</>
            ) : (
              <><LogIn className="h-3.5 w-3.5 mr-2" />Connect Strava</>
            )}
          </Button>
        )}

        <p className="text-[10px] text-muted-foreground">
          By connecting, you authorize emergenthealth to read your Strava activities including runs, rides, and other workout data.
        </p>
      </CardContent>
    </Card>
  )
}
