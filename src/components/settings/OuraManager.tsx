"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, LogOut, LogIn, Key, RefreshCw } from "lucide-react"

export function OuraManager({ isConnected, hasOauthConfig = false }: { isConnected: boolean; hasOauthConfig?: boolean }) {
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ synced: number; tagsSynced: number; tagsError?: string } | null>(null)
  const [pat, setPat] = useState("")
  const [patStatus, setPatStatus] = useState<"idle" | "loading" | "error">("idle")
  const [patError, setPatError] = useState("")

  async function handleConnect() {
    setConnecting(true)
    window.location.href = "/api/oura/auth"
  }

  async function handleSyncNow() {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch("/api/sync/oura", { method: "POST" })
      const data = await res.json()
      if (res.ok) setSyncResult({ synced: data.synced ?? 0, tagsSynced: data.tagsSynced ?? 0, tagsError: data.tagsError })
      else setSyncResult({ synced: 0, tagsSynced: 0, tagsError: data.error ?? "Sync failed" })
    } catch {
      setSyncResult({ synced: 0, tagsSynced: 0, tagsError: "Network error" })
    } finally {
      setSyncing(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      const res = await fetch("/api/oura/disconnect", { method: "POST" })
      if (res.ok) window.location.reload()
    } catch {
      setDisconnecting(false)
    }
  }

  async function handlePat() {
    if (!pat.trim()) return
    setPatStatus("loading")
    setPatError("")
    try {
      const res = await fetch("/api/oura/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pat.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPatStatus("error")
        setPatError(data.error ?? "Failed to save token")
      } else {
        window.location.reload()
      }
    } catch {
      setPatStatus("error")
      setPatError("Network error")
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Oura Ring Connection</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Connect your Oura Ring to sync sleep, activity, and health data.
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
            {isConnected ? "Your Oura Ring data is ready to sync" : "Connect to start syncing"}
          </p>
        </div>

        {isConnected ? (
          <div className="space-y-2">
            <Button size="sm" variant="outline" onClick={handleSyncNow} disabled={syncing} className="w-full">
              {syncing ? (
                <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Syncing…</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5 mr-2" />Sync now</>
              )}
            </Button>
            {syncResult && (
              syncResult.tagsError ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-1.5">
                  <p className="text-xs text-amber-400">
                    Health data synced ({syncResult.synced} days) but <span className="font-semibold">tags failed</span>: {syncResult.tagsError}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Your coffee/meds/drinks are logged as Oura tags — if this keeps failing, disconnect and reconnect Oura below so the <code>tag</code> permission is granted.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-green-400">
                  ✓ Synced {syncResult.synced} days · {syncResult.tagsSynced} tags
                  {syncResult.tagsSynced === 0 && <span className="text-muted-foreground"> (no tags in the last 30 days — log coffee/meds in the Oura app and they'll appear here)</span>}
                </p>
              )
            )}
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
                <><LogOut className="h-3.5 w-3.5 mr-2" />Disconnect Oura Ring</>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* OAuth option — only shown when client credentials are configured */}
            {hasOauthConfig && (
              <>
                <Button onClick={handleConnect} disabled={connecting} className="w-full" size="sm">
                  {connecting ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Connecting…</>
                  ) : (
                    <><LogIn className="h-3.5 w-3.5 mr-2" />Connect via OAuth</>
                  )}
                </Button>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              </>
            )}

            {/* Personal Access Token option */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Key className="h-3 w-3" />
                Personal Access Token
                <span className="text-muted-foreground/60">— get yours at cloud.ouraring.com/personal-access-tokens</span>
              </p>
              <div className="flex gap-2">
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="Paste your PAT here"
                  value={pat}
                  onChange={e => setPat(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handlePat()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handlePat}
                  disabled={patStatus === "loading" || !pat.trim()}
                  className="shrink-0 h-8"
                >
                  {patStatus === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                </Button>
              </div>
              {patError && <p className="text-xs text-red-400">{patError}</p>}
            </div>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          By connecting, you authorize emergenthealth to access your Oura Ring data including sleep, activity, heart rate, and readiness scores.
        </p>
      </CardContent>
    </Card>
  )
}
