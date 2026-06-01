"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, CheckCircle, Unlink, RefreshCw, LogIn } from "lucide-react"

type State = "loading" | "disconnected" | "connected" | "picking" | "syncing"

interface Budget { id: string; name: string }

export function YnabManager({ hasOauthConfig }: { hasOauthConfig: boolean }) {
  const [state, setState]           = useState<State>("loading")
  const [budgetName, setBudgetName] = useState<string | null>(null)
  const [budgets, setBudgets]       = useState<Budget[]>([])
  const [error, setError]           = useState<string | null>(null)
  const [syncMsg, setSyncMsg]       = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const d = await fetch("/api/ynab/connect").then(r => r.json())
        if (!d.connected) { setState("disconnected"); return }
        setBudgetName(d.budgetName)
        if (!d.budgetId) {
          setState("picking")
          const bd = await fetch("/api/ynab/budgets").then(r => r.json())
          setBudgets(bd.budgets ?? [])
        } else {
          setState("connected")
        }
      } catch {
        setState("disconnected")
      }
    })()
  }, [])

  function connect() { window.location.href = "/api/ynab/auth" }

  async function disconnect() {
    await fetch("/api/ynab/connect", { method: "DELETE" })
    setBudgetName(null)
    setBudgets([])
    setState("disconnected")
    setSyncMsg(null)
    setError(null)
  }

  async function selectBudget(b: Budget) {
    await fetch("/api/ynab/connect", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetId: b.id, budgetName: b.name }),
    })
    setBudgetName(b.name)
    setState("connected")
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
                ? budgetName ? `Connected · ${budgetName}` : "Connected"
                : state === "picking"
                  ? "Choose a budget to sync"
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

          {state === "picking" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={disconnect}
              className="gap-1.5 text-muted-foreground hover:text-destructive shrink-0"
            >
              <Unlink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {state === "picking" && (
          budgets.length === 0 ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-400 bg-amber-500/10 rounded-md px-3 py-2">
                No budgets found in your YNAB account — try reconnecting.
              </p>
              <Button size="sm" onClick={connect} className="w-full gap-1.5">
                <LogIn className="h-3.5 w-3.5" />
                Reconnect with YNAB
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {budgets.map(b => (
                <Button
                  key={b.id}
                  size="sm"
                  variant="outline"
                  onClick={() => selectBudget(b)}
                  className="w-full justify-start gap-2"
                >
                  💰 {b.name}
                </Button>
              ))}
            </div>
          )
        )}

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

        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2 flex items-center justify-between gap-3">
            <span>{error}</span>
            {error.toLowerCase().includes("budget") && hasOauthConfig && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => { await disconnect(); connect() }}
                className="shrink-0 gap-1.5 text-xs h-7 px-2"
              >
                <LogIn className="h-3 w-3" />
                Reconnect
              </Button>
            )}
          </div>
        )}
        {syncMsg && <p className="text-xs text-green-400 bg-green-500/10 rounded-md px-3 py-2">{syncMsg}</p>}
      </CardContent>
    </Card>
  )
}
