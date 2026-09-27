"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Copy, Plus, Trash2, Check } from "lucide-react"
import { copyText } from "@/lib/utils"
import { describeFetchFailure, HttpStatusError } from "@/lib/fetch-error"

type KeyRow = {
  id: string
  name: string
  tokenPreview: string
  createdAt: string
}

export function FitKeyManager({ initialKeys }: { initialKeys: KeyRow[] }) {
  const [keys, setKeys] = useState<KeyRow[]>(initialKeys)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [newName, setNewName] = useState("My device")
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createKey() {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/mcp/key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName || "My device" }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || typeof data?.token !== "string") {
        setError(`No key created. ${describeFetchFailure(new HttpStatusError(res.ok ? 500 : res.status))}`)
        return
      }
      const token: string = data.token
      setNewToken(token)
      setKeys((prev) => [
        { id: data.id, name: data.name, tokenPreview: `${token.slice(0, 8)}...${token.slice(-4)}`, createdAt: data.createdAt },
        ...prev,
      ])
    } catch (e) {
      setError(`No key created. ${describeFetchFailure(e)}`)
    } finally {
      setCreating(false)
    }
  }

  // A key is revoked because it may have leaked, so the row leaves the list
  // only once the server has deleted it. On a 500 it used to vanish while the
  // Bearer token kept working against /api/mcp.
  async function revokeKey(id: string) {
    setError(null)
    try {
      const res = await fetch(`/api/mcp/key?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      if (!res.ok) {
        setError(`Not revoked — the key still works. ${describeFetchFailure(new HttpStatusError(res.status))}`)
        return
      }
      setKeys((prev) => prev.filter((k) => k.id !== id))
      if (newToken) setNewToken(null)
    } catch (e) {
      setError(`Not revoked — the key still works. ${describeFetchFailure(e)}`)
    }
  }

  async function copyToken() {
    // This used to say "Copied!" without waiting to find out — on a token the
    // user has one chance to save, and which is shown on screen to copy by hand
    // if this fails.
    if (!newToken) return
    if (!await copyText(newToken)) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">MCP API Keys</CardTitle>
        <p className="text-xs text-muted-foreground mt-0.5">
          Use a key as a Bearer token to connect Claude Code or Claude.ai mobile to your health data.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create new key */}
        <div className="flex gap-2">
          <Input
            className="h-8 text-sm"
            placeholder="Key name (e.g. iPhone, Claude Code)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button size="sm" onClick={createKey} disabled={creating} className="shrink-0">
            <Plus className="h-3.5 w-3.5 mr-1" />
            {creating ? "Creating…" : "New key"}
          </Button>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

        {/* Newly created token — shown once */}
        {newToken && (
          <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 space-y-2">
            <p className="text-xs font-medium text-green-400">Key created — copy it now, it won&apos;t be shown again</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-secondary rounded px-2 py-1.5 break-all font-mono">{newToken}</code>
              <Button size="sm" variant="outline" onClick={copyToken} className="shrink-0 h-7 px-2">
                {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Claude Code: add to <code className="bg-secondary px-1 rounded">~/.claude/claude.json</code> under mcpServers<br />
              Claude.ai mobile: Settings → MCP Servers → add URL + this Bearer token
            </p>
          </div>
        )}

        {/* Key list */}
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No keys yet.</p>
        ) : (
          <div className="divide-y rounded-lg border overflow-hidden">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between px-3 py-2.5 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{k.name}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{k.tokenPreview}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="secondary" className="text-[10px] hidden sm:inline-flex">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Revoke key"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => revokeKey(k.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
