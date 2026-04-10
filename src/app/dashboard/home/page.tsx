"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  RefreshCw, Thermometer, Camera, Bell, Monitor,
  Minus, Plus, AlertCircle, Wifi, WifiOff,
} from "lucide-react"
import type { SmartDevice } from "@/lib/google-home"

// ─── Trait helpers ────────────────────────────────────────────────────────────

function trait<T = Record<string, unknown>>(device: SmartDevice, traitName: string): T | null {
  return (device.traits[`sdm.devices.traits.${traitName}`] as T) ?? null
}

function deviceIcon(type: string) {
  if (type.includes("THERMOSTAT")) return Thermometer
  if (type.includes("CAMERA"))     return Camera
  if (type.includes("DOORBELL"))   return Bell
  return Monitor
}

function deviceLabel(type: string) {
  if (type.includes("THERMOSTAT")) return "Thermostats"
  if (type.includes("CAMERA"))     return "Cameras"
  if (type.includes("DOORBELL"))   return "Doorbells"
  return "Devices"
}

// ─── Thermostat card ─────────────────────────────────────────────────────────

function ThermostatCard({ device, onCommand }: {
  device: SmartDevice
  onCommand: (deviceName: string, command: string, params: Record<string, unknown>) => Promise<void>
}) {
  const temp    = trait<{ ambientTemperatureCelsius: number }>(device, "Temperature")
  const hvac    = trait<{ status: string }>(device, "ThermostatHvac")
  const modeT   = trait<{ mode: string; availableModes: string[] }>(device, "ThermostatMode")
  const setpt   = trait<{ heatCelsius?: number; coolCelsius?: number }>(device, "ThermostatTemperatureSetpoint")

  const current   = temp?.ambientTemperatureCelsius
  const hvacStatus = hvac?.status ?? "OFF"
  const mode      = modeT?.mode ?? "OFF"
  const heatSp    = setpt?.heatCelsius
  const coolSp    = setpt?.coolCelsius
  const setpoint  = mode === "COOL" ? coolSp : heatSp

  const [busy, setBusy] = useState(false)

  async function adjustTemp(delta: number) {
    if (setpoint == null || mode === "OFF" || mode === "HEATCOOL") return
    setBusy(true)
    const newVal = Math.round((setpoint + delta) * 2) / 2
    const command = mode === "COOL"
      ? "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool"
      : "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat"
    const params = mode === "COOL"
      ? { coolCelsius: newVal }
      : { heatCelsius: newVal }
    await onCommand(device.name, command, params)
    setBusy(false)
  }

  async function setMode(newMode: string) {
    setBusy(true)
    await onCommand(device.name, "sdm.devices.commands.ThermostatMode.SetMode", { mode: newMode })
    setBusy(false)
  }

  const MODES = modeT?.availableModes ?? ["HEAT", "COOL", "OFF"]
  const hvacColor = hvacStatus === "HEATING" ? "text-orange-400"
    : hvacStatus === "COOLING" ? "text-blue-400" : "text-muted-foreground"

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between gap-2 mb-4">
          <div>
            <p className="font-medium text-sm">{device.displayName}</p>
            <p className={`text-xs mt-0.5 ${hvacColor}`}>{hvacStatus}</p>
          </div>
          {device.connectivity !== "ONLINE"
            ? <WifiOff className="h-4 w-4 text-muted-foreground" />
            : <Wifi className="h-4 w-4 text-green-400" />}
        </div>

        {/* Temperature display */}
        <div className="flex items-end gap-4 mb-4">
          <div>
            <p className="text-xs text-muted-foreground">Current</p>
            <p className="text-3xl font-bold">
              {current != null ? `${current.toFixed(1)}°` : "—"}
            </p>
          </div>
          {setpoint != null && mode !== "OFF" && (
            <div className="mb-1">
              <p className="text-xs text-muted-foreground">Set to</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => adjustTemp(-0.5)}
                  disabled={busy}
                  className="h-6 w-6 rounded-md bg-secondary flex items-center justify-center hover:bg-accent disabled:opacity-50"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="text-lg font-semibold w-12 text-center">{setpoint.toFixed(1)}°</span>
                <button
                  onClick={() => adjustTemp(0.5)}
                  disabled={busy}
                  className="h-6 w-6 rounded-md bg-secondary flex items-center justify-center hover:bg-accent disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Mode buttons */}
        <div className="flex gap-1.5 flex-wrap">
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              disabled={busy}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors disabled:opacity-50 ${
                mode === m
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-muted-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Camera / Doorbell card ───────────────────────────────────────────────────

function CameraCard({ device }: { device: SmartDevice }) {
  const live = trait<{ maxVideoResolution?: { width: number; height: number } }>(device, "CameraLiveStream")

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">{device.displayName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {live?.maxVideoResolution
                ? `${live.maxVideoResolution.width}×${live.maxVideoResolution.height}`
                : "Camera"}
            </p>
          </div>
          {device.connectivity !== "ONLINE"
            ? <WifiOff className="h-4 w-4 text-muted-foreground" />
            : <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-green-400">Live</span>
              </div>
          }
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Setup card ───────────────────────────────────────────────────────────────

function SetupCard({ error, needsReauth }: { error: string; needsReauth?: boolean }) {
  const noProject = error.includes("SDM_PROJECT_ID")
  const noPermission = needsReauth || error.includes("PERMISSION_DENIED")

  return (
    <Card className="border-amber-500/30">
      <CardContent className="pt-5 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-2 text-sm">
          {noProject && (
            <>
              <p className="font-medium">Set up Google Smart Device Management</p>
              <ol className="text-muted-foreground space-y-1 list-decimal list-inside text-xs">
                <li>Go to <code className="bg-secondary px-1 rounded">console.nest.google.com/services</code></li>
                <li>Create a Device Access project ($5 one-time fee)</li>
                <li>Copy your Project ID</li>
                <li>Add <code className="bg-secondary px-1 rounded">SDM_PROJECT_ID</code> to Vercel env vars</li>
                <li>Redeploy, then sign out and back in</li>
              </ol>
            </>
          )}
          {noPermission && !noProject && (
            <>
              <p className="font-medium">Re-authorization needed</p>
              <p className="text-muted-foreground text-xs">
                The SDM scope was recently added. Sign out and back in to grant access to your Nest devices.
              </p>
              <a href="/api/auth/signout" className="text-xs text-primary underline">Sign out to re-authorize →</a>
            </>
          )}
          {!noProject && !noPermission && (
            <p className="text-muted-foreground">Error: {error}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [devices, setDevices] = useState<SmartDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [needsReauth, setNeedsReauth] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/home")
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
        setNeedsReauth(!!data.needsReauth)
        setDevices([])
      } else {
        setDevices(data.devices ?? [])
        setLastUpdated(new Date())
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCommand(deviceName: string, command: string, params: Record<string, unknown>) {
    await fetch("/api/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName, command, params }),
    })
    setTimeout(load, 1000)
  }

  // Group by type
  const grouped = devices.reduce((acc, d) => {
    const key = d.type
    if (!acc[key]) acc[key] = []
    acc[key].push(d)
    return acc
  }, {} as Record<string, SmartDevice[]>)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Home</h1>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Updated {lastUpdated.toLocaleTimeString()}
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && <SetupCard error={error} needsReauth={needsReauth} />}

      {!error && loading && devices.length === 0 && (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading devices…</div>
      )}

      {Object.entries(grouped).map(([type, items]) => {
        const Icon = deviceIcon(type)
        const label = deviceLabel(type)
        const isThermostat = type.includes("THERMOSTAT")
        const isCamera = type.includes("CAMERA") || type.includes("DOORBELL")

        return (
          <div key={type}>
            <div className="flex items-center gap-2 mb-3">
              <Icon className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-medium">{label}</h2>
              <span className="text-xs text-muted-foreground">({items.length})</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((device) =>
                isThermostat ? (
                  <ThermostatCard key={device.name} device={device} onCommand={handleCommand} />
                ) : isCamera ? (
                  <CameraCard key={device.name} device={device} />
                ) : (
                  <Card key={device.name}>
                    <CardContent className="pt-5 pb-5">
                      <p className="font-medium text-sm">{device.displayName}</p>
                      <p className="text-xs text-muted-foreground mt-1">{device.type.split(".").pop()}</p>
                    </CardContent>
                  </Card>
                )
              )}
            </div>
          </div>
        )
      })}

      {!error && !loading && devices.length === 0 && (
        <p className="text-muted-foreground text-sm text-center py-8">No devices found in your project.</p>
      )}
    </div>
  )
}
