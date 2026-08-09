"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Sprout, Loader2, CheckCircle, XCircle } from "lucide-react"

// Rebuilds the Play Store review account. The endpoint is a POST — without a
// button there is no way to trigger it from a phone, which is where this
// tends to be needed.
export function SeedDemoButton() {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle")
  const [detail, setDetail] = useState<string>("")

  async function run() {
    setState("running")
    setDetail("")
    try {
      const res = await fetch("/api/admin/seed-demo", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const s = data.seeded ?? {}
      setState("done")
      setDetail(
        `${data.email} · ${s.days} days of health data, ${s.habits} habits, ` +
        `${s.journal} journal entries, ${s.checkins} check-ins`
      )
    } catch (e) {
      setState("error")
      setDetail(e instanceof Error ? e.message : "Something went wrong")
    }
  }

  return (
    <Card className="border-dashed">
      <CardContent className="pt-4 pb-4 space-y-3">
        <div className="flex items-start gap-2.5">
          <Sprout className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Demo account for app review</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Builds the account the Play Store reviewer signs into: a month of
              health data, habits, journal and check-ins. Safe to run again —
              it rebuilds from scratch every time.
            </p>
          </div>
        </div>

        <Button size="sm" onClick={run} disabled={state === "running"} className="gap-1.5">
          {state === "running"
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Building…</>
            : "Rebuild demo account"}
        </Button>

        {state === "done" && (
          <p className="flex items-start gap-1.5 text-xs text-green-400">
            <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{detail}</span>
          </p>
        )}
        {state === "error" && (
          <p className="flex items-start gap-1.5 text-xs text-red-400">
            <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{detail}</span>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
