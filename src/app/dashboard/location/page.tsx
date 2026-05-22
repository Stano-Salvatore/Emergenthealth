"use client"

import { useEffect, useState, useCallback } from "react"
import { format, parseISO, subDays, addDays } from "date-fns"
import { ChevronLeft, ChevronRight, MapPin, Clock, Zap, Navigation, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { trackToSvgPath } from "@/lib/gpx"

type TrackData = {
  points: { lat: number; lon: number }[]
  distanceKm: number
  durationMin: number
  movingMin: number
  maxSpeedKmh: number
  avgSpeedKmh: number
  startTime: string | null
  endTime: string | null
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
      style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(16,15,26,0.8) 100%)" }}>
      <defs>
        <linearGradient id="trackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#a78bfa" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Glow copy */}
      <path d={data.pathD} fill="none" stroke="#818cf8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.2" />
      {/* Main track */}
      <path d={data.pathD} fill="none" stroke="url(#trackGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Start */}
      <circle cx={data.startX} cy={data.startY} r="6" fill="#22c55e" opacity="0.9" />
      <circle cx={data.startX} cy={data.startY} r="10" fill="#22c55e" opacity="0.2" />
      {/* End */}
      <circle cx={data.endX} cy={data.endY} r="6" fill="#f43f5e" opacity="0.9" />
      <circle cx={data.endX} cy={data.endY} r="10" fill="#f43f5e" opacity="0.2" />
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
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0])
  const [track, setTrack] = useState<TrackData | null>(null)
  const [loading, setLoading] = useState(true)
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
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Location</h1>
          <p className="text-muted-foreground text-sm mt-0.5">GPS track from GPSLogger</p>
        </div>

        {/* Date nav */}
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={prevDay}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold min-w-[120px] text-center">
            {format(parseISO(date), "EEE, MMM d yyyy")}
          </span>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={nextDay} disabled={isToday}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          {!isToday && (
            <Button size="sm" variant="outline" onClick={() => setDate(new Date().toISOString().split("T")[0])}>
              Today
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => load(date)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Track SVG */}
      {loading ? (
        <div className="w-full rounded-2xl bg-secondary/30 flex items-center justify-center" style={{ height: 320 }}>
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !track || track.points.length < 2 ? (
        <div className="w-full rounded-2xl border bg-card flex flex-col items-center justify-center gap-3" style={{ height: 320 }}>
          <MapPin className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-muted-foreground">No GPS data for {format(parseISO(date), "MMM d")}</p>
          {availDates.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Latest available: <button className="text-primary underline" onClick={() => setDate(availDates[0])}>{format(parseISO(availDates[0]), "MMM d yyyy")}</button>
            </p>
          )}
        </div>
      ) : (
        <TrackSvg points={track.points} width={800} height={320} />
      )}

      {/* Stats */}
      {track && track.points.length >= 2 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard icon={<Navigation className="h-3.5 w-3.5" />} label="Distance" value={`${track.distanceKm.toFixed(2)} km`} />
            <StatCard icon={<Clock className="h-3.5 w-3.5" />} label="Moving time" value={formatDuration(track.movingMin)} sub={`Total: ${formatDuration(track.durationMin)}`} />
            <StatCard icon={<Zap className="h-3.5 w-3.5" />} label="Avg speed" value={`${track.avgSpeedKmh.toFixed(1)} km/h`} />
            <StatCard icon={<Zap className="h-3.5 w-3.5" />} label="Max speed" value={`${track.maxSpeedKmh.toFixed(1)} km/h`} />
          </div>

          {track.startTime && track.endTime && (
            <p className="text-xs text-muted-foreground">
              {format(parseISO(track.startTime), "HH:mm")} → {format(parseISO(track.endTime), "HH:mm")}
              &nbsp;·&nbsp;{track.points.length} GPS points recorded
            </p>
          )}
        </>
      )}

      {/* Recent days */}
      {availDates.length > 1 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recent days</p>
          <div className="flex flex-wrap gap-2">
            {availDates.map(d => (
              <button key={d} onClick={() => setDate(d)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${d === date ? "bg-primary/15 border-primary/30 text-primary font-semibold" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50"}`}>
                {format(parseISO(d), "MMM d")}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
