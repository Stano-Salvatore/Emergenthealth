"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { format, parseISO, subDays, addDays, formatDistanceToNow } from "date-fns"
import { ChevronLeft, ChevronRight, MapPin, Clock, Zap, Navigation, RefreshCw, Trash2, Plus, Search, Settings2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { trackToSvgPath } from "@/lib/gpx"
import { cn } from "@/lib/utils"

interface CheckIn {
  id: string
  place: string
  emoji: string
  note: string | null
  checkedAt: string
  isAuto?: boolean
}

interface SavedPlace {
  id: string
  name: string
  emoji: string
  address: string | null
  lat: number
  lng: number
  radiusM: number
}

interface GeoResult {
  lat: number
  lng: number
  label: string
}

// ── Saved Places Manager ──────────────────────────────────────────────────────
function SavedPlacesManager({ onClose }: { onClose: () => void }) {
  const [places, setPlaces]         = useState<SavedPlace[]>([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [name, setName]             = useState("")
  const [emoji, setEmoji]           = useState("📍")
  const [query, setQuery]           = useState("")
  const [results, setResults]       = useState<GeoResult[]>([])
  const [searching, setSearching]   = useState(false)
  const [picked, setPicked]         = useState<GeoResult | null>(null)
  const [radius, setRadius]         = useState(100)
  const [saving, setSaving]         = useState(false)
  const queryTimer                  = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetch("/api/saved-places")
      .then(r => r.json())
      .then(setPlaces)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const searchGeo = useCallback(async (q: string) => {
    if (q.length < 3) { setResults([]); return }
    setSearching(true)
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`)
      if (r.ok) setResults(await r.json())
    } finally {
      setSearching(false)
    }
  }, [])

  useEffect(() => {
    if (queryTimer.current) clearTimeout(queryTimer.current)
    queryTimer.current = setTimeout(() => searchGeo(query), 500)
    return () => { if (queryTimer.current) clearTimeout(queryTimer.current) }
  }, [query, searchGeo])

  async function handleSave() {
    if (!name.trim() || !picked) return
    setSaving(true)
    try {
      const r = await fetch("/api/saved-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          emoji,
          address: picked.label,
          lat: picked.lat,
          lng: picked.lng,
          radiusM: radius,
        }),
      })
      if (r.ok) {
        const created: SavedPlace = await r.json()
        setPlaces(p => [created, ...p])
        setName(""); setEmoji("📍"); setQuery(""); setPicked(null); setResults([]); setRadius(100)
        setShowForm(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setPlaces(p => p.filter(pl => pl.id !== id))
    await fetch("/api/saved-places", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">Saved Places</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Auto-detected in your GPS tracks every time you visit
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowForm(v => !v)}>
            <Plus className="h-3 w-3"/> Add
          </Button>
          <button onClick={onClose} className="h-7 w-7 rounded-full hover:bg-secondary flex items-center justify-center text-muted-foreground">
            <X className="h-3.5 w-3.5"/>
          </button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-secondary/30 p-4 space-y-3">
          <div className="flex gap-2">
            <Input
              value={emoji}
              onChange={e => setEmoji(e.target.value)}
              className="w-14 h-9 text-center text-lg"
              maxLength={2}
            />
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Place name, e.g. Kaviareň Vták"
              className="flex-1 h-9 text-sm"
            />
          </div>

          {/* Address search */}
          <div className="relative">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
              <Input
                value={picked ? picked.label.slice(0, 60) + (picked.label.length > 60 ? "…" : "") : query}
                onChange={e => { setQuery(e.target.value); setPicked(null) }}
                placeholder="Search address or place…"
                className="h-9 text-sm pl-9"
              />
              {picked && (
                <button onClick={() => { setPicked(null); setQuery("") }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5"/>
                </button>
              )}
            </div>
            {!picked && results.length > 0 && (
              <div className="absolute z-10 w-full bg-popover border border-border rounded-xl shadow-xl mt-1 overflow-hidden">
                {results.map((r, i) => (
                  <button key={i}
                    onClick={() => { setPicked(r); setQuery(""); setResults([]) }}
                    className="w-full text-left px-3 py-2.5 text-xs hover:bg-secondary transition-colors border-b border-border/50 last:border-b-0">
                    <span className="font-medium">{r.label.split(",")[0]}</span>
                    <span className="text-muted-foreground ml-1">{r.label.split(",").slice(1, 3).join(",")}</span>
                  </button>
                ))}
              </div>
            )}
            {searching && <p className="text-xs text-muted-foreground mt-1">Searching…</p>}
          </div>

          {picked && (
            <div className="text-xs text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
              ✓ {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)}
            </div>
          )}

          {/* Radius */}
          <div>
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Detection radius</span>
              <span className="font-medium text-foreground">{radius}m</span>
            </div>
            <input
              type="range" min={20} max={500} step={10} value={radius}
              onChange={e => setRadius(parseInt(e.target.value))}
              className="w-full accent-primary h-1.5"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/60 mt-0.5">
              <span>20m</span><span>500m</span>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleSave}
              disabled={saving || !name.trim() || !picked}>
              {saving ? "Saving…" : "Save place"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
              <div className="h-6 w-6 rounded bg-border shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="h-3.5 rounded bg-border w-32" />
                <div className="h-3 rounded bg-border w-20" />
              </div>
            </div>
          ))}
        </div>
      ) : places.length === 0 ? (
        <div className="rounded-xl border border-dashed p-5 text-center">
          <MapPin className="h-5 w-5 text-muted-foreground/30 mx-auto mb-2"/>
          <p className="text-sm text-muted-foreground">No saved places yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add a place and it&apos;ll be auto-detected in future GPS tracks</p>
        </div>
      ) : (
        <div className="space-y-2">
          {places.map(p => (
            <div key={p.id} className="flex items-center gap-3 group rounded-xl px-3 py-2.5 hover:bg-secondary/40 transition-colors">
              <span className="text-xl shrink-0">{p.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{p.name}</p>
                {p.address && <p className="text-xs text-muted-foreground truncate">{p.address.split(",").slice(0, 2).join(",")}</p>}
              </div>
              <span className="text-xs text-muted-foreground shrink-0">{p.radiusM}m</span>
              <button onClick={() => handleDelete(p.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 p-1">
                <Trash2 className="h-3.5 w-3.5"/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Place-health correlation ──────────────────────────────────────────────────
interface CorrelationResult {
  placeId: string
  placeName: string
  placeEmoji: string
  visitCount: number
  insufficient?: boolean
  visitAvg: { readiness: number | null; sleepHours: number | null; mood: number | null }
  nonVisitAvg: { readiness: number | null; sleepHours: number | null; mood: number | null }
}

function DeltaBadge({ value, suffix }: { value: number; suffix: string }) {
  const pos = value >= 0
  return (
    <span className={`inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded ${pos ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
      {pos ? "+" : ""}{value.toFixed(1)} {suffix}
    </span>
  )
}

function PlaceHealthImpact() {
  const [places, setPlaces] = useState<SavedPlace[]>([])
  const [results, setResults] = useState<CorrelationResult[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const placesRes = await fetch("/api/saved-places").catch(() => null)
        if (!placesRes?.ok) { setLoading(false); return }
        const savedPlaces: SavedPlace[] = await placesRes.json()
        setPlaces(savedPlaces)
        const correlations = await Promise.all(
          savedPlaces.map(p =>
            fetch(`/api/location/correlation?placeId=${p.id}`)
              .then(r => r.json())
              .catch(() => null)
          )
        )
        setResults(correlations.filter((c): c is CorrelationResult => c && !c.insufficient && c.visitCount >= 3))
      } catch {}
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return null

  if (places.length === 0 || results.length === 0) {
    return (
      <div className="mb-6">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Place Health Impact</p>
        <p className="text-xs text-muted-foreground">Visit a saved place 3+ times to see health impact</p>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Place Health Impact</p>
      <div className="space-y-3">
        {results.map(r => {
          const readinessDelta = r.visitAvg.readiness != null && r.nonVisitAvg.readiness != null ? r.visitAvg.readiness - r.nonVisitAvg.readiness : null
          const sleepDelta = r.visitAvg.sleepHours != null && r.nonVisitAvg.sleepHours != null ? r.visitAvg.sleepHours - r.nonVisitAvg.sleepHours : null
          const moodDelta = r.visitAvg.mood != null && r.nonVisitAvg.mood != null ? r.visitAvg.mood - r.nonVisitAvg.mood : null
          return (
            <div key={r.placeId} className="rounded-xl border bg-card px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{r.placeEmoji}</span>
                <p className="font-medium text-sm">{r.placeName}</p>
                <span className="text-xs text-muted-foreground ml-auto">{r.visitCount} visits</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {readinessDelta != null && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span>🎯 Readiness:</span><DeltaBadge value={readinessDelta} suffix="pts" /></div>}
                {sleepDelta != null && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span>😴 Sleep:</span><DeltaBadge value={sleepDelta} suffix="hrs" /></div>}
                {moodDelta != null && <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><span>😊 Mood:</span><DeltaBadge value={moodDelta} suffix="pts" /></div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Check-ins section ─────────────────────────────────────────────────────────
function PlacesSection({ autoTagged }: { autoTagged: { name: string; emoji: string }[] }) {
  const [checkins, setCheckins]   = useState<CheckIn[]>([])
  const [loading, setLoading]     = useState(true)
  const [newPlace, setNewPlace]   = useState("")
  const [adding, setAdding]       = useState(false)
  const [showAdd, setShowAdd]     = useState(false)
  const [showManager, setShowManager] = useState(false)

  const reload = useCallback(() => {
    setLoading(true)
    fetch("/api/checkins?limit=30")
      .then(r => r.json())
      .then(data => setCheckins(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  // Refresh check-ins when auto-tagging creates new entries
  useEffect(() => {
    if (autoTagged.some(t => t)) reload()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTagged.length])

  async function handleAdd() {
    if (!newPlace.trim()) return
    setAdding(true)
    try {
      const res = await fetch("/api/checkins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place: newPlace.trim(), emoji: "📍" }),
      })
      if (res.ok) {
        const created: CheckIn = await res.json()
        setCheckins(prev => [created, ...prev])
        setNewPlace(""); setShowAdd(false)
      }
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: string) {
    setCheckins(prev => prev.filter(c => c.id !== id))
    await fetch("/api/checkins", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
  }

  return (
    <div className="space-y-3">
      {/* Auto-tagged banner */}
      {autoTagged.filter(t => t).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {autoTagged.map((t, i) => (
            <span key={i} className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 rounded-full px-3 py-1">
              ⚡ {t.emoji} {t.name} auto-tagged
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">📍 Places visited</p>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setShowManager(v => !v)}>
            <Settings2 className="h-3.5 w-3.5"/> Saved
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setShowAdd(v => !v)}>
            <Plus className="h-3.5 w-3.5"/> Add
          </Button>
        </div>
      </div>

      {showManager && <SavedPlacesManager onClose={() => setShowManager(false)}/>}

      {showAdd && (
        <div className="flex gap-2">
          <Input value={newPlace} onChange={e => setNewPlace(e.target.value)}
            placeholder="Place name…" className="h-8 text-sm"
            onKeyDown={e => e.key === "Enter" && handleAdd()} autoFocus/>
          <Button size="sm" className="h-8 shrink-0" onClick={handleAdd} disabled={adding || !newPlace.trim()}>
            Save
          </Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-1.5 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg">
              <div className="h-5 w-5 rounded bg-border shrink-0" />
              <div className="h-3.5 rounded bg-border flex-1 max-w-xs" />
              <div className="h-3 rounded bg-border w-16" />
            </div>
          ))}
        </div>
      ) : checkins.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card/30 p-6 text-center">
          <MapPin className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2"/>
          <p className="text-sm text-muted-foreground">No places logged yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Add saved places above to auto-detect visits from your GPS tracks</p>
        </div>
      ) : (
        <div className="space-y-1">
          {checkins.map(c => (
            <div key={c.id} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-secondary/40 transition-colors group">
              <span className="text-lg shrink-0">{c.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium truncate">{c.place}</p>
                  {c.isAuto && (
                    <span className="text-[10px] bg-green-500/10 text-green-400 border border-green-500/20 rounded-full px-1.5 shrink-0">⚡ auto</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(c.checkedAt), { addSuffix: true })}</p>
              </div>
              {c.note && !c.isAuto && <p className="text-xs text-muted-foreground truncate max-w-[120px]">{c.note}</p>}
              <button onClick={() => handleDelete(c.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 p-1 shrink-0">
                <Trash2 className="h-3.5 w-3.5"/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type TrackData = {
  points:      { lat: number; lon: number }[]
  distanceKm:  number
  durationMin: number
  movingMin:   number
  maxSpeedKmh: number
  avgSpeedKmh: number
  startTime:   string | null
  endTime:     string | null
  autoTagged:  { id: string; name: string; emoji: string; isNew: boolean }[]
}

function TrackSvg({ points, width = 800, height = 400 }: { points: { lat: number; lon: number }[]; width?: number; height?: number }) {
  const data = trackToSvgPath(points, width, height, 24)
  if (!data) {
    return (
      <div className="w-full rounded-2xl bg-secondary/30 flex items-center justify-center" style={{ height }}>
        <p className="text-muted-foreground text-sm">Not enough track data</p>
      </div>
    )
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full rounded-2xl"
      style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--primary) 6%, transparent) 0%, color-mix(in srgb, var(--card) 80%, transparent) 100%)" }}>
      <defs>
        <linearGradient id="trackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style={{ stopColor: "var(--primary)" }}/>
          <stop offset="100%" style={{ stopColor: "var(--primary)", stopOpacity: 0.6 }}/>
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path d={data.pathD} fill="none" stroke="var(--primary)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.2"/>
      <path d={data.pathD} fill="none" stroke="url(#trackGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      <circle cx={data.startX} cy={data.startY} r="6" fill="#22c55e" opacity="0.9"/>
      <circle cx={data.startX} cy={data.startY} r="10" fill="#22c55e" opacity="0.2"/>
      <circle cx={data.endX}   cy={data.endY}   r="6" fill="#f43f5e" opacity="0.9"/>
      <circle cx={data.endX}   cy={data.endY}   r="10" fill="#f43f5e" opacity="0.2"/>
    </svg>
  )
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border px-4 py-3 card-health">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

export default function LocationPage() {
  const [date, setDate]           = useState(() => new Date().toISOString().split("T")[0])
  const [track, setTrack]         = useState<TrackData | null>(null)
  const [loading, setLoading]     = useState(true)
  const [availDates, setAvailDates] = useState<string[]>([])

  const load = useCallback(async (d: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/location?date=${d}`)
      setTrack(res.ok ? await res.json() : null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch("/api/location?list=1").then(r => r.json()).then(setAvailDates).catch(() => {})
  }, [])

  useEffect(() => { load(date) }, [date, load])

  function prevDay() { setDate(d => format(subDays(parseISO(d), 1), "yyyy-MM-dd")) }
  function nextDay() { setDate(d => format(addDays(parseISO(d), 1), "yyyy-MM-dd")) }
  const isToday = date === new Date().toISOString().split("T")[0]

  const formatDuration = (min: number) => {
    if (min < 60) return `${Math.round(min)}m`
    return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Location</h1>
          <p className="text-muted-foreground text-sm mt-0.5">GPS track from GPSLogger · places auto-detected</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={prevDay}>
            <ChevronLeft className="h-4 w-4"/>
          </Button>
          <span className="text-sm font-semibold min-w-[120px] text-center">
            {format(parseISO(date), "EEE, MMM d yyyy")}
          </span>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={nextDay} disabled={isToday}>
            <ChevronRight className="h-4 w-4"/>
          </Button>
          {!isToday && (
            <Button size="sm" variant="outline" onClick={() => setDate(new Date().toISOString().split("T")[0])}>Today</Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => load(date)} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")}/>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="w-full rounded-2xl bg-secondary/30 flex items-center justify-center" style={{ height: 320 }}>
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground"/>
        </div>
      ) : !track || track.points.length < 2 ? (
        <div className="w-full rounded-2xl border bg-card flex flex-col items-center justify-center gap-3" style={{ height: 320 }}>
          <MapPin className="h-8 w-8 text-muted-foreground/40"/>
          <p className="text-muted-foreground">No GPS data for {format(parseISO(date), "MMM d")}</p>
          {availDates.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Latest available:{" "}
              <button className="text-primary underline" onClick={() => setDate(availDates[0])}>
                {format(parseISO(availDates[0]), "MMM d yyyy")}
              </button>
            </p>
          )}
        </div>
      ) : (
        <TrackSvg points={track.points} width={800} height={320}/>
      )}

      {track && track.points.length >= 2 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={<Navigation className="h-3.5 w-3.5"/>} label="Distance" value={`${track.distanceKm.toFixed(2)} km`}/>
            <StatCard icon={<Clock className="h-3.5 w-3.5"/>} label="Moving time" value={formatDuration(track.movingMin)} sub={`Total: ${formatDuration(track.durationMin)}`}/>
            <StatCard icon={<Zap className="h-3.5 w-3.5"/>} label="Avg speed" value={`${track.avgSpeedKmh.toFixed(1)} km/h`}/>
            <StatCard icon={<Zap className="h-3.5 w-3.5"/>} label="Max speed" value={`${track.maxSpeedKmh.toFixed(1)} km/h`}/>
          </div>
          {track.startTime && track.endTime && (
            <p className="text-xs text-muted-foreground">
              {format(parseISO(track.startTime), "HH:mm")} → {format(parseISO(track.endTime), "HH:mm")}
              &nbsp;·&nbsp;{track.points.length} GPS points recorded
            </p>
          )}
        </>
      )}

      {availDates.length > 1 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recent days</p>
          <div className="flex flex-wrap gap-2">
            {availDates.map(d => (
              <button key={d} onClick={() => setDate(d)}
                className={cn(
                  "text-xs px-3 py-1.5 rounded-lg border transition-all",
                  d === date
                    ? "bg-primary/15 border-primary/30 text-primary font-semibold"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                )}>
                {format(parseISO(d), "MMM d")}
              </button>
            ))}
          </div>
        </div>
      )}

      <PlacesSection autoTagged={track?.autoTagged ?? []}/>
      <PlaceHealthImpact />
    </div>
  )
}
