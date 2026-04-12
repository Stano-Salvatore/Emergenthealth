"use client"

import { useEffect, useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Wind, Power, Thermometer, Loader2, WifiOff, RefreshCw } from "lucide-react"

interface AcAttrs {
  Pow: number
  Mod: number
  SetTem: number
  TemSen: number
  WdSpd: number
  Tur: number
  Quiet: number
}

interface AcDevice {
  deviceId: string
  deviceName: string
  mac: string
  online: boolean
  attrs?: AcAttrs
}

const MODES = ["Auto", "Cool", "Dry", "Fan", "Heat"] as const
const MODE_ICONS = ["🔄", "❄️", "💧", "🌀", "🔥"] as const

export function AcCard() {
  const [device, setDevice] = useState<AcDevice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/home")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.ewpeError && !data.ewpe?.length) {
        setError(data.ewpeError)
        return
      }
      const devices: AcDevice[] = data.ewpe ?? []
      if (devices.length === 0) {
        setError("No AC devices found")
        return
      }
      setDevice(devices[0])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch AC status")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30_000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  async function control(attrs: Partial<AcAttrs>) {
    if (!device || busy) return
    // Optimistic update
    setDevice(prev => prev ? { ...prev, attrs: { ...prev.attrs!, ...attrs } } : prev)
    setBusy(true)
    try {
      const res = await fetch("/api/home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "ewpe", deviceId: device.deviceId, attrs }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Re-fetch after a short delay to get real state from device
      setTimeout(fetchStatus, 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Control failed")
      // Revert optimistic update on error
      fetchStatus()
    } finally {
      setBusy(false)
    }
  }

  const attrs = device?.attrs
  const isOn = attrs?.Pow === 1
  const mode = attrs?.Mod ?? 0
  const setTemp = attrs?.SetTem ?? 22
  const ambientTemp = attrs?.TemSen

  return (
    <Card className={`h-full transition-colors ${
      !device?.online ? "border-muted/40" :
      isOn ? "border-blue-500/40 bg-blue-500/5" : ""
    }`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Wind className="h-4 w-4" />
            {device?.deviceName ?? "Sinclair AC"}
          </span>
          <div className="flex items-center gap-1.5">
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {!loading && (
              <button
                onClick={(e) => { e.preventDefault(); fetchStatus() }}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            {device && (
              <Badge
                variant={device.online ? "secondary" : "outline"}
                className={`text-xs py-0 px-1.5 ${device.online ? "text-green-400" : "text-muted-foreground"}`}
              >
                {device.online ? "online" : "offline"}
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Connecting…</span>
          </div>
        ) : error ? (
          <div className="space-y-2 py-2">
            <div className="flex items-center gap-2 text-red-400">
              <WifiOff className="h-4 w-4 shrink-0" />
              <span className="text-xs leading-tight">{error}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Start the bridge on your home PC and set EWPE_API_URL in Vercel.
            </p>
          </div>
        ) : device ? (
          <div className="space-y-3">
            {/* Temperature row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Thermometer className="h-4 w-4 text-orange-400" />
                <span className="text-2xl font-bold">{setTemp}°C</span>
                {ambientTemp != null && ambientTemp > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">room {ambientTemp}°C</span>
                )}
              </div>
              {/* Power toggle */}
              <Button
                size="sm"
                variant={isOn ? "default" : "outline"}
                className={`h-8 w-8 p-0 ${isOn ? "bg-blue-600 hover:bg-blue-700" : ""}`}
                onClick={() => control({ Pow: isOn ? 0 : 1 })}
                disabled={busy || !device.online}
                title={isOn ? "Turn off" : "Turn on"}
              >
                <Power className="h-4 w-4" />
              </Button>
            </div>

            {/* Temp controls — only when on */}
            {isOn && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm" variant="outline"
                  className="h-7 w-7 p-0 text-base"
                  onClick={() => control({ SetTem: Math.max(16, setTemp - 1) })}
                  disabled={busy || setTemp <= 16}
                >
                  −
                </Button>
                <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${((setTemp - 16) / (30 - 16)) * 100}%` }}
                  />
                </div>
                <Button
                  size="sm" variant="outline"
                  className="h-7 w-7 p-0 text-base"
                  onClick={() => control({ SetTem: Math.min(30, setTemp + 1) })}
                  disabled={busy || setTemp >= 30}
                >
                  +
                </Button>
              </div>
            )}

            {/* Mode selector — only when on */}
            {isOn && (
              <div className="flex gap-1 flex-wrap">
                {MODES.map((name, idx) => (
                  <button
                    key={name}
                    onClick={() => control({ Mod: idx })}
                    disabled={busy}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                      mode === idx
                        ? "bg-blue-600 text-white"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <span>{MODE_ICONS[idx]}</span>
                    <span>{name}</span>
                  </button>
                ))}
              </div>
            )}

            {!isOn && (
              <p className="text-xs text-muted-foreground">AC is off — press power to turn on</p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
