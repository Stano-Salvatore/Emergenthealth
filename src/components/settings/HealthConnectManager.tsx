"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RefreshCw, Smartphone, CheckCircle2, XCircle, Download } from "lucide-react"
import {
  checkAvailability,
  requestPermissions,
  permissionsByType,
  syncToServer,
} from "@/lib/health-connect-service"

type Status = "checking" | "unavailable" | "not_installed" | "ready" | "syncing" | "done" | "error"

export function HealthConnectManager({ lastSync }: { lastSync?: string | null }) {
  const [status, setStatus] = useState<Status>("checking")
  const [syncedCount, setSyncedCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState(lastSync ?? null)
  // Which of the eight types this phone actually hands over. Every read goes
  // through a catch-all that returns nothing, so a refused type and a type
  // with no records look identical — for a ring left off that is right, and
  // for a permission that can never be granted it is a silence that lasts.
  const [missing, setMissing] = useState<string[] | null>(null)

  useEffect(() => {
    // `status` is the whole of what the availability answer is used for.
    checkAvailability().then(async av => {
      setStatus(
        av === "Available"     ? "ready"
        : av === "NotInstalled" ? "not_installed"
        : "unavailable"
      )
      if (av === "Available") setMissing((await permissionsByType())?.missing ?? null)
    })
  }, [])

  async function handleConnect() {
    setStatus("syncing")
    setError(null)
    const granted = await requestPermissions()
    const byType = await permissionsByType()
    setMissing(byType?.missing ?? null)
    if (!granted) {
      setStatus("error")
      // Name the types rather than the verdict. One refusal out of eight used
      // to read as a flat denial, with the other seven working and no way to
      // tell from here.
      setError(byType?.missing.length
        ? `Not granted: ${byType.missing.join(", ")}. The rest are connected.`
        : "Permission request failed or was denied.")
      if (byType && byType.granted.length > 0) await handleSync()
      return
    }
    await handleSync()
  }

  async function handleSync() {
    setStatus("syncing")
    setError(null)
    try {
      const { synced } = await syncToServer()
      setSyncedCount(synced)
      setLastSyncAt(new Date().toISOString())
      setStatus("done")
    } catch (e: unknown) {
      setStatus("error")
      setError(e instanceof Error ? e.message : "Sync failed. Please try again.")
    }
  }

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })

  // Not running in Android Capacitor context
  if (status === "unavailable") {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-green-400" />
            Health Connect
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Health Connect sync is available in the Android app only. Open Emergenthealth on your Android device to connect.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Health Connect app not installed
  if (status === "not_installed") {
    return (
      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-amber-400" />
            Health Connect
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Health Connect is not installed on this device. Install it from the Play Store to sync health data from Garmin, Fitbit, Samsung Health, and other apps.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="gap-2 border-amber-500/30 text-amber-400"
            onClick={() => window.open("market://details?id=com.google.android.apps.healthdata", "_blank")}
          >
            <Download className="h-3.5 w-3.5" />
            Install Health Connect
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={status === "done" ? "border-green-500/20 bg-green-500/5" : "border-border/50"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-green-400" />
          Health Connect
          {status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-green-400 ml-auto" />}
          {status === "error" && <XCircle className="h-3.5 w-3.5 text-red-400 ml-auto" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Sync steps, sleep, resting heart rate, HRV, SpO₂, calories and weight from any app that writes to Health Connect — Garmin, Fitbit, Samsung Health, Pixel Watch, and more.
        </p>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">{error}</p>
        )}

        {status === "done" && syncedCount != null && (
          <p className="text-xs text-green-400">
            Synced {syncedCount} days of data
            {lastSyncAt ? ` · last synced at ${fmtTime(lastSyncAt)}` : ""}
          </p>
        )}

        {lastSyncAt && status !== "done" && (
          <p className="text-xs text-muted-foreground">Last synced at {fmtTime(lastSyncAt)}</p>
        )}

        {/* A type the phone refuses reads, downstream, exactly like a type with
            no records — so it is said here, where it can be acted on, instead
            of going missing from the charts with no explanation. */}
        {missing != null && missing.length > 0 && (
          <p className="text-[11px] text-amber-400/90 leading-relaxed border-l-2 border-amber-500/40 pl-2">
            Not being read: <span className="font-medium">{missing.join(", ")}</span>. Everything else
            is syncing. If it stays refused after you allow it in Health Connect, this build is not
            asking for it — which is a fix in an update, not a setting.
          </p>
        )}

        <div className="flex gap-2">
          {!lastSyncAt && status !== "syncing" && (
            <Button
              size="sm"
              className="gap-2"
              onClick={handleConnect}
              disabled={status === "checking"}
            >
              <Smartphone className="h-3.5 w-3.5" />
              Connect &amp; Sync
            </Button>
          )}
          {(lastSyncAt || status === "done") && status !== "syncing" && (
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={handleSync}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Sync now
            </Button>
          )}
          {status === "syncing" && (
            <Button size="sm" disabled className="gap-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Syncing…
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
