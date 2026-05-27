"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, LogOut, RefreshCw } from "lucide-react"

interface LastfmLog {
  id: string
  date: string
  tracksPlayed: number
  listeningMin: number
  topArtist: string | null
  topTrack: string | null
}

export function LastfmManager() {
  const [hasKey, setHasKey] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [logs, setLogs] = useState<LastfmLog[]>([])
  const [loading, setLoading] = useState(true)

  const [apiKeyInput, setApiKeyInput] = useState("")
  const [usernameInput, setUsernameInput] = useState("")
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    fetch("/api/lastfm")
      .then(r => r.json())
      .then(data => {
        setHasKey(data.hasKey ?? false)
        setUsername(data.username ?? null)
        setLogs(data.logs ?? [])
      })
      .catch(() => null)
      .finally(() => setLoading(false))
  }, [])

  async function handleConnect() {
    if (!apiKeyInput.trim() || !usernameInput.trim()) return
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const res = await fetch("/api/lastfm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", apiKey: apiKeyInput.trim(), username: usernameInput.trim() }),
      })
      if (res.ok) {
        setSuccess("Connected!")
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
      const res = await fetch("/api/lastfm", {
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
      const res = await fetch("/api/lastfm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
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

  const weekTracks = logs
    .filter(l => {
      const d = new Date(l.date)
      return Date.now() - d.getTime() <= 7 * 86400000
    })
    .reduce((sum, l) => sum + l.tracksPlayed, 0)

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Last.fm</CardTitle>
        </CardHeader>
        <CardContent>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">Last.fm</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Track your music listening and see how it correlates with mood.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {hasKey
            ? <Badge variant="default" className="bg-green-600">Connected · @{username}</Badge>
            : <Badge variant="secondary">Not connected</Badge>}
        </div>

        {!hasKey && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="API key"
                value={apiKeyInput}
                onChange={e => setApiKeyInput(e.target.value)}
              />
              <Input
                placeholder="Last.fm username"
                value={usernameInput}
                onChange={e => setUsernameInput(e.target.value)}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Get your API key at last.fm/api/account/create
            </p>
          </div>
        )}

        {hasKey && logs.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {weekTracks} tracks this week
          </p>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
        {success && <p className="text-xs text-green-400">{success}</p>}

        <div className="flex gap-2">
          {!hasKey && (
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={!apiKeyInput.trim() || !usernameInput.trim() || saving}
              className="flex-1"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Connect
            </Button>
          )}
          {hasKey && (
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
