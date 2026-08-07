"use client"

// React wrapper for the procedural 3D garden (scene.js). Same contract the
// page already uses: data / sparkleSignal / onPlantClick. The WebGL canvas is
// transparent so the CSS sky, stars and vignette show through, keeping the
// app's cozy dusk identity.

import { useEffect, useRef } from "react"
import type { EngineData } from "../garden/engine"

interface Scene {
  update(d: object): void
  sparkle(): void
  setFaunaVisible(v: boolean): void
  resize(): void
  destroy(): void
}

const STARS: [number, number][] = [[6,5],[15,10],[26,4],[38,8],[52,3],[64,7],[76,11],[87,5],[94,10],[21,15],[71,16],[91,18],[45,13],[57,17]]

function skyFor(code: number | null): string {
  if (code == null || code <= 1) return "linear-gradient(180deg,#2c3550 0%,#3c4a6e 40%,#6b5f7d 72%,#c98a63 100%)"
  if (code <= 3)  return "linear-gradient(180deg,#2b3550 0%,#4a5877 55%,#8d8398 100%)"
  if (code <= 48) return "linear-gradient(180deg,#3e4a5e 0%,#66748a 60%,#98a2b1 100%)"
  if (code <= 67) return "linear-gradient(180deg,#1e2738 0%,#35435c 60%,#526078 100%)"
  if (code <= 77) return "linear-gradient(180deg,#5a6c8e 0%,#9fb2cc 60%,#cfd9e8 100%)"
  return "linear-gradient(180deg,#121724 0%,#20283c 60%,#333e52 100%)"
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
// Wilting collapses back to the bare mound.
const STAGE_MAP = [0, 0, 1, 3, 4, 5]

function toSceneData(d: EngineData) {
  return {
    weatherCode: d.weatherCode ?? null,
    isDay: (() => { const h = new Date().getHours(); return h >= 7 && h < 20 })(),
    decorations: d.decorations,
    habits: d.habits.map(h => {
      const map = PLANT_KIND[h.plantKey] ?? PLANT_KIND.sunflower
      return {
        id: h.id,
        label: h.name,
        stage: STAGE_MAP[h.stage] ?? 3,
        kind: map.kind,
        petal: map.petal ?? null,
      }
    }),
  }
}

export interface Garden3DCanvasProps {
  data: EngineData | null
  sparkleSignal: number
  onPlantClick: (habitId: string) => void
}

export function Garden3DCanvas({ data, sparkleSignal, onPlantClick }: Garden3DCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Scene | null>(null)
  const cbRef = useRef(onPlantClick)
  const pending = useRef<EngineData | null>(null)
  useEffect(() => { cbRef.current = onPlantClick }, [onPlantClick])

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return
    // dynamic import keeps three.js out of the initial bundle
    import("./scene").then(({ createGardenScene }) =>
      createGardenScene(host, { onPlantClick: (id: string) => cbRef.current(id) })
    ).then((scene: Scene) => {
      if (cancelled) { scene.destroy(); return }
      sceneRef.current = scene
      if (pending.current) scene.update(toSceneData(pending.current))
    })
    return () => {
      cancelled = true
      sceneRef.current?.destroy()
      sceneRef.current = null
    }
  }, [])

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

  const sky = skyFor(data?.weatherCode ?? null)

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: "inherit" }}>
      <div className="absolute inset-0" style={{ background: sky }} />
      {STARS.map(([x, y], i) => (
        <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: i % 3 ? 2 : 3,
          height: i % 3 ? 2 : 3, borderRadius: "50%", background: "#fff", opacity: 0.3 + (i % 4) * 0.15 }} />
      ))}

      {/* WebGL scene — the 3D string lights and lanterns live in here */}
      <div ref={hostRef} className="absolute inset-0" style={{ zIndex: 10, touchAction: "none" }} />

      {/* Warm wash + vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 22,
        background: "radial-gradient(ellipse at 50% 50%, rgba(255,170,80,0.08), transparent 60%)" }} />
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 23,
        boxShadow: "inset 0 0 130px rgba(12,9,28,0.62)", borderRadius: "inherit" }} />
    </div>
  )
}
