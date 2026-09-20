"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Smartphone, CheckCircle2, RefreshCw } from "lucide-react"
import {
  hasScreenTimeBridge,
  hasUsagePermission,
  openUsageSettings,
  syncScreenTime,
  SCREEN_TIME_READABLE,
  type ScreenTimeReading,
} from "@/lib/native/screen-time"

function fmt(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtClock(minsAfterMidnight: number): string {
  const h = Math.floor(minsAfterMidnight / 60)
  const m = minsAfterMidnight % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

export function ScreenTimeManager() {
  const [inApp, setInApp] = useState(false)
  const [granted, setGranted] = useState(false)
  const [reading, setReading] = useState<ScreenTimeReading | null>(null)
  const [syncing, setSyncing] = useState(false)

  async function refresh() {
    setSyncing(true)
    try {
      const r = await syncScreenTime()
      setReading(r)
      setGranted(hasUsagePermission())
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    const present = hasScreenTimeBridge()
    setInApp(present)
    if (present) {
      setGranted(hasUsagePermission())
      refresh()
    }
  }, [])

  // Only meaningful inside the Android app — hide entirely on the web.
  if (!inApp) return null

  // This build cannot be granted Usage access at all, so the card says that
  // rather than offering a button to a settings list Emergenthealth is not in.
  // Naming the reason matters: "not supported yet" would read as a bug in the
  // phone, and the next person to look would go hunting for one.
  if (!SCREEN_TIME_READABLE) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Screen Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This build cannot read screen time. Android only offers Usage access to apps that ask
            for it in their manifest, and this one deliberately does not — so there is nothing to
            grant, and no switch anywhere on your phone that would change it.
          </p>
          <p className="text-xs text-muted-foreground/80 mt-2 leading-relaxed">
            Everything else on your Insights page is unaffected. If screen time becomes worth the
            extra Play Store declaration it needs, it arrives in an update rather than a setting.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Smartphone className="h-4 w-4" /> Screen Time
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!granted ? (
          <>
            <p className="text-sm text-muted-foreground">
              Track your phone screen time and feed it into your Insights — see whether more screen
              time wrecks your sleep. Grant <span className="font-medium text-foreground">Usage access</span> to
              Emergenthealth, then come back.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={openUsageSettings}>Open Usage Access settings</Button>
              <Button size="sm" variant="outline" onClick={refresh} disabled={syncing}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} /> Recheck
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4" /> Usage access granted
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-secondary/50 px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">Today</p>
                <p className="text-lg font-bold tabular-nums">{reading ? fmt(reading.totalMin) : "—"}</p>
              </div>
              <div className="rounded-lg bg-secondary/50 px-3 py-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">First unlock</p>
                <p className="text-lg font-bold tabular-nums">
                  {reading?.firstUnlockMin != null ? fmtClock(reading.firstUnlockMin) : "—"}
                </p>
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={refresh} disabled={syncing}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} /> Sync now
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
