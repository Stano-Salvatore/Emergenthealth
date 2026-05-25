"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle, Unlink, RefreshCw } from "lucide-react"

type State = "loading" | "disconnected" | "connecting" | "connected" | "syncing" | "error"

export function YnabManager() {
  const [state, setState]           = useState<State>("loading")
  const [token, setToken]           = useState("")
  const [budgetName, setBudgetName] = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [syncMsg, setSyncMsg]       = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/ynab/connect")
      .then(r => r.json())
      .then(d => {
        if (d.connected) { setBudgetName(d.budgetName); setState("connected") }
        else setState("disconnected")
      })
      .catch(() => setState("disconnected"))
  }, [])

  async function connect() {
    if (!token.trim()) return
    setState("connecting")
    setError(null)
    const res = await fetch("/api/ynab/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: token.trim() }),
    })
    const d = await res.json()
    if (d.ok) { setBudgetName(d.budgetName); setState("connected"); setSyncMsg(null) }
    else { setError(d.error ?? "Connection failed"); setState("disconnected") }
  }

  async function disconnect() {
    await fetch("/api/ynab/connect", { method: "DELETE" })
    setBudgetName(null); setToken(""); setState("disconnected"); setSyncMsg(null)
  }

  async function sync() {
    setState("syncing")
    setSyncMsg(null)
    const res = await fetch("/api/sync/ynab", { method: "POST" })
    const d = await res.json()
    setState("connected")
    if (d.success) setSyncMsg(`Synced ${d.synced} transactions`)
    else { setError(d.error ?? "Sync failed") }
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium flex items-center gap-1.5">
              💰 YNAB
              {state === "connected" && <CheckCircle className="h-3.5 w-3.5 text-green-400" />}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {state === "connected"
                ? `Connected · ${budgetName}`
                : "Sync your YNAB budget (Revolut, etc.) into Finances."}
            </p>
          </div>

          {state === "loading" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}

          {state === "connected" && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={sync} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Sync now
              </Button>
              <Button size="sm" variant="ghost" onClick={disconnect} className="gap-1.5 text-muted-foreground hover:text-destructive">
                <Unlink className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {state === "syncing" && (
            <Button size="sm" variant="outline" disabled className="gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Syncing…
            </Button>
          )}
        </div>

        {(state === "disconnected" || state === "connecting") && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Get your Personal Access Token from{" "}
              <a href="https://app.youneedabudget.com/settings/developer" target="_blank" rel="noopener noreferrer"
                className="underline hover:text-foreground">
                YNAB → Settings → Developer Settings
              </a>
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="Paste your YNAB token…"
                value={token}
                onChange={e => setToken(e.target.value)}
                onKeyDown={e => e.key === "Enter" && connect()}
                className="flex-1 h-8 px-3 text-sm rounded-lg border border-border bg-secondary/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 font-mono"
              />
              <Button size="sm" onClick={connect} disabled={state === "connecting" || !token.trim()} className="gap-1.5">
                {state === "connecting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Connect
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">{error}</p>}
        {syncMsg && <p className="text-xs text-green-400 bg-green-500/10 rounded-md px-3 py-2">{syncMsg}</p>}
      </CardContent>
    </Card>
  )
}
