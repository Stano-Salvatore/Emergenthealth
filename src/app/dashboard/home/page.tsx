"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  RefreshCw, ChevronUp, ChevronDown, Square,
  Wifi, WifiOff, Radio, Thermometer, AlertCircle,
  Pencil, Check, Plug, Lightbulb, Bot, ToggleLeft, ToggleRight,
} from "lucide-react"
import type { EwelinkDevice } from "@/lib/ewelink"
import type { SmartDevice } from "@/lib/google-home"
import type { TuyaDevice } from "@/lib/tuya"
import type { AcDevice } from "@/lib/ewpe-smart"
import { AC_MODES, FAN_SPEEDS } from "@/lib/ewpe-smart"

// ─── Tuya category helpers ───────────────────────────────────────────────────

const PLUG_CATS     = ["cz", "pc", "kg", "socket"]
const LIGHT_CATS    = ["dj", "tgq", "tgkg", "xdd", "fwd", "dc", "light"]
const ROBOT_CATS    = ["sweep_robot", "mop", "robot"]

function isPlug(d: TuyaDevice)  { return PLUG_CATS.some((c)  => d.category?.includes(c)) }
function isLight(d: TuyaDevice) { return LIGHT_CATS.some((c) => d.category?.includes(c)) }
function isRobot(d: TuyaDevice) { return ROBOT_CATS.some((c) => d.category?.includes(c)) }

function getStatus(d: TuyaDevice, code: string) {
  return d.status?.find((s) => s.code === code)?.value
}

// ─── Tuya Plug card ──────────────────────────────────────────────────────────

function PlugCard({ device, onControl }: {
  device: TuyaDevice
  onControl: (id: string, commands: { code: string; value: unknown }[]) => Promise<void>
}) {
  const isOn = getStatus(device, "switch_1") as boolean ?? getStatus(device, "switch") as boolean ?? false
  const power = getStatus(device, "cur_power") as number
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    const code = device.status?.find((s) => s.code === "switch_1") ? "switch_1" : "switch"
    await onControl(device.id, [{ code, value: !isOn }])
    setBusy(false)
  }

  return (
    <button
      onClick={toggle}
      disabled={busy || !device.online}
      className={`text-left p-4 rounded-xl border transition-all w-full ${
        isOn ? "border-primary/40 bg-primary/5" : "border-border bg-secondary/50"
      } disabled:opacity-50`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plug className={`h-4 w-4 ${isOn ? "text-primary" : "text-muted-foreground"}`} />
          <span className="text-sm font-medium truncate max-w-[140px]">{device.name}</span>
        </div>
        {isOn
          ? <ToggleRight className="h-5 w-5 text-primary shrink-0" />
          : <ToggleLeft  className="h-5 w-5 text-muted-foreground shrink-0" />
        }
      </div>
      {power != null && (
        <p className="text-xs text-muted-foreground mt-1.5">{(power / 10).toFixed(1)} W</p>
      )}
      {!device.online && <p className="text-xs text-muted-foreground mt-1">Offline</p>}
    </button>
  )
}

// ─── Tuya Light card ─────────────────────────────────────────────────────────

function LightCard({ device, onControl }: {
  device: TuyaDevice
  onControl: (id: string, commands: { code: string; value: unknown }[]) => Promise<void>
}) {
  const isOn      = getStatus(device, "switch_led") as boolean ?? false
  const brightness = getStatus(device, "bright_value_v2") as number ?? getStatus(device, "bright_value") as number
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    await onControl(device.id, [{ code: "switch_led", value: !isOn }])
    setBusy(false)
  }

  async function setBrightness(val: number) {
    const code = device.status?.find((s) => s.code === "bright_value_v2") ? "bright_value_v2" : "bright_value"
    await onControl(device.id, [{ code, value: val }])
  }

  const pct = brightness != null ? Math.round((brightness / 1000) * 100) : null

  return (
    <div className={`p-4 rounded-xl border transition-all ${
      isOn ? "border-yellow-400/30 bg-yellow-400/5" : "border-border bg-secondary/50"
    } ${!device.online ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Lightbulb className={`h-4 w-4 ${isOn ? "text-yellow-400" : "text-muted-foreground"}`} />
          <span className="text-sm font-medium truncate max-w-[120px]">{device.name}</span>
        </div>
        <button
          onClick={toggle}
          disabled={busy || !device.online}
          className="disabled:opacity-50"
        >
          {isOn
            ? <ToggleRight className="h-5 w-5 text-yellow-400" />
            : <ToggleLeft  className="h-5 w-5 text-muted-foreground" />
          }
        </button>
      </div>
      {isOn && pct != null && (
        <div className="flex items-center gap-2 mt-2">
          <button onClick={() => setBrightness(Math.max(10, (brightness ?? 500) - 100))}
            className="h-5 w-5 rounded bg-secondary flex items-center justify-center text-xs hover:bg-accent">−</button>
          <div className="flex-1 h-1.5 bg-secondary rounded-full">
            <div className="h-full bg-yellow-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <button onClick={() => setBrightness(Math.min(1000, (brightness ?? 500) + 100))}
            className="h-5 w-5 rounded bg-secondary flex items-center justify-center text-xs hover:bg-accent">+</button>
          <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
        </div>
      )}
    </div>
  )
}

// ─── Tuya Robot card ─────────────────────────────────────────────────────────

function RobotCard({ device, onControl }: {
  device: TuyaDevice
  onControl: (id: string, commands: { code: string; value: unknown }[]) => Promise<void>
}) {
  const status   = getStatus(device, "status") as string ?? getStatus(device, "work_mode") as string ?? "—"
  const battery  = getStatus(device, "battery_percentage") as number ?? getStatus(device, "battery") as number
  const [busy, setBusy] = useState(false)

  async function startCleaning() {
    setBusy(true)
    await onControl(device.id, [{ code: "switch_go", value: true }])
    setBusy(false)
  }
  async function returnHome() {
    setBusy(true)
    await onControl(device.id, [{ code: "switch_charge", value: true }])
    setBusy(false)
  }

  const isCleaning = status?.toLowerCase().includes("clean") || status?.toLowerCase().includes("sweep")

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{device.name}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {battery != null && (
              <span className="text-xs text-muted-foreground">{battery}%</span>
            )}
            {device.online
              ? <Wifi className="h-3.5 w-3.5 text-green-400" />
              : <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />
            }
          </div>
        </div>
        <p className="text-xs text-muted-foreground capitalize mb-3">{status}</p>
        <div className="flex gap-2">
          <Button size="sm" variant={isCleaning ? "default" : "outline"} disabled={busy || !device.online}
            onClick={startCleaning} className="flex-1 text-xs">
            {isCleaning ? "Cleaning…" : "Start"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy || !device.online}
            onClick={returnHome} className="flex-1 text-xs">
            Return home
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── RF Bridge shutter card ───────────────────────────────────────────────────

const RF_BRIDGE_UIID = 28

interface ShutterConfig { name: string; up: number; stop: number; down: number }
interface DeviceConfig  { shutters: ShutterConfig[]; loose: { ch: number; label: string }[] }

function loadCfg(id: string): DeviceConfig {
  try { return JSON.parse(localStorage.getItem(`rfcfg_${id}`) ?? "null") ?? { shutters: [], loose: [] } }
  catch { return { shutters: [], loose: [] } }
}
function saveCfg(id: string, cfg: DeviceConfig) {
  localStorage.setItem(`rfcfg_${id}`, JSON.stringify(cfg))
}

function ShutterBtn({ icon: Icon, label, onClick, busy }: { icon: React.ElementType; label: string; onClick: () => void; busy: boolean }) {
  return (
    <button onClick={onClick} disabled={busy}
      className="flex flex-col items-center gap-1 p-3 rounded-xl bg-secondary hover:bg-accent transition-colors disabled:opacity-50 flex-1">
      <Icon className="h-5 w-5" />
      <span className="text-xs">{label}</span>
    </button>
  )
}

function RfBridgeCard({ device, onTransmit }: { device: EwelinkDevice; onTransmit: (id: string, ch: number) => Promise<void> }) {
  const [cfg, setCfg] = useState<DeviceConfig>({ shutters: [], loose: [] })
  const [busy, setBusy] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    const saved = loadCfg(device.deviceid)
    if (saved.shutters.length === 0 && saved.loose.length === 0) {
      const chs = device.params?.rfList ?? []
      const shutters: ShutterConfig[] = []
      for (let i = 0; i + 2 < chs.length; i += 3)
        shutters.push({ name: `Shutter ${shutters.length + 1}`, up: i, stop: i + 1, down: i + 2 })
      const used = shutters.length * 3
      const loose = chs.slice(used).map((c) => ({ ch: c.rfChl, label: `CH ${c.rfChl}` }))
      const auto = { shutters, loose }
      saveCfg(device.deviceid, auto)
      setCfg(auto)
    } else { setCfg(saved) }
  }, [device])

  async function send(ch: number) {
    setBusy(ch); try { await onTransmit(device.deviceid, ch) } finally { setBusy(null) }
  }

  function rename(i: number, name: string) {
    const next = { ...cfg, shutters: cfg.shutters.map((s, j) => j === i ? { ...s, name } : s) }
    setCfg(next); saveCfg(device.deviceid, next)
  }

  return (
    <Card>
      <CardHeader className="pb-2 pt-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />{device.name}
          <span className="ml-auto text-xs font-normal">
            {device.online ? <span className="text-green-400 flex items-center gap-1"><Wifi className="h-3 w-3"/>Online</span>
              : <span className="flex items-center gap-1"><WifiOff className="h-3 w-3"/>Offline</span>}
          </span>
          <button onClick={() => setEditing(!editing)} className="text-muted-foreground hover:text-foreground">
            {editing ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Pencil className="h-3.5 w-3.5" />}
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(device.params?.rfList ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">No RF codes learned yet. Add them in the eWeLink app first.</p>
        )}
        {cfg.shutters.map((s, i) => (
          <div key={i} className="space-y-2">
            {editing
              ? <input className="text-xs bg-secondary border border-border rounded px-2 py-1 w-full"
                  value={s.name} onChange={(e) => rename(i, e.target.value)} />
              : <p className="text-xs font-medium text-muted-foreground">{s.name}</p>
            }
            <div className="flex gap-2">
              <ShutterBtn icon={ChevronUp}   label="Up"   onClick={() => send(s.up)}   busy={busy === s.up} />
              <ShutterBtn icon={Square}      label="Stop" onClick={() => send(s.stop)} busy={busy === s.stop} />
              <ShutterBtn icon={ChevronDown} label="Down" onClick={() => send(s.down)} busy={busy === s.down} />
            </div>
          </div>
        ))}
        {cfg.loose.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {cfg.loose.map((l) => (
              <button key={l.ch} onClick={() => send(l.ch)} disabled={busy === l.ch}
                className="px-3 py-2 rounded-lg bg-secondary hover:bg-accent text-xs">{l.label}</button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── SDM Thermostat card ─────────────────────────────────────────────────────

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
  const sp   = mode === "COOL" ? setpt?.coolCelsius : setpt?.heatCelsius

  async function adjust(delta: number) {
    if (sp == null || mode === "OFF") return
    setBusy(true)
    const v = Math.round((sp + delta) * 2) / 2
    const cmd = mode === "COOL" ? "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool"
      : "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat"
    await onCommand(device.name, cmd, mode === "COOL" ? { coolCelsius: v } : { heatCelsius: v })
    setBusy(false)
  }

  return (
    <Card>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-center justify-between mb-3">
          <p className="font-medium text-sm flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-orange-400" />{device.displayName}
          </p>
          <span className="text-xs text-muted-foreground">{hvac?.status ?? ""}</span>
        </div>
        <div className="flex items-end gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Now</p>
            <p className="text-3xl font-bold">{temp ? `${temp.ambientTemperatureCelsius.toFixed(1)}°` : "—"}</p>
          </div>
          {sp != null && mode !== "OFF" && (
            <div>
              <p className="text-xs text-muted-foreground">Set</p>
              <div className="flex items-center gap-1">
                <button onClick={() => adjust(-0.5)} disabled={busy} className="h-6 w-6 rounded bg-secondary flex items-center justify-center hover:bg-accent text-sm">−</button>
                <span className="text-lg font-semibold w-12 text-center">{sp.toFixed(1)}°</span>
                <button onClick={() => adjust(0.5)} disabled={busy} className="h-6 w-6 rounded bg-secondary flex items-center justify-center hover:bg-accent text-sm">+</button>
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-1.5 mt-3 flex-wrap">
          {(modeT?.availableModes ?? ["HEAT","COOL","OFF"]).map((m) => (
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

// ─── AC card (EWPE Smart / Sinclair) ─────────────────────────────────────────

function AcCard({ device, onControl }: {
  device: AcDevice
  onControl: (deviceId: string, attrs: Record<string, unknown>) => Promise<void>
}) {
  const a = device.attrs
  const isOn   = a?.Pow === 1
  const mode   = a?.Mod ?? 1
  const temp   = a?.SetTem ?? 22
  const curTemp = a?.TemSen
  const fanSpd = a?.WdSpd ?? 0
  const [busy, setBusy] = useState(false)
  const [controlError, setControlError] = useState<string | null>(null)

  async function send(attrs: Record<string, unknown>) {
    setBusy(true)
    setControlError(null)
    try {
      await onControl(device.deviceId, attrs)
    } catch (e) {
      setControlError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  const modeColors = ["text-muted-foreground","text-blue-400","text-cyan-400","text-gray-400","text-orange-400"]

  return (
    <Card className={isOn ? "border-primary/30" : ""}>
      <CardContent className="pt-5 pb-5 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-sm">{device.deviceName}</p>
            {curTemp != null && (
              <p className="text-xs text-muted-foreground mt-0.5">Room: {curTemp}°C</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {device.online
              ? <Wifi className="h-3.5 w-3.5 text-green-400" />
              : <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />}
            <button
              onClick={() => send({ Pow: isOn ? 0 : 1 })}
              disabled={busy}
              className={`px-3 py-1 rounded-full text-xs border transition-colors disabled:opacity-50 ${
                isOn ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
              }`}
            >
              {busy ? "…" : isOn ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        {controlError && (
          <p className="text-xs text-red-400 font-mono break-all">{controlError}</p>
        )}

        {isOn && (
          <>
            {/* Temperature */}
            <div className="flex items-center gap-3">
              <button onClick={() => send({ SetTem: Math.max(16, temp - 1) })} disabled={busy}
                className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center hover:bg-accent text-lg disabled:opacity-50">−</button>
              <div className="flex-1 text-center">
                <span className="text-3xl font-bold">{temp}°</span>
              </div>
              <button onClick={() => send({ SetTem: Math.min(30, temp + 1) })} disabled={busy}
                className="h-8 w-8 rounded-lg bg-secondary flex items-center justify-center hover:bg-accent text-lg disabled:opacity-50">+</button>
            </div>

            {/* Mode */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Mode</p>
              <div className="flex gap-1.5 flex-wrap">
                {AC_MODES.map((m, i) => (
                  <button key={m} onClick={() => send({ Mod: i })} disabled={busy}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors disabled:opacity-50 ${
                      mode === i ? `border-primary bg-primary/10 ${modeColors[i]}` : "border-border text-muted-foreground"
                    }`}>{m}</button>
                ))}
              </div>
            </div>

            {/* Fan speed */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Fan</p>
              <div className="flex gap-1.5 flex-wrap">
                {FAN_SPEEDS.map((s, i) => (
                  <button key={s} onClick={() => send({ WdSpd: i })} disabled={busy}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors disabled:opacity-50 ${
                      fanSpd === i ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                    }`}>{s}</button>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Setup hint ───────────────────────────────────────────────────────────────

function SetupHint() {
  return (
    <Card className="border-amber-500/30">
      <CardContent className="pt-5 flex gap-3">
        <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm space-y-3">
          <p className="font-medium">No home integrations configured yet</p>
          <div>
            <p className="text-xs font-medium mb-1">Smart Life / Tuya (plugs, lights, robot)</p>
            <div className="text-xs font-mono bg-secondary rounded p-2 space-y-0.5">
              <p>TUYA_CLIENT_ID=...</p>
              <p>TUYA_CLIENT_SECRET=...</p>
              <p>TUYA_REGION=eu</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Register free at iot.tuya.com → create project → link Smart Life devices</p>
          </div>
          <div>
            <p className="text-xs font-medium mb-1">Sinclair AC / EWPE Smart</p>
            <div className="text-xs font-mono bg-secondary rounded p-2 space-y-0.5">
              <p>EWPE_EMAIL=...</p>
              <p>EWPE_PASSWORD=...</p>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Same credentials as your EWPE Smart app</p>
          </div>
          <div>
            <p className="text-xs font-medium mb-1">Sonoff RF Bridge (shutters)</p>
            <div className="text-xs font-mono bg-secondary rounded p-2 space-y-0.5">
              <p>EWELINK_EMAIL=...</p>
              <p>EWELINK_PASSWORD=...</p>
              <p>EWELINK_REGION=eu</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [rfDevices,    setRfDevices]    = useState<EwelinkDevice[]>([])
  const [sdmDevices,   setSdmDevices]   = useState<SmartDevice[]>([])
  const [tuyaDevices,  setTuyaDevices]  = useState<TuyaDevice[]>([])
  const [acDevices,    setAcDevices]    = useState<AcDevice[]>([])
  const [errors,       setErrors]       = useState<Record<string, string>>({})
  const [loading,      setLoading]      = useState(true)
  const [notConfigured, setNotConfigured] = useState(false)
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch("/api/home")
      if (res.status === 503) { setNotConfigured(true); setLoading(false); return }
      const data = await res.json()
      setNotConfigured(false)
      setRfDevices((data.ewelink  as EwelinkDevice[]) ?? [])
      setSdmDevices((data.sdm     as SmartDevice[])   ?? [])
      setTuyaDevices((data.tuya   as TuyaDevice[])    ?? [])
      setAcDevices((data.ewpe     as AcDevice[])      ?? [])
      const errs: Record<string, string> = {}
      if (data.ewpeError)    errs["EWPE Smart"] = data.ewpeError
      if (data.tuyaError)    errs["Tuya"] = data.tuyaError
      if (data.ewelinkError) errs["eWeLink"] = data.ewelinkError
      if (data.sdmError)     errs["Nest"] = data.sdmError
      setErrors(errs)
      setLastUpdated(new Date())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleTransmit(deviceId: string, rfChl: number) {
    await fetch("/api/home", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ewelink_rf", deviceId, rfChl }) })
  }

  async function handleSdmCommand(deviceName: string, command: string, params: Record<string, unknown>) {
    await fetch("/api/home", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "sdm", deviceName, command, params }) })
    setTimeout(load, 1000)
  }

  async function handleTuya(deviceId: string, commands: { code: string; value: unknown }[]) {
    await fetch("/api/home", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "tuya", deviceId, commands }) })
    setTimeout(load, 800)
  }

  async function handleAc(deviceId: string, attrs: Record<string, unknown>) {
    await fetch("/api/home", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "ewpe", deviceId, attrs }) })
    setTimeout(load, 1000)
  }

  const rfBridges   = rfDevices.filter((d)  => d.extra?.uiid === RF_BRIDGE_UIID)
  const thermostats = sdmDevices.filter((d)  => d.type.includes("THERMOSTAT"))
  const plugs       = tuyaDevices.filter(isPlug)
  const lights      = tuyaDevices.filter(isLight)
  const robots      = tuyaDevices.filter(isRobot)
  const hasAny      = rfBridges.length + thermostats.length + plugs.length + lights.length + robots.length + acDevices.length > 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Home</h1>
          {lastUpdated && <p className="text-xs text-muted-foreground mt-0.5">Updated {lastUpdated.toLocaleTimeString()}</p>}
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {notConfigured && <SetupHint />}

      {Object.entries(errors).map(([src, msg]) => (
        <Card key={src} className="border-red-500/30">
          <CardContent className="pt-4 pb-4 flex gap-3">
            <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-red-400">{src} error</p>
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{msg}</p>
            </div>
          </CardContent>
        </Card>
      ))}

      {!notConfigured && loading && !hasAny && (
        <p className="text-muted-foreground text-sm py-8 text-center">Loading devices…</p>
      )}

      {lights.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Lightbulb className="h-4 w-4" /> Lights
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lights.map((d) => <LightCard key={d.id} device={d} onControl={handleTuya} />)}
          </div>
        </div>
      )}

      {acDevices.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Thermometer className="h-4 w-4" /> Air Conditioning
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {acDevices.map((d) => <AcCard key={d.deviceId} device={d} onControl={handleAc} />)}
          </div>
        </div>
      )}

      {plugs.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Plug className="h-4 w-4" /> Plugs
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {plugs.map((d) => <PlugCard key={d.id} device={d} onControl={handleTuya} />)}
          </div>
        </div>
      )}

      {robots.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Bot className="h-4 w-4" /> Robot
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {robots.map((d) => <RobotCard key={d.id} device={d} onControl={handleTuya} />)}
          </div>
        </div>
      )}

      {rfBridges.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Radio className="h-4 w-4" /> Shutters
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {rfBridges.map((d) => <RfBridgeCard key={d.deviceid} device={d} onTransmit={handleTransmit} />)}
          </div>
        </div>
      )}

      {thermostats.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Thermometer className="h-4 w-4" /> Climate
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {thermostats.map((d) => <ThermostatCard key={d.name} device={d} onCommand={handleSdmCommand} />)}
          </div>
        </div>
      )}
    </div>
  )
}
