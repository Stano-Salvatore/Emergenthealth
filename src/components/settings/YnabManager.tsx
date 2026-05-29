"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle, Unlink, RefreshCw, LogIn } from "lucide-react"

type State = "loading" | "disconnected" | "connected" | "syncing"

export function YnabManager({ hasOauthConfig }: { hasOauthConfig: boolean }) {
  const [state, setState]           = useState<State>("loading")
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

  function connect() {
    window.location.href = "/api/ynab/auth"
  }

  async function disconnect() {
    await fetch("/api/ynab/connect", { method: "DELETE" })
    setBudgetName(null)
    setState("disconnected")
    setSyncMsg(null)
    setError(null)
  }

  async function sync() {
    setState("syncing")
    setSyncMsg(null)
    setError(null)
    const res = await fetch("/api/sync/ynab", { method: "POST" })
    const d = await res.json()
    if (res.status === 401) {
      setState("disconnected")
      setError(d.error ?? "Token expired — please reconnect")
    } else {
      setState("connected")
      if (d.success) setSyncMsg(`Synced ${d.synced} transactions`)
      else setError(d.error ?? "Sync failed")
    }
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
              <Button
                size="sm"
                variant="ghost"
                onClick={disconnect}
                className="gap-1.5 text-muted-foreground hover:text-destructive"
              >
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

        {state === "disconnected" && (
          hasOauthConfig ? (
            <Button size="sm" onClick={connect} className="w-full gap-1.5">
              <LogIn className="h-3.5 w-3.5" />
              Connect with YNAB
            </Button>
          ) : (
            <p className="text-xs text-amber-400 bg-amber-500/10 rounded-md px-3 py-2">
              Set <code className="font-mono">YNAB_CLIENT_ID</code> and{" "}
              <code className="font-mono">YNAB_CLIENT_SECRET</code> in your Vercel environment variables.
            </p>
          )
        )}

        {error && <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">{error}</p>}
        {syncMsg && <p className="text-xs text-green-400 bg-green-500/10 rounded-md px-3 py-2">{syncMsg}</p>}
      </CardContent>
    </Card>
  )
}
