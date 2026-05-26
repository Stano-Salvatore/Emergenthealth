"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, LogOut, RefreshCw } from "lucide-react"

export function RescuetimeManager({ hasKey: initialHasKey }: { hasKey: boolean }) {
  const [apiKey, setApiKey] = useState("")
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  async function handleConnect() {
    if (!apiKey.trim()) return
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const res = await fetch("/api/rescuetime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save_key", apiKey: apiKey.trim() }),
      })
      if (res.ok) {
        setSuccess("API key saved!")
        setTimeout(() => window.location.reload(), 800)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Failed to save")
      }
    } catch {
      setError("Network error")
    } finally {
      setSaving(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setError("")
    setSuccess("")
    try {
      const res = await fetch("/api/rescuetime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSuccess(`Synced ${data.synced ?? 0} days`)
      } else {
        setError(data.error ?? "Sync failed")
      }
    } catch {
      setError("Network error")
    } finally {
      setSyncing(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    setError("")
    setSuccess("")
    try {
      const res = await fetch("/api/rescuetime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_key" }),
      })
      if (res.ok) {
        window.location.reload()
      } else {
        setError("Failed to disconnect")
        setDisconnecting(false)
      }
    } catch {
      setError("Network error")
      setDisconnecting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">RescueTime</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Track your screen time and productivity score.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {initialHasKey
            ? <Badge variant="default" className="bg-green-600">Connected</Badge>
            : <Badge variant="secondary">Not connected</Badge>}
        </div>

        {!initialHasKey && (
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="API key from rescuetime.com/anapi/manage_api_key"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Get your API key at rescuetime.com/anapi/manage_api_key
            </p>
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
        {success && <p className="text-xs text-green-400">{success}</p>}

        <div className="flex gap-2">
          {!initialHasKey && (
            <Button size="sm" onClick={handleConnect} disabled={!apiKey.trim() || saving} className="flex-1">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Connect
            </Button>
          )}
          {initialHasKey && (
            <>
              <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing} className="flex-1">
                {syncing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                Sync now
              </Button>
              <Button size="sm" variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <LogOut className="h-3.5 w-3.5" />}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
