"use client"

import { useCallback, useEffect, useState } from "react"
import { format, parseISO } from "date-fns"
import {
  Bike, Bus, Car, Check, Footprints, MapPin, Navigation, Plane, TrainFront, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// The day read top to bottom: at home, walking, on a bus, at the café.
//
// The map above this answers "which way did I go", which is the question
// nobody asks about their own Tuesday. This answers "what did I do", and the
// difference is names and durations rather than a shape.
//
// Two things here are deliberately not presented as fact. A travel mode
// inferred from speed is a guess wherever speed cannot settle it — a bus and a
// car drive the same roads — so guesses are underlined and one tap corrects
// them for good. And an unnamed stay says "near Michalská", the street, rather
// than pretending to know the venue: reverse geocoding a GPS centroid returns
// the road it sits on, and dressing that up as "you were at Michalská" would
// be a confident lie. Naming it is one tap too, and then it is named for ever.

export type TravelMode =
  | "walk" | "run" | "cycle" | "transit" | "drive" | "train" | "flight" | "unknown"

export interface JourneyStay {
  kind: "stay"
  start: string
  end: string
  minutes: number
  lat: number
  lon: number
  label: string | null
  emoji: string | null
  savedPlaceId: string | null
}

export interface JourneyMove {
  kind: "move"
  start: string
  end: string
  minutes: number
  mode: TravelMode
  confidence: "known" | "likely" | "guess"
  distanceM: number
  topKmh: number
  avgKmh: number
}

export interface JourneyGap {
  kind: "gap"
  start: string
  end: string
  minutes: number
}

export type JourneySegment = JourneyStay | JourneyMove | JourneyGap

const MODE_ICON: Record<TravelMode, typeof Footprints> = {
  walk: Footprints,
  run: Footprints,
  cycle: Bike,
  transit: Bus,
  drive: Car,
  train: TrainFront,
  flight: Plane,
  unknown: Navigation,
}

const MODE_LABEL: Record<TravelMode, string> = {
  walk: "Walking",
  run: "Running",
  cycle: "Cycling",
  transit: "On a bus or tram",
  drive: "Driving",
  train: "On a train",
  flight: "Flying",
  unknown: "On the move",
}

/** The modes offered when correcting one. "unknown" is not a correction. */
const CORRECTIONS: TravelMode[] = ["walk", "run", "cycle", "transit", "drive", "train", "flight"]

function hhmm(iso: string): string {
  return format(parseISO(iso), "HH:mm")
}

function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`
}

function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`
}

/**
 * The rail: a numbered stop for a stay, the mode's icon for a move, a hollow
 * dashed dot for a gap.
 *
 * Stays carry the same ordinal as the markers on the map above, because they
 * are the same stops in the same order. Without it the map's "3" had nothing
 * to point at once this list stopped being a numbered one.
 */
function Rail({ seg, isFirst, isLast, ordinal }: {
  seg: JourneySegment
  isFirst: boolean
  isLast: boolean
  ordinal?: number
}) {
  const dashed = seg.kind !== "stay"
  return (
    <div className="relative w-6 shrink-0 flex justify-center">
      <div
        className={cn(
          "absolute w-0 border-l",
          dashed ? "border-dashed border-border" : "border-solid border-border/60",
          isFirst && isLast ? "hidden" : isFirst ? "top-4 bottom-0" : isLast ? "top-0 h-4" : "inset-y-0",
        )}
      />
      {seg.kind === "stay" ? (
        <span className="relative mt-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-primary bg-card text-[9px] font-semibold">
          {ordinal}
        </span>
      ) : seg.kind === "move" ? (
        (() => {
          const Icon = MODE_ICON[seg.mode]
          return (
            <span className="relative mt-1 grid h-6 w-6 place-items-center rounded-full border bg-background">
              <Icon className="h-3 w-3 text-muted-foreground" />
            </span>
          )
        })()
      ) : (
        <span className="relative mt-1.5 h-2.5 w-2.5 rounded-full border border-dashed border-muted-foreground/50 bg-background" />
      )}
    </div>
  )
}

function Row({ seg, isFirst, isLast, ordinal, children }: {
  seg: JourneySegment
  isFirst: boolean
  isLast: boolean
  ordinal?: number
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-2">
      <div className="w-10 shrink-0 pt-1 text-right text-[11px] tabular-nums text-muted-foreground/70">
        {hhmm(seg.start)}
      </div>
      <Rail seg={seg} isFirst={isFirst} isLast={isLast} ordinal={ordinal} />
      <div className="min-w-0 flex-1 pb-4">{children}</div>
    </div>
  )
}

/**
 * A stay's name, found lazily.
 *
 * Saved places are named on the server, for free. Everything else needs
 * Nominatim, whose courtesy limit is one request a second — so the lookups
 * happen here, one at a time, after the day has already rendered. A stay shows
 * its duration immediately and grows a name a moment later, which is far
 * better than five stops holding the whole page for five seconds.
 */
function useStreetNames(stays: JourneyStay[]) {
  const [names, setNames] = useState<Record<string, string>>({})
  const wanted = stays.filter(s => !s.label).map(s => s.start).join("|")

  useEffect(() => {
    let cancelled = false
    const pending = stays.filter(s => !s.label)

    async function run() {
      for (const stay of pending) {
        if (cancelled) return
        const res = await fetch(
          `/api/location/place-name?lat=${stay.lat}&lng=${stay.lon}&precision=street`,
        ).catch(() => null)
        const data = res?.ok ? await res.json().catch(() => null) : null
        if (cancelled) return
        if (data?.label) setNames(prev => ({ ...prev, [stay.start]: data.label }))
        // Cached answers come back instantly and need no throttling; only a
        // real lookup owes Nominatim the pause it asks for.
        if (!data?.cached) await new Promise(r => setTimeout(r, 1100))
      }
    }
    run()
    return () => { cancelled = true }
  // `wanted` is the identity of the set to look up; the array itself is new
  // on every render of the parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted])

  return names
}

function StaySegment({ stay, streetName, onSaved }: {
  stay: JourneyStay
  streetName: string | undefined
  onSaved: () => void
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const res = await fetch("/api/saved-places", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          emoji: "📍",
          lat: stay.lat,
          lng: stay.lon,
          // Wider than the 100 m default: this centroid is the middle of where
          // the fixes landed, and the next visit's centroid will not be in
          // exactly the same spot.
          radiusM: 150,
        }),
      })
      if (res.ok) { setNaming(false); onSaved() }
    } finally {
      setSaving(false)
    }
  }

  const title = stay.label ?? (streetName ? `Near ${streetName}` : "Somewhere")

  return (
    <div>
      <p className="text-sm font-semibold leading-tight">
        {stay.emoji ? `${stay.emoji} ` : ""}{title}
      </p>
      <p className="text-xs text-muted-foreground">
        {formatDuration(stay.minutes)} · until {hhmm(stay.end)}
      </p>

      {!stay.label && !naming && (
        <button
          className="mt-1 text-[11px] text-primary/80 hover:text-primary hover:underline"
          onClick={() => { setNaming(true); setName(streetName ?? "") }}
        >
          <MapPin className="mr-1 inline h-3 w-3" />Name this place
        </button>
      )}

      {naming && (
        <div className="mt-1.5 flex gap-1.5">
          <Input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") save()
              if (e.key === "Escape") setNaming(false)
            }}
            placeholder="Kaviareň Vták…"
            className="h-7 text-xs"
          />
          <Button size="sm" className="h-7 shrink-0 px-2" disabled={saving || !name.trim()} onClick={save}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" onClick={() => setNaming(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

function MoveSegment({ move, date, onCorrected }: {
  move: JourneyMove
  date: string
  onCorrected: (start: string, mode: TravelMode) => void
}) {
  const [picking, setPicking] = useState(false)
  const guess = move.confidence === "guess"

  async function correct(mode: TravelMode) {
    setPicking(false)
    onCorrected(move.start, mode)
    await fetch("/api/location/journey-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, start: move.start, mode }),
    }).catch(() => null)
  }

  return (
    <div>
      <button
        className="text-left"
        onClick={() => setPicking(v => !v)}
        title="Not right? Tap to correct."
      >
        <span
          className={cn(
            "text-sm",
            guess
              ? "text-muted-foreground underline decoration-dotted underline-offset-4"
              : "text-foreground",
          )}
        >
          {MODE_LABEL[move.mode]}
        </span>
      </button>
      <p className="text-xs text-muted-foreground">
        {formatDuration(move.minutes)}
        {move.distanceM > 0 && ` · ${formatDistance(move.distanceM)}`}
        {move.avgKmh > 0 && ` · ${move.avgKmh.toFixed(0)} km/h avg`}
      </p>

      {picking && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {CORRECTIONS.map(m => {
            const Icon = MODE_ICON[m]
            return (
              <button
                key={m}
                onClick={() => correct(m)}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] transition-colors",
                  m === move.mode ? "border-primary/50 bg-primary/10" : "hover:bg-secondary",
                )}
              >
                <Icon className="h-3 w-3" />{MODE_LABEL[m]}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function DayJourney({ date, journey, onPlaceSaved }: {
  date: string
  journey: JourneySegment[]
  onPlaceSaved?: () => void
}) {
  // Corrections apply immediately and outlive the request that saves them, so
  // tapping "bus" does not flash back to "driving" while the POST is in flight.
  //
  // The day they belong to is carried alongside them rather than cleared by an
  // effect when the date changes. Two segments on different days can share a
  // start instant — the same clock time, a week apart — and an effect that
  // resets after the render has already happened would show one day's
  // correction on the other for a frame.
  const [corrections, setCorrections] = useState<{ date: string; byStart: Record<string, TravelMode> }>(
    { date, byStart: {} },
  )
  const applied = corrections.date === date ? corrections.byStart : {}

  const stays = journey.filter((s): s is JourneyStay => s.kind === "stay")
  const streetNames = useStreetNames(stays)

  const onCorrected = useCallback((start: string, mode: TravelMode) => {
    setCorrections(prev => ({
      date,
      byStart: { ...(prev.date === date ? prev.byStart : {}), [start]: mode },
    }))
  }, [date])

  if (journey.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Not enough tracking on this day to tell the story of it.
      </p>
    )
  }

  let stayNo = 0
  return (
    <div>
      {journey.map((seg, i) => {
        const isFirst = i === 0
        const isLast = i === journey.length - 1
        const ordinal = seg.kind === "stay" ? ++stayNo : undefined
        return (
          <Row key={`${seg.kind}-${seg.start}`} seg={seg} isFirst={isFirst} isLast={isLast} ordinal={ordinal}>
            {seg.kind === "stay" ? (
              <StaySegment
                stay={seg}
                streetName={streetNames[seg.start]}
                onSaved={() => onPlaceSaved?.()}
              />
            ) : seg.kind === "move" ? (
              <MoveSegment
                move={applied[seg.start]
                  ? { ...seg, mode: applied[seg.start], confidence: "known" }
                  : seg}
                date={date}
                onCorrected={onCorrected}
              />
            ) : (
              <div>
                <p className="text-sm text-muted-foreground/70">No tracking</p>
                <p className="text-xs text-muted-foreground/50">
                  {formatDuration(seg.minutes)} · resumes {hhmm(seg.end)}
                </p>
              </div>
            )}
          </Row>
        )
      })}
    </div>
  )
}
