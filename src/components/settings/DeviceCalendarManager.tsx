"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RefreshCw, CalendarDays, CheckCircle2, XCircle } from "lucide-react"
import {
  isDeviceCalendarAvailable,
  requestPermission,
  syncToServer,
} from "@/lib/native/device-calendar"

type Status = "checking" | "unavailable" | "ready" | "syncing" | "done" | "error"

export function DeviceCalendarManager({ lastSync }: { lastSync?: string | null }) {
  const [status, setStatus] = useState<Status>("checking")
  const [syncedCount, setSyncedCount] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState(lastSync ?? null)

  useEffect(() => {
    isDeviceCalendarAvailable().then((available) => {
      setStatus(available ? "ready" : "unavailable")
    })
  }, [])

  async function handleConnect() {
    setStatus("syncing")
    setError(null)
    const { outcome, reason } = await requestPermission()
    if (outcome === "unavailable") {
      setStatus("error")
      setError(
        "Couldn't reach the phone calendar. Make sure you're on the latest app build (reinstall from the release link), then try again." +
          (reason ? `\n\nDetails: ${reason}` : ""),
      )
      return
    }
    if (outcome === "denied") {
      setStatus("error")
      setError("Calendar permission was denied. Enable it in Android Settings → Apps → Emergenthealth → Permissions.")
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

  // Not running in the Android app (or an APK without the calendar plugin)
  if (status === "unavailable") {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-sky-400" />
            Phone calendar (Samsung, local)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Reading your phone&apos;s calendars — including Samsung Calendar — is available in the Android app only. Open Emergenthealth on your Android device to connect. Google Calendar syncs automatically on every platform.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={status === "done" ? "border-green-500/20 bg-green-500/5" : "border-border/50"}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-sky-400" />
          Phone calendar (Samsung, local)
          {status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-green-400 ml-auto" />}
          {status === "error" && <XCircle className="h-3.5 w-3.5 text-red-400 ml-auto" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Pull events from every calendar on this phone — Samsung Calendar, local calendars, and any synced account — so they show up alongside Google Calendar. Read-only.
        </p>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2 whitespace-pre-line break-words">{error}</p>
        )}

        {status === "done" && syncedCount != null && (
          <p className="text-xs text-green-400">
            Synced {syncedCount} event{syncedCount === 1 ? "" : "s"}
            {lastSyncAt ? ` · last synced at ${fmtTime(lastSyncAt)}` : ""}
          </p>
        )}

        {lastSyncAt && status !== "done" && (
          <p className="text-xs text-muted-foreground">Last synced at {fmtTime(lastSyncAt)}</p>
        )}

        <div className="flex gap-2">
          {!lastSyncAt && status !== "syncing" && (
            <Button
              size="sm"
              className="gap-2"
              onClick={handleConnect}
              disabled={status === "checking"}
            >
              <CalendarDays className="h-3.5 w-3.5" />
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
