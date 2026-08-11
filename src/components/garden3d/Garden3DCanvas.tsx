"use client"

// React wrapper for the procedural 3D garden (scene.js). Same contract the
// page already uses: data / sparkleSignal / onPlantClick. The WebGL canvas is
// transparent so the CSS sky, stars and vignette show through; the sky now
// follows the local clock (dawn/day/dusk/night) as well as the weather.
// If WebGL can't start (old WebViews), falls back to the 2D Pixi canvas.

import { Suspense, lazy, useEffect, useRef, useState } from "react"
import type { EngineData } from "../garden/engine"

const GardenCanvas2D = lazy(() =>
  import("../garden/GardenCanvas").then(m => ({ default: m.GardenCanvas })))

interface Scene {
  update(d: object): void
  sparkle(): void
  feed(): void
  setMoveMode(v: boolean): void
  setFaunaVisible(v: boolean): void
  resize(): void
  destroy(): void
}

const STARS: [number, number][] = [[6,5],[15,10],[26,4],[38,8],[52,3],[64,7],[76,11],[87,5],[94,10],[21,15],[71,16],[91,18],[45,13],[57,17]]

type Phase = "dawn" | "day" | "dusk" | "night"

function phaseFor(hour: number): Phase {
  if (hour < 5.5 || hour >= 21.5) return "night"
  if (hour < 8) return "dawn"
  if (hour < 17.5) return "day"
  return "dusk"
}

const PHASE_SKY: Record<Phase, string> = {
  dawn:  "linear-gradient(180deg,#3a3f63 0%,#7a6a8e 45%,#e8a06a 80%,#f7c789 100%)",
  day:   "linear-gradient(180deg,#4a7dc9 0%,#6fa3dd 55%,#a8cdee 100%)",
  dusk:  "linear-gradient(180deg,#2c3550 0%,#3c4a6e 40%,#6b5f7d 72%,#c98a63 100%)",
  night: "linear-gradient(180deg,#0d1120 0%,#1a2138 55%,#2c3654 100%)",
}

const STAR_ALPHA: Record<Phase, number> = { dawn: 0.15, day: 0, dusk: 0.7, night: 1 }

function skyFor(code: number | null, phase: Phase): string {
  // real weather overrides the clear-sky phase look
  if (code != null && code > 3) {
    if (code <= 48) return "linear-gradient(180deg,#3e4a5e 0%,#66748a 60%,#98a2b1 100%)"
    if (code <= 67) return "linear-gradient(180deg,#1e2738 0%,#35435c 60%,#526078 100%)"
    if (code <= 77) return "linear-gradient(180deg,#5a6c8e 0%,#9fb2cc 60%,#cfd9e8 100%)"
    if (code > 82) return "linear-gradient(180deg,#121724 0%,#20283c 60%,#333e52 100%)"
  }
  return PHASE_SKY[phase]
}

// Each of the app's plant types renders on one of the scene's archetypes,
// with an optional petal-material override for the bloom color.
const PLANT_KIND: Record<string, { kind: string; petal?: string }> = {
  sunflower: { kind: "tulip", petal: "yellow" },
  rose:      { kind: "rose" },
  cactus:    { kind: "bush" },
  mushroom:  { kind: "herb" },
  bamboo:    { kind: "lavender" },
  sakura:    { kind: "rose", petal: "pink" },
  oak:       { kind: "bush" },
  tulip:     { kind: "tulip" },
  fern:      { kind: "herb" },
  bonsai:    { kind: "bush" },
}

// App stage (0 wilt, 1 seed, 2 sprout, 3 growing, 4 bloom, 5 max) → scene
// stage (0 mound, 1 sprout, 2 seedling, 3 buds, 4 budding, 5 blooming).
// Wilting renders its own drooping look via the wilted flag.
// Seed used to map to the bare soil mound and sprout to a two-leaf nub, so a
// young plant was nearly invisible — each app stage now shows one scene
// stage further along.
const STAGE_MAP = [0, 1, 2, 3, 4, 5]

// ?gardenHour=23 previews any time of day (also used by tests)
function hourOverride(): number | null {
  if (typeof window === "undefined") return null
  const v = new URLSearchParams(window.location.search).get("gardenHour")
  const n = v == null ? NaN : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function toSceneData(d: EngineData) {
  return {
    weatherCode: d.weatherCode ?? null,
    hour: hourOverride(),
    level: d.level,
    decorations: d.decorations,
    fedToday: d.fedToday ?? false,
    placed: d.placed ?? {},
    habits: d.habits.map(h => {
      const map = PLANT_KIND[h.plantKey] ?? PLANT_KIND.sunflower
      return {
        id: h.id,
        label: h.name,
        streak: h.streak,
        stage: STAGE_MAP[h.stage] ?? 3,
        wilted: h.stage === 0,
        kind: map.kind,
        petal: map.petal ?? null,
        pos: d.placed?.[h.id] ?? null,
      }
    }),
  }
}

export interface Garden3DCanvasProps {
  data: EngineData | null
  sparkleSignal: number
  feedSignal?: number
  moveMode?: boolean
  onPlantClick: (habitId: string) => void
  onPlantMoved?: (habitId: string, cell: { x: number; y: number }) => void
}

export function Garden3DCanvas({ data, sparkleSignal, feedSignal = 0, moveMode = false, onPlantClick, onPlantMoved }: Garden3DCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const cbRef = useRef({ onPlantClick, onPlantMoved })
  const pending = useRef<EngineData | null>(null)
  const [fallback2D, setFallback2D] = useState(false)
  const [hour, setHour] = useState(() => hourOverride() ?? new Date().getHours() + new Date().getMinutes() / 60)
  useEffect(() => { cbRef.current = { onPlantClick, onPlantMoved } }, [onPlantClick, onPlantMoved])

  // tick the local clock so the sky phase follows along
  useEffect(() => {
    const id = setInterval(() => {
      setHour(hourOverride() ?? new Date().getHours() + new Date().getMinutes() / 60)
    }, 60000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (fallback2D) return
    let cancelled = false
    const host = hostRef.current
    if (!host) return
    // dynamic import keeps three.js out of the initial bundle
    import("./scene").then(({ createGardenScene }) =>
      createGardenScene(host, {
        onPlantClick: (id: string) => cbRef.current.onPlantClick(id),
        onPlantMoved: (id: string, cell: { x: number; y: number }) => cbRef.current.onPlantMoved?.(id, cell),
      })
    ).then((scene: Scene) => {
      if (cancelled) { scene.destroy(); return }
      sceneRef.current = scene
      scene.setMoveMode(moveModeRef.current)
      if (pending.current) scene.update(toSceneData(pending.current))
    }).catch(() => {
      // WebGL unavailable — use the 2D canvas instead of a blank box
      if (!cancelled) setFallback2D(true)
    })
    return () => {
      cancelled = true
      sceneRef.current?.destroy()
      sceneRef.current = null
    }
  }, [fallback2D])

  useEffect(() => {
    if (!data) return
    pending.current = data
    sceneRef.current?.update(toSceneData(data))
  }, [data])

  const lastSparkle = useRef(0)
  useEffect(() => {
    if (sparkleSignal > 0 && sparkleSignal !== lastSparkle.current) {
      lastSparkle.current = sparkleSignal
      sceneRef.current?.sparkle()
    }
  }, [sparkleSignal])

  const lastFeed = useRef(0)
  useEffect(() => {
    if (feedSignal > 0 && feedSignal !== lastFeed.current) {
      lastFeed.current = feedSignal
      sceneRef.current?.feed()
    }
  }, [feedSignal])

  // ref keeps the just-created scene in sync even before this effect runs
  const moveModeRef = useRef(moveMode)
  useEffect(() => {
    moveModeRef.current = moveMode
    sceneRef.current?.setMoveMode(moveMode)
  }, [moveMode])

  if (fallback2D) {
    return (
      <Suspense fallback={null}>
        <GardenCanvas2D data={data} editMode={moveMode} sparkleSignal={sparkleSignal}
          onPlantClick={onPlantClick}
          onPlaced={placed => {
            for (const [id, cell] of Object.entries(placed)) cbRef.current.onPlantMoved?.(id, cell)
          }} />
      </Suspense>
    )
  }

  const phase = phaseFor(hour)
  const sky = skyFor(data?.weatherCode ?? null, phase)
  const starAlpha = STAR_ALPHA[phase]

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: "inherit" }}>
      <div className="absolute inset-0" style={{ background: sky, transition: "background 2s" }} />
      {starAlpha > 0 && STARS.map(([x, y], i) => (
        <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: i % 3 ? 2 : 3,
          height: i % 3 ? 2 : 3, borderRadius: "50%", background: "#fff",
          opacity: (0.3 + (i % 4) * 0.15) * starAlpha, transition: "opacity 2s" }} />
      ))}

      {/* WebGL scene — sun, moon, string lights and lanterns live in here */}
      <div ref={hostRef} className="absolute inset-0" style={{ zIndex: 10, touchAction: "none" }} />

      {/* Warm wash + vignette (softer in full daylight) */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 22,
        background: "radial-gradient(ellipse at 50% 50%, rgba(255,170,80,0.08), transparent 60%)" }} />
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 23,
        boxShadow: phase === "day" ? "inset 0 0 90px rgba(12,9,28,0.35)" : "inset 0 0 130px rgba(12,9,28,0.62)",
        borderRadius: "inherit", transition: "box-shadow 2s" }} />
    </div>
  )
}
