"use client"

// React wrapper for the PixiJS garden engine. Owns the canvas lifecycle and
// the cheap CSS atmosphere layers (sky, stars, string lights, vignette) so the
// WebGL scene itself stays transparent.

import { useEffect, useRef } from "react"
import { GardenEngine, type EngineData } from "./engine"

const STARS: [number, number][] = [[6,5],[15,10],[26,4],[38,8],[52,3],[64,7],[76,11],[87,5],[94,10],[21,15],[71,16],[91,18],[45,13],[57,17]]
const BULBS: [number, number][] = [[7,10],[17,14],[29,16],[41,14],[52,9],[64,11],[76,13],[88,12],[97,11]]

function skyFor(code: number | null): string {
  if (code == null || code <= 1) return "linear-gradient(180deg,#2c3550 0%,#3c4a6e 40%,#6b5f7d 72%,#c98a63 100%)"
  if (code <= 3)  return "linear-gradient(180deg,#2b3550 0%,#4a5877 55%,#8d8398 100%)"
  if (code <= 48) return "linear-gradient(180deg,#3e4a5e 0%,#66748a 60%,#98a2b1 100%)"
  if (code <= 67) return "linear-gradient(180deg,#1e2738 0%,#35435c 60%,#526078 100%)"
  if (code <= 77) return "linear-gradient(180deg,#5a6c8e 0%,#9fb2cc 60%,#cfd9e8 100%)"
  return "linear-gradient(180deg,#121724 0%,#20283c 60%,#333e52 100%)"
}

export interface GardenCanvasProps {
  data: EngineData | null
  editMode: boolean
  sparkleSignal: number       // increment to trigger watering sparkles
  onPlantClick: (habitId: string) => void
  onPlaced: (placed: EngineData["placed"]) => void
}

export function GardenCanvas({ data, editMode, sparkleSignal, onPlantClick, onPlaced }: GardenCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<GardenEngine | null>(null)
  const cbRef = useRef({ onPlantClick, onPlaced })
  useEffect(() => { cbRef.current = { onPlantClick, onPlaced } }, [onPlantClick, onPlaced])
  const pendingData = useRef<EngineData | null>(null)

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return
    GardenEngine.create(host, {
      onPlantClick: id => cbRef.current.onPlantClick(id),
      onPlaced: placed => cbRef.current.onPlaced(placed),
    }).then(engine => {
      if (cancelled) { engine.destroy(); return }
      engineRef.current = engine
      if (pendingData.current) engine.update(pendingData.current)
      const ro = new ResizeObserver(() => engine.resize())
      ro.observe(host)
      ;(engine as unknown as { _ro?: ResizeObserver })._ro = ro

      // Stop rendering while the page is hidden, matching the 3D scene. The
      // browser already withholds animation frames from a hidden tab, but a
      // WebView that keeps them coming would otherwise render a garden nobody
      // is looking at.
      const onVisibility = () => engine.setPaused(document.hidden)
      document.addEventListener("visibilitychange", onVisibility)
      ;(engine as unknown as { _vis?: () => void })._vis = onVisibility
    })
    return () => {
      cancelled = true
      const engine = engineRef.current
      engineRef.current = null
      if (engine) {
        ;(engine as unknown as { _ro?: ResizeObserver })._ro?.disconnect()
        const vis = (engine as unknown as { _vis?: () => void })._vis
        if (vis) document.removeEventListener("visibilitychange", vis)
        engine.destroy()
      }
    }
  }, [])

  useEffect(() => {
    if (!data) return
    pendingData.current = data
    engineRef.current?.update(data)
  }, [data])

  useEffect(() => {
    engineRef.current?.setEditMode(editMode)
  }, [editMode])

  const lastSparkle = useRef(0)
  useEffect(() => {
    if (sparkleSignal > 0 && sparkleSignal !== lastSparkle.current) {
      lastSparkle.current = sparkleSignal
      engineRef.current?.sparkle()
    }
  }, [sparkleSignal])

  const sky = skyFor(data?.weatherCode ?? null)

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: "inherit" }}>
      {/* Sky */}
      <div className="absolute inset-0" style={{ background: sky }} />
      {STARS.map(([x, y], i) => (
        <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: i % 3 ? 2 : 3,
          height: i % 3 ? 2 : 3, borderRadius: "50%", background: "#fff", opacity: 0.3 + (i % 4) * 0.15 }} />
      ))}

      {/* WebGL scene */}
      <div ref={hostRef} className="absolute inset-0" />

      {/* String lights */}
      <svg className="absolute inset-x-0 top-0 w-full pointer-events-none" style={{ height: "30%", zIndex: 20 }}
        viewBox="0 0 100 30" preserveAspectRatio="none">
        <path d="M-2,7 Q28,20 55,9 T102,12" fill="none" stroke="rgba(35,26,18,0.65)" strokeWidth="0.35" />
        {BULBS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y + 1.3} r="0.55" fill={i % 2 ? "#ffd98c" : "#ffe9b0"}
            style={{ filter: "drop-shadow(0 0 1.6px rgba(255,205,115,0.95))",
              animation: `gardenBulb 2.4s ease-in-out ${i * 0.3}s infinite` }} />
        ))}
      </svg>

      {/* Fog */}
      {data?.weatherCode != null && data.weatherCode > 3 && data.weatherCode <= 48 && (
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 21,
          background: "linear-gradient(180deg, rgba(148,163,184,0.4) 0%, rgba(148,163,184,0.12) 60%, transparent 100%)" }} />
      )}

      {/* Warm wash + vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 22,
        background: "radial-gradient(ellipse at 50% 50%, rgba(255,170,80,0.08), transparent 60%)" }} />
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 23,
        boxShadow: "inset 0 0 130px rgba(12,9,28,0.62)", borderRadius: "inherit" }} />
    </div>
  )
}
