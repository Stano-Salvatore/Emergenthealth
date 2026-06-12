"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  RefreshCw, Server, Cpu, MemoryStick, HardDrive, Thermometer,
  Play, Square, RotateCcw, Wifi, WifiOff, AlertCircle, Activity,
  Database, Container,
} from "lucide-react"
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from "recharts"

// ── Types ─────────────────────────────────────────────────────────────────────

interface SystemData {
  hostname: string
  cpu:  { usage: number; history: number[] }
  ram:  { total: number; used: number; free: number; pct: number; history: number[] }
  temps: { zone: string; temp: number }[]
  disk: { mount: string; size: number; used: number; avail: number; usedPct: number }[]
  uptime: number
  loadAvg: number[]
}

interface DockerContainer {
  Id: string
  Names: string[]
  Image: string
  State: string
  Status: string
  Created: number
}

interface PingResult {
  ok: boolean
  ms: number
  status?: number
}

type PingData = Record<string, PingResult>

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number) {
  if (bytes >= 1e9)  return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6)  return `${(bytes / 1e6).toFixed(0)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

function fmtUptime(secs: number) {
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function containerName(c: DockerContainer) {
  return c.Names?.[0]?.replace(/^\//, "") ?? c.Id.slice(0, 12)
}

function stateColor(state: string) {
  if (state === "running") return "text-green-400"
  if (state === "exited")  return "text-muted-foreground"
  if (state === "paused")  return "text-yellow-400"
  return "text-amber-400"
}

function stateDot(state: string) {
  if (state === "running") return "bg-green-400"
  if (state === "exited")  return "bg-muted-foreground/40"
  return "bg-yellow-400"
}

const DISK_LABELS: Record<string, string> = {
  "/":       "Systém",
  "/data":   "Dátový",
  "/backup": "Záloho...",
  "/var":    "Logy &...",
  "/home":   "Dáta a...",
}

// ── Mini sparkline ────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const pts = data.map((v, i) => ({ i, v }))
  return (
    <ResponsiveContainer width="100%" height={40}>
      <LineChart data={pts}>
        <YAxis domain={[0, 100]} hide />
        <Tooltip
          contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11 }}
          formatter={(v: number) => [`${v}%`]}
          labelFormatter={() => ""}
        />
        <Line type="monotone" dataKey="v" stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Gauge bar ─────────────────────────────────────────────────────────────────

function GaugeBar({ pct, color }: { pct: number; color: string }) {
  const cls =
    color === "cpu"  ? "bg-primary" :
    color === "ram"  ? "bg-amber-400" :
    color === "disk" ? "bg-sky-400" : "bg-primary"
  return (
    <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
      <div
        className={`h-full ${cls} rounded-full transition-all duration-500`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  )
}

// ── NotConfigured ─────────────────────────────────────────────────────────────

function NotConfigured() {
  return (
    <Card className="border-amber-500/30">
      <CardContent className="pt-5 flex gap-3">
        <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-sm space-y-3">
          <p className="font-medium">Server bridge nie je nakonfigurovaný</p>
          <div>
            <p className="text-xs font-medium mb-1">1. Spusti bridge na Lenovo serveri</p>
            <div className="text-xs font-mono bg-secondary rounded p-2 space-y-0.5">
              <p>cd docker/server-bridge</p>
              <p>bash setup.sh</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium mb-1">2. Nastav Vercel env vars</p>
            <div className="text-xs font-mono bg-secondary rounded p-2 space-y-0.5">
              <p>SERVER_BRIDGE_URL=https://&lt;tunnel&gt;.trycloudflare.com</p>
              <p>SERVER_BRIDGE_TOKEN=&lt;secret&gt;</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ServerPage() {
  const [system,    setSystem]    = useState<SystemData | null>(null)
  const [docker,    setDocker]    = useState<DockerContainer[]>([])
  const [pings,     setPings]     = useState<PingData>({})
  const [loading,   setLoading]   = useState(true)
  const [configured, setConfigured] = useState(true)
  const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({})
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const [sysRes, dockerRes, pingRes] = await Promise.all([
        fetch("/api/server?type=system"),
        fetch("/api/server?type=docker"),
        fetch("/api/server?type=ping"),
      ])
      if (sysRes.status === 503) { setConfigured(false); return }
      setConfigured(true)
      const [sys, doc, pin] = await Promise.all([sysRes.json(), dockerRes.json(), pingRes.json()])
      if (!sys.error) setSystem(sys as SystemData)
      if (Array.isArray(doc)) setDocker(doc as DockerContainer[])
      setPings(pin as PingData)
      setLastUpdated(new Date())
    } finally { if (!quiet) setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    intervalRef.current = setInterval(() => load(true), 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [load])

  async function dockerAction(id: string, action: "start" | "stop" | "restart") {
    setActionBusy(b => ({ ...b, [id]: true }))
    await fetch("/api/server", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ containerId: id, action }),
    })
    setActionBusy(b => ({ ...b, [id]: false }))
    load(true)
  }

  const primaryTemp = system?.temps?.find(t =>
    t.zone.toLowerCase().includes("cpu") || t.zone.toLowerCase().includes("core") || t.zone.toLowerCase().includes("x86")
  ) ?? system?.temps?.[0]

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="h-6 w-6 text-primary" />
            Cluster Matrix
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5 tracking-wider uppercase">
            {system?.hostname ?? "Domáci klaster"}
            {lastUpdated && ` · Aktualizované ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => load()} disabled={loading} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Obnoviť
        </Button>
      </div>

      {!configured && <NotConfigured />}

      {configured && (
        <>
          {/* Top row: system + pings */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* CPU */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-primary" /> CPU
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-end justify-between">
                  <span className="text-3xl font-bold">{system?.cpu.usage ?? "—"}<span className="text-base font-normal text-muted-foreground">%</span></span>
                  {system && <span className="text-xs text-muted-foreground">load {system.loadAvg[0].toFixed(2)}</span>}
                </div>
                <GaugeBar pct={system?.cpu.usage ?? 0} color="cpu" />
                {system && <Sparkline data={system.cpu.history} color="hsl(var(--primary))" />}
              </CardContent>
            </Card>

            {/* RAM */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MemoryStick className="h-4 w-4 text-amber-400" /> RAM
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-end justify-between">
                  <span className="text-3xl font-bold">{system?.ram.pct ?? "—"}<span className="text-base font-normal text-muted-foreground">%</span></span>
                  {system && <span className="text-xs text-muted-foreground">{fmtBytes(system.ram.used)} / {fmtBytes(system.ram.total)}</span>}
                </div>
                <GaugeBar pct={system?.ram.pct ?? 0} color="ram" />
                {system && <Sparkline data={system.ram.history} color="#f59e0b" />}
              </CardContent>
            </Card>

            {/* Misc: temps, uptime, pings */}
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="h-4 w-4 text-sky-400" /> Systém
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {primaryTemp && (
                  <div className="flex items-center gap-2">
                    <Thermometer className="h-4 w-4 text-orange-400 shrink-0" />
                    <span className="text-sm font-semibold">{primaryTemp.temp}°C</span>
                    <span className="text-xs text-muted-foreground">{primaryTemp.zone}</span>
                  </div>
                )}
                {system && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground text-xs">Uptime</span>
                    <span className="font-medium">{fmtUptime(system.uptime)}</span>
                  </div>
                )}
                {Object.entries(pings).length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-border/60">
                    {Object.entries(pings).map(([name, p]) => (
                      <div key={name} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {p.ok
                            ? <Wifi    className="h-3 w-3 text-green-400" />
                            : <WifiOff className="h-3 w-3 text-red-400" />
                          }
                          <span className="text-xs truncate max-w-[120px]">{name}</span>
                        </div>
                        <span className={`text-xs font-mono ${p.ok ? "text-muted-foreground" : "text-red-400"}`}>
                          {p.ok ? `${p.ms}ms` : "offline"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

          </div>

          {/* Disk */}
          {system?.disk && system.disk.length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-violet-400" /> Úložisko
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                  {system.disk.map(d => (
                    <div key={d.mount} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{DISK_LABELS[d.mount] ?? d.mount}</span>
                        <span className="text-xs text-muted-foreground">{d.usedPct}%</span>
                      </div>
                      <GaugeBar pct={d.usedPct} color="disk" />
                      <p className="text-[10px] text-muted-foreground">{fmtBytes(d.used)} / {fmtBytes(d.size)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Shared storage summary */}
          {system?.disk && system.disk.length > 0 && (() => {
            const total = system.disk.reduce((s, d) => s + d.size, 0)
            const used  = system.disk.reduce((s, d) => s + d.used, 0)
            const pct   = total > 0 ? Math.round((used / total) * 100) : 0
            return (
              <div className="flex items-center gap-3 px-1">
                <Database className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Spoločné úložisko klastra</span>
                    <span className="text-xs font-mono">{fmtBytes(used)} / {fmtBytes(total)} ({pct}%)</span>
                  </div>
                  <GaugeBar pct={pct} color="disk" />
                </div>
              </div>
            )
          })()}

          {/* Docker containers */}
          <Card>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Container className="h-4 w-4 text-sky-400" />
                Správca kontajnerov
                <span className="ml-auto text-xs font-normal text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                  Docker
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {docker.length === 0 ? (
                <p className="text-sm text-muted-foreground px-6 py-4">
                  {loading ? "Načítavam..." : "Žiadne kontajnery"}
                </p>
              ) : (
                <div className="divide-y divide-border/50">
                  {docker.map(c => {
                    const name   = containerName(c)
                    const busy   = actionBusy[c.Id] ?? false
                    const isUp   = c.State === "running"
                    return (
                      <div key={c.Id} className="flex items-center gap-3 px-6 py-3">
                        <div className={`h-2 w-2 rounded-full shrink-0 ${stateDot(c.State)}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{name}</p>
                          <p className={`text-xs ${stateColor(c.State)}`}>{c.Status}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isUp ? (
                            <>
                              <Button
                                size="sm" variant="outline"
                                className="h-7 px-2.5 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                                disabled={busy}
                                onClick={() => dockerAction(c.Id, "stop")}
                              >
                                Stop
                              </Button>
                              <Button
                                size="sm" variant="outline"
                                className="h-7 px-2.5 text-xs"
                                disabled={busy}
                                onClick={() => dockerAction(c.Id, "restart")}
                              >
                                Reštart
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm" variant="outline"
                              className="h-7 px-2.5 text-xs border-primary/30 text-primary hover:bg-primary/10"
                              disabled={busy}
                              onClick={() => dockerAction(c.Id, "start")}
                            >
                              {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
                              {busy ? "" : "Spustiť"}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
