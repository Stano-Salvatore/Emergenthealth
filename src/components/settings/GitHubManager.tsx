"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, LogOut, Check } from "lucide-react"

export function GitHubManager({ username: initialUsername }: { username: string | null }) {
  const [username, setUsername] = useState(initialUsername ?? "")
  const [pat, setPat] = useState("")
  const [saving, setSaving] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState("")
  const isConnected = !!initialUsername

  async function handleSave() {
    if (!username.trim()) return
    setSaving(true)
    setError("")
    setSaved(false)
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), accessToken: pat.trim() || null }),
      })
      if (res.ok) { setSaved(true); setTimeout(() => window.location.reload(), 800) }
      else setError("Failed to save")
    } catch { setError("Network error") }
    finally { setSaving(false) }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      const res = await fetch("/api/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "" }),
      })
      if (res.ok) window.location.reload()
    } catch { setDisconnecting(false) }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">GitHub</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Track your coding streak and commit activity — no OAuth required.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          {isConnected
            ? <Badge variant="default" className="bg-green-600">Connected · @{initialUsername}</Badge>
            : <Badge variant="secondary">Not connected</Badge>}
        </div>

        <div className="space-y-2">
          <Input
            placeholder="GitHub username (e.g. torvalds)"
            value={username}
            onChange={e => setUsername(e.target.value)}
          />
          <Input
            placeholder="Personal access token (optional — for private repos)"
            type="password"
            value={pat}
            onChange={e => setPat(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground">
            Without a token, only public activity is visible (60 req/hr limit). Create a token at github.com/settings/tokens with <code>read:user</code> scope.
          </p>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={!username.trim() || saving} className="flex-1">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
            <span className="ml-1">{saved ? "Saved!" : "Save"}</span>
          </Button>
          {isConnected && (
            <Button size="sm" variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
              {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
