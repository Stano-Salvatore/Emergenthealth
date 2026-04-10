"use client"

import { useCallback, useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { RefreshCw, Lightbulb, Thermometer, ToggleLeft, ToggleRight, Radio, Tv, Wind, AlertCircle } from "lucide-react"

interface HaEntity {
  entity_id: string
  state: string
  attributes: Record<string, string | number | boolean | null>
}

const DOMAIN_CONFIG: Record<string, {
  label: string
  icon: React.ElementType
  color: string
  show: (e: HaEntity) => boolean
}> = {
  light:        { label: "Lights",       icon: Lightbulb,   color: "text-yellow-400", show: () => true },
  switch:       { label: "Switches",     icon: ToggleLeft,  color: "text-blue-400",   show: () => true },
  climate:      { label: "Climate",      icon: Thermometer, color: "text-orange-400", show: () => true },
  media_player: { label: "Media",        icon: Tv,          color: "text-purple-400", show: () => true },
  fan:          { label: "Fans",         icon: Wind,        color: "text-cyan-400",   show: () => true },
  sensor:       { label: "Sensors",      icon: Radio,       color: "text-green-400",  show: (e) => e.state !== "unavailable" },
}

const DOMAIN_ORDER = ["light", "switch", "climate", "fan", "media_player", "sensor"]

function friendlyName(entity: HaEntity): string {
  return String(entity.attributes.friendly_name ?? entity.entity_id.split(".")[1].replace(/_/g, " "))
}

function domain(entity_id: string) {
  return entity_id.split(".")[0]
}

function isToggleable(d: string) {
  return d === "light" || d === "switch" || d === "fan"
}

function stateColor(state: string, d: string) {
  if (state === "unavailable" || state === "unknown") return "text-muted-foreground"
  if (d === "light" || d === "switch" || d === "fan") return state === "on" ? "text-yellow-400" : "text-muted-foreground"
  return "text-foreground"
}

function formatState(entity: HaEntity, d: string): string {
  const { state, attributes } = entity
  if (state === "unavailable") return "unavailable"
  if (d === "climate") {
    const cur = attributes.current_temperature
    const set = attributes.temperature
    const mode = state
    return `${cur != null ? cur + "°" : "—"} → ${set != null ? set + "°" : "—"} (${mode})`
  }
  if (d === "sensor") {
    const unit = attributes.unit_of_measurement
    return unit ? `${state} ${unit}` : state
  }
  if (d === "media_player") {
    if (state === "playing") {
      const title = attributes.media_title
      return title ? `Playing: ${title}` : "Playing"
    }
    return state
  }
  return state
}

export default function HomePage() {
  const [entities, setEntities] = useState<HaEntity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/home")
      const data = await res.json()
      if (!res.ok) { setError(data.error); setEntities([]); return }
      setEntities(data)
      setLastUpdated(new Date())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(entity: HaEntity) {
    const d = domain(entity.entity_id)
    setToggling(entity.entity_id)
    try {
      await fetch("/api/home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: d, service: "toggle", entity_id: entity.entity_id }),
      })
      // Optimistic update
      setEntities((prev) =>
        prev.map((e) =>
          e.entity_id === entity.entity_id
            ? { ...e, state: e.state === "on" ? "off" : "on" }
            : e
        )
      )
      setTimeout(load, 1500)
    } finally {
      setToggling(null)
    }
  }

  const grouped = DOMAIN_ORDER.reduce((acc, d) => {
    const cfg = DOMAIN_CONFIG[d]
    const items = entities.filter((e) => domain(e.entity_id) === d && cfg.show(e))
    if (items.length) acc[d] = items
    return acc
  }, {} as Record<string, HaEntity[]>)

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

      {error && (
        <Card className="border-destructive/50">
          <CardContent className="pt-5 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-destructive">Home Assistant not connected</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
              <p className="text-xs text-muted-foreground mt-2">
                Add <code className="bg-secondary px-1 rounded">HA_URL</code> and{" "}
                <code className="bg-secondary px-1 rounded">HA_TOKEN</code> to your environment variables.
                Get a long-lived token from your HA profile page.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!error && loading && entities.length === 0 && (
        <div className="text-muted-foreground text-sm py-8 text-center">Loading devices…</div>
      )}

      {Object.entries(grouped).map(([d, items]) => {
        const cfg = DOMAIN_CONFIG[d]
        const Icon = cfg.icon
        const toggleable = isToggleable(d)
        const onCount = items.filter((e) => e.state === "on").length

        return (
          <Card key={d}>
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Icon className={`h-4 w-4 ${cfg.color}`} />
                {cfg.label}
                {toggleable && (
                  <span className="text-xs font-normal text-muted-foreground ml-auto">
                    {onCount}/{items.length} on
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {items.map((entity) => {
                  const d2 = domain(entity.entity_id)
                  const isOn = entity.state === "on"
                  const canToggle = toggleable && entity.state !== "unavailable"

                  return (
                    <button
                      key={entity.entity_id}
                      onClick={() => canToggle && toggle(entity)}
                      disabled={!canToggle || toggling === entity.entity_id}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        isOn
                          ? "border-primary/40 bg-primary/5"
                          : "border-border bg-secondary/50 hover:bg-secondary"
                      } ${canToggle ? "cursor-pointer" : "cursor-default"} ${
                        toggling === entity.entity_id ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-medium leading-tight truncate">
                          {friendlyName(entity)}
                        </p>
                        {toggleable && (
                          isOn
                            ? <ToggleRight className="h-3.5 w-3.5 text-primary shrink-0" />
                            : <ToggleLeft className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                      </div>
                      <p className={`text-xs mt-1 ${stateColor(entity.state, d2)}`}>
                        {formatState(entity, d2)}
                      </p>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
