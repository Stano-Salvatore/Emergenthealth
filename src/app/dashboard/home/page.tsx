"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  RefreshCw, ChevronUp, ChevronDown, Square,
  Wifi, WifiOff, Radio, Thermometer, AlertCircle, Pencil, Check,
} from "lucide-react"
import type { EwelinkDevice } from "@/lib/ewelink"
import type { SmartDevice } from "@/lib/google-home"

// ─── RF Bridge ───────────────────────────────────────────────────────────────

const RF_BRIDGE_UIID = 28

// Each shutter = 3 consecutive channels: up, stop, down
// Stored in localStorage as { [deviceId]: { shutters: [{ name, up, stop, down }] } }
interface ShutterConfig {
  name: string
  up: number
  stop: number
  down: number
}
interface DeviceConfig {
  shutters: ShutterConfig[]
  loose: { ch: number; label: string }[] // individual buttons not in shutter groups
}

function loadConfig(deviceId: string): DeviceConfig {
  try {
    const raw = localStorage.getItem(`rfcfg_${deviceId}`)
    return raw ? JSON.parse(raw) : { shutters: [], loose: [] }
  } catch { return { shutters: [], loose: [] } }
}
function saveConfig(deviceId: string, cfg: DeviceConfig) {
  localStorage.setItem(`rfcfg_${deviceId}`, JSON.stringify(cfg))
}

function ShutterButton({
  icon: Icon, label, onClick, busy,
}: { icon: React.ElementType; label: string; onClick: () => void; busy: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex flex-col items-center gap-1 p-3 rounded-xl bg-secondary hover:bg-accent transition-colors disabled:opacity-50 flex-1"
    >
      <Icon className="h-5 w-5" />
      <span className="text-xs">{label}</span>
    </button>
  )
}

function RfBridgeCard({ device, onTransmit }: {
  device: EwelinkDevice
  onTransmit: (deviceId: string, ch: number) => Promise<void>
}) {
  const [cfg, setCfg] = useState<DeviceConfig>({ shutters: [], loose: [] })
  const [busy, setBusy] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [newName, setNewName] = useState("")

  useEffect(() => {
    const saved = loadConfig(device.deviceid)
    // If no config yet and device has RF channels, auto-detect shutters
    if (saved.shutters.length === 0 && saved.loose.length === 0) {
      const channels = device.params?.rfList ?? []
      if (channels.length >= 3) {
        // Group in sets of 3: up, stop, down
        const shutters: ShutterConfig[] = []
        for (let i = 0; i + 2 < channels.length; i += 3) {
          shutters.push({ name: `Shutter ${shutters.length + 1}`, up: i, stop: i + 1, down: i + 2 })
        }
        // Remaining as loose channels
        const used = shutters.length * 3
        const loose = channels.slice(used).map((c) => ({ ch: c.rfChl, label: `CH ${c.rfChl}` }))
        const auto = { shutters, loose }
        saveConfig(device.deviceid, auto)
        setCfg(auto)
      } else {
        const loose = (channels).map((c) => ({ ch: c.rfChl, label: `CH ${c.rfChl}` }))
        const auto = { shutters: [], loose }
        saveConfig(device.deviceid, auto)
        setCfg(auto)
      }
    } else {
      setCfg(saved)
    }
  }, [device])

  async function send(ch: number) {
    setBusy(ch)
    try { await onTransmit(device.deviceid, ch) }
    finally { setBusy(null) }
  }

  function renameShutter(i: number, name: string) {
    const next = { ...cfg, shutters: cfg.shutters.map((s, j) => j === i ? { ...s, name } : s) }
    setCfg(next)
    saveConfig(device.deviceid, next)
  }

  const channels = device.params?.rfList ?? []

  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          {device.name}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {device.online ? (
              <span className="flex items-center gap-1 text-green-400"><Wifi className="h-3 w-3" /> Online</span>
            ) : (
              <span className="flex items-center gap-1"><WifiOff className="h-3 w-3" /> Offline</span>
            )}
          </span>
          <button onClick={() => setEditing(!editing)} className="text-muted-foreground hover:text-foreground ml-1">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {channels.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No RF codes learned yet. Open the eWeLink app → RF Bridge → add remote codes first.
          </p>
        )}

        {/* Shutter groups */}
        {cfg.shutters.map((s, i) => (
          <div key={i} className="space-y-2">
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  className="text-xs bg-secondary border border-border rounded px-2 py-1 flex-1"
                  value={s.name}
                  onChange={(e) => renameShutter(i, e.target.value)}
                />
                <Check className="h-4 w-4 text-green-400 shrink-0" />
              </div>
            ) : (
              <p className="text-xs font-medium text-muted-foreground">{s.name}</p>
            )}
            <div className="flex gap-2">
              <ShutterButton icon={ChevronUp}   label="Up"   onClick={() => send(s.up)}   busy={busy === s.up} />
              <ShutterButton icon={Square}      label="Stop" onClick={() => send(s.stop)} busy={busy === s.stop} />
              <ShutterButton icon={ChevronDown} label="Down" onClick={() => send(s.down)} busy={busy === s.down} />
            </div>
          </div>
        ))}

        {/* Individual loose channels */}
        {cfg.loose.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {cfg.loose.map((l) => (
              <button
                key={l.ch}
                onClick={() => send(l.ch)}
                disabled={busy === l.ch}
                className="px-3 py-2 rounded-lg bg-secondary hover:bg-accent text-xs transition-colors disabled:opacity-50"
              >
                {l.label}
              </button>
            ))}
          </div>
        )}

        {editing && (
          <p className="text-xs text-muted-foreground">
            Channels auto-grouped as shutters (UP / STOP / DOWN sets of 3). Rename above to match your rooms.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Thermostat card (SDM) ────────────────────────────────────────────────────

function trait<T>(device: SmartDevice, name: string): T | null {
  return (device.traits[`sdm.devices.traits.${name}`] as T) ?? null
}

function ThermostatCard({ device, onCommand }: {
  device: SmartDevice
  onCommand: (name: string, cmd: string, params: Record<string, unknown>) => Promise<void>
}) {
  const temp  = trait<{ ambientTemperatureCelsius: number }>(device, "Temperature")
  const hvac  = trait<{ status: string }>(device, "ThermostatHvac")
  const modeT = trait<{ mode: string; availableModes: string[] }>(device, "ThermostatMode")
  const setpt = trait<{ heatCelsius?: number; coolCelsius?: number }>(device, "ThermostatTemperatureSetpoint")
  const [busy, setBusy] = useState(false)

  const mode = modeT?.mode ?? "OFF"
  const setpoint = mode === "COOL" ? setpt?.coolCelsius : setpt?.heatCelsius

  async function adjustTemp(delta: number) {
    if (setpoint == null || mode === "OFF") return
    setBusy(true)
    const val = Math.round((setpoint + delta) * 2) / 2
    const cmd = mode === "COOL"
      ? "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool"
      : "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat"
    await onCommand(device.name, cmd, mode === "COOL" ? { coolCelsius: val } : { heatCelsius: val })
    setBusy(false)
  }

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-3">
          <p className="font-medium text-sm flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-orange-400" /> {device.displayName}
          </p>
          <span className="text-xs text-muted-foreground">{hvac?.status ?? ""}</span>
        </div>
        <div className="flex items-end gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Now</p>
            <p className="text-3xl font-bold">{temp ? `${temp.ambientTemperatureCelsius.toFixed(1)}°` : "—"}</p>
          </div>
          {setpoint != null && mode !== "OFF" && (
            <div>
              <p className="text-xs text-muted-foreground">Set</p>
              <div className="flex items-center gap-1">
                <button onClick={() => adjustTemp(-0.5)} disabled={busy} className="h-6 w-6 rounded bg-secondary flex items-center justify-center hover:bg-accent">
                  <span className="text-sm">−</span>
                </button>
                <span className="text-lg font-semibold w-12 text-center">{setpoint.toFixed(1)}°</span>
                <button onClick={() => adjustTemp(0.5)} disabled={busy} className="h-6 w-6 rounded bg-secondary flex items-center justify-center hover:bg-accent">
                  <span className="text-sm">+</span>
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {(modeT?.availableModes ?? ["HEAT", "COOL", "OFF"]).map((m) => (
            <button key={m} onClick={() => onCommand(device.name, "sdm.devices.commands.ThermostatMode.SetMode", { mode: m })}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${mode === m ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
              {m}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Setup card ───────────────────────────────────────────────────────────────

function SetupCard() {
  return (
    <Card className="border-amber-500/30">
      <CardContent className="pt-5 flex gap-3">
        <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm space-y-2">
          <p className="font-medium">Connect your Sonoff RF Bridge</p>
          <p className="text-xs text-muted-foreground">Add these to Vercel environment variables:</p>
          <div className="text-xs font-mono bg-secondary rounded p-2 space-y-0.5">
            <p>EWELINK_EMAIL=your@email.com</p>
            <p>EWELINK_PASSWORD=yourpassword</p>
            <p>EWELINK_REGION=eu  <span className="text-muted-foreground"># eu / us / as</span></p>
          </div>
          <p className="text-xs text-muted-foreground">
            Make sure your RF Bridge has RF codes learned via the eWeLink app first.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [rfDevices, setRfDevices] = useState<EwelinkDevice[]>([])
  const [sdmDevices, setSdmDevices] = useState<SmartDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [notConfigured, setNotConfigured] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/home")
      if (res.status === 503) { setNotConfigured(true); setLoading(false); return }
      const data = await res.json()
      setNotConfigured(false)
      setRfDevices((data.ewelink as EwelinkDevice[]) ?? [])
      setSdmDevices((data.sdm as SmartDevice[]) ?? [])
      setLastUpdated(new Date())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleTransmit(deviceId: string, rfChl: number) {
    await fetch("/api/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ewelink_rf", deviceId, rfChl }),
    })
  }

  async function handleSdmCommand(deviceName: string, command: string, params: Record<string, unknown>) {
    await fetch("/api/home", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "sdm", deviceName, command, params }),
    })
    setTimeout(load, 1000)
  }

  const rfBridges = rfDevices.filter((d) => d.extra?.uiid === RF_BRIDGE_UIID)
  const thermostats = sdmDevices.filter((d) => d.type.includes("THERMOSTAT"))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Home</h1>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground mt-0.5">Updated {lastUpdated.toLocaleTimeString()}</p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {notConfigured && <SetupCard />}

      {!notConfigured && loading && rfBridges.length === 0 && thermostats.length === 0 && (
        <p className="text-muted-foreground text-sm py-8 text-center">Loading devices…</p>
      )}

      {rfBridges.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">Shutters · RF Bridge</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {rfBridges.map((d) => (
              <RfBridgeCard key={d.deviceid} device={d} onTransmit={handleTransmit} />
            ))}
          </div>
        </div>
      )}

      {thermostats.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground">Climate · Nest</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {thermostats.map((d) => (
              <ThermostatCard key={d.name} device={d} onCommand={handleSdmCommand} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
