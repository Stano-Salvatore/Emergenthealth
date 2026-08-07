"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { RefreshCw, Leaf, X, Check, Send, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { Garden3DCanvas } from "@/components/garden3d/Garden3DCanvas"
import { plantSpriteKey, type EngineData } from "@/components/garden/engine"

// ─── Plant definitions ────────────────────────────────────────────────────────

const PLANT_TYPES = {
  sunflower: { name: "Sunflower",      emoji: "🌻", stages: ["🥀","🌱","🌿","🌻","🌻","🌻"] },
  rose:      { name: "Rose",           emoji: "🌹", stages: ["🥀","🌱","🌿","🌷","🌹","🌹"] },
  cactus:    { name: "Cactus",         emoji: "🌵", stages: ["🥀","🌱","🌵","🌵","🌵","🌵"] },
  mushroom:  { name: "Mushroom",       emoji: "🍄", stages: ["🥀","🌱","🍄","🍄","🍄","🍄"] },
  bamboo:    { name: "Bamboo",         emoji: "🎋", stages: ["🥀","🌱","🌿","🎋","🎋","🎋"] },
  sakura:    { name: "Cherry",         emoji: "🌸", stages: ["🥀","🌱","🌿","🌸","🌸","🌸"] },
  oak:       { name: "Oak Tree",       emoji: "🌳", stages: ["🥀","🌱","🌿","🌳","🌳","🌲"] },
  tulip:     { name: "Tulip",          emoji: "🌷", stages: ["🥀","🌱","🌿","🌷","🌷","🌷"] },
  fern:      { name: "Fern",           emoji: "🌿", stages: ["🥀","🌱","🌿","🌿","🌿","🌿"] },
  bonsai:    { name: "Bonsai",         emoji: "🪴", stages: ["🥀","🌱","🌿","🪴","🪴","🪴"] },
} as const

type PlantKey = keyof typeof PLANT_TYPES

const STAGE_LABEL = ["Wilting","Seed","Sprout","Seedling","Growing","Blooming"]

function getStage(streak: number, missed: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (missed >= 3) return 0
  if (streak === 0) return 1
  if (streak <= 2) return 2
  if (streak <= 6) return 3
  if (streak <= 13) return 4
  return 5
}

// ─── Decorations ──────────────────────────────────────────────────────────────

const ALL_DECORATIONS = [
  { id: "gnome",     emoji: "🧙",  name: "Garden Gnome" },
  { id: "butterfly", emoji: "🦋",  name: "Butterfly"    },
  { id: "bee",       emoji: "🐝",  name: "Bee"          },
  { id: "bird",      emoji: "🐦",  name: "Birdbath"     },
  { id: "stone",     emoji: "🪨",  name: "Stones"       },
  { id: "mushroom",  emoji: "🍄",  name: "Wild Mushroom" },
  { id: "rainbow",   emoji: "🌈",  name: "Rainbow"      },
  { id: "ladybug",   emoji: "🐞",  name: "Ladybug"      },
  { id: "snail",     emoji: "🐌",  name: "Snail"        },
  { id: "frog",      emoji: "🐸",  name: "Frog"         },
  { id: "fox",       emoji: "🦊",  name: "Fox"          },
  { id: "hedgehog",  emoji: "🦔",  name: "Hedgehog"     },
] as const

function weatherMeta(code: number | null): { icon: string; label: string } {
  if (code == null || code <= 1) return { icon: "☀️", label: "Sunny" }
  if (code <= 3)  return { icon: "⛅",  label: "Cloudy" }
  if (code <= 48) return { icon: "🌫️", label: "Foggy" }
  if (code <= 67) return { icon: "🌧️", label: "Rainy" }
  if (code <= 77) return { icon: "❄️",  label: "Snowy" }
  return { icon: "⛈️", label: "Stormy" }
}

// ─── Data types ───────────────────────────────────────────────────────────────

interface HabitData {
  id: string; name: string; icon: string | null; color: string
  streak: number; completedToday: boolean; missedDays: number
}

interface GardenData {
  habits: HabitData[]
  plantChoices: Record<string, string>
  decorations: string[]
  layout?: { placed: Record<string, { x: number; y: number }> }
  weather: { code: number; temp: number } | null
  level: { level: number; name: string; emoji: string; progress: number; xp: number; xpToNext: number }
  unlocked: string[]
  locked: { id: string; req: string; have: number; need: number }[]
  watered: { today: boolean; count: number }
}

// ─── Emergy chat ─────────────────────────────────────────────────────────────

interface ChatMsg { role: "user" | "assistant"; text: string }

const QUICK_PROMPTS = [
  "How's my garden today?",
  "What should I focus on?",
  "Why are some plants wilting?",
  "Any tips for building better habits?",
]

function EmergyChatPanel({
  habits, weather, onClose,
}: {
  habits: HabitData[]
  weather: { code: number; temp: number } | null
  onClose: () => void
}) {
  const [history, setHistory]   = useState<ChatMsg[]>([])
  const [input, setInput]       = useState("")
  const [loading, setLoading]   = useState(false)
  const bottomRef               = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [history, loading])

  async function send(msg: string) {
    if (!msg.trim() || loading) return
    const userMsg: ChatMsg = { role: "user", text: msg }
    setHistory(h => [...h, userMsg])
    setInput("")
    setLoading(true)
    try {
      const res = await fetch("/api/garden/emergy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          habits,
          weather,
          history: history.map(m => ({ role: m.role, content: m.text })),
        }),
      })
      const data = await res.json()
      setHistory(h => [...h, { role: "assistant", text: data.response ?? "…" }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-2xl border border-primary/20 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-primary/5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Emergy</span>
          <span className="text-xs text-muted-foreground">· garden spirit</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Chat messages */}
      <div className="flex flex-col gap-2.5 px-4 py-3 max-h-64 overflow-y-auto">
        {history.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3 italic">
            🌿 Ask me anything about your garden or habits…
          </p>
        )}
        {history.map((msg, i) => (
          <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn(
              "text-sm rounded-2xl px-3.5 py-2 max-w-[85%] leading-relaxed",
              msg.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-sm"
                : "bg-secondary text-secondary-foreground rounded-bl-sm"
            )}>
              {msg.role === "assistant" && <span className="mr-1.5">🌿</span>}
              {msg.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-secondary rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm text-muted-foreground">
              🌿 <span className="inline-flex gap-0.5">
                <span className="animate-bounce" style={{ animationDelay: "0ms" }}>·</span>
                <span className="animate-bounce" style={{ animationDelay: "150ms" }}>·</span>
                <span className="animate-bounce" style={{ animationDelay: "300ms" }}>·</span>
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {history.length === 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {QUICK_PROMPTS.map(p => (
            <button key={p} onClick={() => send(p)}
              className="text-[11px] px-2.5 py-1 rounded-full border border-border hover:border-primary/50 hover:bg-primary/5 transition-all text-muted-foreground hover:text-foreground">
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border/60">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && send(input)}
          placeholder="Ask Emergy…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 min-w-0"
        />
        <button
          onClick={() => send(input)}
          disabled={!input.trim() || loading}
          className="p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 transition-opacity hover:opacity-90"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Plant picker ─────────────────────────────────────────────────────────────

function PlantPicker({ habit, currentPlant, onSelect, onClose }: {
  habit: HabitData
  currentPlant: PlantKey
  onSelect: (plantKey: PlantKey) => void
  onClose: () => void
}) {
  const stage = getStage(habit.streak, habit.missedDays)
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">{habit.icon ?? "🌱"} {habit.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {STAGE_LABEL[stage]} · {habit.streak > 0 ? `${habit.streak}-day streak` : "No streak yet"}
          </p>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">Choose a plant for this habit:</p>
      <div className="grid grid-cols-5 gap-2">
        {(Object.entries(PLANT_TYPES) as [PlantKey, typeof PLANT_TYPES[PlantKey]][]).map(([key, plant]) => (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className={cn(
              "flex flex-col items-center gap-1 p-2 rounded-xl border transition-all",
              currentPlant === key
                ? "border-primary bg-primary/10"
                : "border-border hover:border-muted-foreground hover:bg-secondary/50"
            )}
          >
            <span className="text-2xl leading-none">{plant.emoji}</span>
            <span className="text-[9px] text-muted-foreground leading-none text-center">{plant.name}</span>
            {currentPlant === key && <Check className="h-3 w-3 text-primary" />}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-secondary/30 px-3 py-2">
        <p className="text-xs text-muted-foreground mb-1">Growth stages for <span className="text-foreground font-medium">{PLANT_TYPES[currentPlant]?.name}</span>:</p>
        <div className="flex items-end gap-2">
          {PLANT_TYPES[currentPlant]?.stages.map((s, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <span style={{ fontSize: 10 + i * 4, lineHeight: 1 }}>{s}</span>
              <span className="text-[8px] text-muted-foreground/60">{STAGE_LABEL[i]?.slice(0,3)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Decoration picker ────────────────────────────────────────────────────────

function DecorationPicker({ selected, unlocked, locked, onToggle, onClose }: {
  selected: string[]
  unlocked: string[]
  locked: { id: string; req: string; have: number; need: number }[]
  onToggle: (id: string) => void
  onClose: () => void
}) {
  const lockedById = new Map(locked.map(l => [l.id, l]))
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">Garden Decorations</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Earn creatures and objects — {unlocked.length}/{ALL_DECORATIONS.length} unlocked
          </p>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {ALL_DECORATIONS.map(d => {
          const lock = lockedById.get(d.id)
          const active = selected.includes(d.id)
          if (lock) {
            return (
              <div key={d.id}
                className="flex flex-col items-center gap-1 p-3 rounded-xl border border-border/50 bg-secondary/20 opacity-70">
                <span className="text-2xl leading-none grayscale">{d.emoji}</span>
                <span className="text-[9px] text-muted-foreground text-center leading-none">🔒 {d.name}</span>
                <span className="text-[8px] text-muted-foreground/70 text-center leading-tight">{lock.req}</span>
                <div className="w-full h-1 rounded-full bg-secondary overflow-hidden mt-0.5">
                  <div className="h-full rounded-full bg-primary/60"
                    style={{ width: `${Math.round((lock.have / lock.need) * 100)}%` }} />
                </div>
              </div>
            )
          }
          return (
            <button key={d.id} onClick={() => onToggle(d.id)}
              className={cn(
                "flex flex-col items-center gap-1 p-3 rounded-xl border transition-all",
                active
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-muted-foreground hover:bg-secondary/50"
              )}>
              <span className="text-2xl leading-none">{d.emoji}</span>
              <span className="text-[9px] text-muted-foreground text-center leading-none">{d.name}</span>
              {active && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GardenPage() {
  const [data, setData]                   = useState<GardenData | null>(null)
  const [loading, setLoading]             = useState(true)
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null)
  const [showDecos, setShowDecos]         = useState(false)
  const [showEmergy, setShowEmergy]       = useState(false)
  const [plantChoices, setPlantChoices]   = useState<Record<string, string>>({})
  const [decorations, setDecorations]     = useState<string[]>([])
  const [placed, setPlaced]               = useState<Record<string, { x: number; y: number }>>({})
  const [watering, setWatering]           = useState(false)
  const [sparkleSignal, setSparkleSignal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/garden")
      if (res.ok) {
        const d: GardenData = await res.json()
        setData(d)
        setPlantChoices(d.plantChoices)
        setDecorations(d.decorations)
        setPlaced(d.layout?.placed ?? {})
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handlePlantSelect(plantKey: PlantKey) {
    if (!selectedHabitId) return
    setPlantChoices(p => ({ ...p, [selectedHabitId]: plantKey }))
    setSelectedHabitId(null)
    await fetch("/api/garden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ habitId: selectedHabitId, plantType: plantKey }),
    })
  }

  async function handleWater() {
    if (!data || data.watered.today || watering) return
    setWatering(true)
    try {
      const res = await fetch("/api/garden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ water: true }),
      })
      if (res.ok) {
        const d = await res.json()
        setData(prev => prev ? {
          ...prev,
          watered: { today: true, count: d.count },
          level: { ...prev.level, xp: prev.level.xp + 5 },
        } : prev)
        setSparkleSignal(s => s + 1)
      }
    } finally {
      setWatering(false)
    }
  }

  async function handleDecoToggle(id: string) {
    const next = decorations.includes(id) ? decorations.filter(d => d !== id) : [...decorations, id]
    setDecorations(next)
    await fetch("/api/garden", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decorations: next }),
    })
  }

  const selectedHabit = data?.habits.find(h => h.id === selectedHabitId) ?? null

  // Engine data — recomputed when garden state changes
  const engineData: EngineData | null = useMemo(() => {
    if (!data) return null
    return {
      habits: data.habits.map(h => {
        const plantKey = (plantChoices[h.id] ?? "sunflower") as PlantKey
        const plant = PLANT_TYPES[plantKey] ?? PLANT_TYPES.sunflower
        const stage = getStage(h.streak, h.missedDays)
        return {
          id: h.id, name: h.name, streak: h.streak,
          completedToday: h.completedToday, missedDays: h.missedDays,
          stageEmoji: plant.stages[stage], stage, plantKey,
        }
      }),
      decorations,
      level: data.level.level,
      weatherCode: data.weather?.code ?? null,
      placed,
    }
  }, [data, plantChoices, decorations, placed])

  const wm = weatherMeta(data?.weather?.code ?? null)

  return (
    <>
      <style>{`
        @keyframes gardenBulb {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
      `}</style>

      <div className="space-y-5">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Leaf className="h-6 w-6 text-green-400" /> Garden
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Your habits, growing in a cozy corner of the world
          </p>
        </div>

        {/* Game screen */}
        <div className="relative w-full rounded-3xl overflow-hidden" style={{ height: 620 }}>
          {loading && !data ? (
            <div className="absolute inset-0 bg-secondary/30 flex items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Garden3DCanvas
              data={engineData}
              sparkleSignal={sparkleSignal}
              onPlantClick={id => {
                setSelectedHabitId(id); setShowDecos(false); setShowEmergy(false)
              }}
            />
          )}

          {/* Level chip */}
          {data?.level && (
            <div className="absolute z-50" style={{ top: 14, left: 14 }}>
              <div className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2 pl-2.5"
                style={{ background: "rgba(22,26,22,0.82)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center justify-center rounded-xl" style={{ width: 34, height: 34, background: "rgba(255,255,255,0.1)", fontSize: 19 }}>
                  {data.level.emoji}
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center justify-center rounded-full font-extrabold"
                      style={{ background: "#3e5d33", color: "#cde8b0", fontSize: 10, width: 18, height: 18 }}>
                      {data.level.level}
                    </span>
                    <span className="font-bold" style={{ color: "#f2efe4", fontSize: 13 }}>{data.level.name}</span>
                  </div>
                  <div className="mt-1 rounded-full" style={{ width: 120, height: 6, background: "rgba(255,255,255,0.14)" }}>
                    <div className="h-full rounded-full" style={{ width: `${data.level.progress}%`, background: "linear-gradient(90deg,#8fd05e,#5fae3d)" }} />
                  </div>
                  <div className="mt-0.5 font-semibold" style={{ color: "#a9c790", fontSize: 9 }}>
                    {data.level.xp.toLocaleString()} XP · {data.level.xpToNext} to next
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Weather chip + refresh */}
          {data?.weather && (
            <div className="absolute z-50 flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ top: 14, right: 64,
              background: "rgba(22,26,22,0.82)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ fontSize: 13 }}>{wm.icon}</span>
              <span className="font-semibold" style={{ color: "#f2efe4", fontSize: 11.5 }}>{data.weather.temp}°C · {wm.label}</span>
            </div>
          )}
          <button onClick={load} disabled={loading}
            className="absolute z-50 flex items-center justify-center rounded-full transition-opacity hover:opacity-80"
            style={{ top: 12, right: 14, width: 38, height: 38, background: "rgba(22,26,22,0.82)",
              border: "1px solid rgba(255,255,255,0.1)", color: "#cfe6b8" }}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>

          {/* Round corner buttons */}
          <button onClick={() => { setShowEmergy(v => !v); setShowDecos(false); setSelectedHabitId(null) }}
            className="absolute z-50 flex flex-col items-center justify-center transition-transform hover:scale-105 active:scale-95"
            style={{ bottom: 16, left: 16, width: 58, height: 58, borderRadius: "50%",
              background: "radial-gradient(circle at 35% 30%, #6f9c50, #46702f)",
              border: showEmergy ? "3px solid #ffe9b0" : "3px solid rgba(240,240,220,0.85)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
            <span style={{ fontSize: 19 }}>✨</span>
            <span className="font-bold" style={{ color: "#f4f2e2", fontSize: 8.5 }}>Emergy</span>
          </button>
          <button onClick={() => { setShowDecos(v => !v); setShowEmergy(false); setSelectedHabitId(null) }}
            className="absolute z-50 flex flex-col items-center justify-center transition-transform hover:scale-105 active:scale-95"
            style={{ bottom: 16, right: 16, width: 58, height: 58, borderRadius: "50%",
              background: "radial-gradient(circle at 35% 30%, #6f9c50, #46702f)",
              border: showDecos ? "3px solid #ffe9b0" : "3px solid rgba(240,240,220,0.85)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
            <span style={{ fontSize: 17 }}>🪨</span>
            <span className="font-bold" style={{ color: "#f4f2e2", fontSize: 8 }}>Decorate</span>
          </button>

          {/* Bottom card bar: Water + habit cards */}
          {data && (
            <div className="absolute z-50 flex gap-2 overflow-x-auto rounded-2xl p-2"
              style={{ bottom: 14, left: 88, right: 88, background: "rgba(22,26,22,0.55)", backdropFilter: "blur(6px)" }}>
              <button onClick={handleWater} disabled={data.watered.today || watering}
                className="relative shrink-0 flex flex-col items-center gap-1 rounded-xl px-1 pt-2 pb-1.5 transition-transform hover:scale-105 active:scale-95 disabled:hover:scale-100"
                style={{ width: 72, background: "linear-gradient(180deg,#faf4e2,#efe6cc)",
                  border: data.watered.today ? "2px solid #b9d89a" : "2px solid #8fd05e",
                  boxShadow: "0 3px 8px rgba(0,0,0,0.35)", opacity: data.watered.today ? 0.75 : 1 }}>
                <span style={{ fontSize: 24, lineHeight: 1 }}>💧</span>
                <span className="font-bold" style={{ color: "#4a3f2c", fontSize: 10 }}>
                  {data.watered.today ? "Watered" : watering ? "…" : "Water"}
                </span>
                <span className="absolute font-extrabold" style={{ right: 5, bottom: 3, color: "#7a6f56", fontSize: 9 }}>
                  {data.watered.today ? "✓" : "+5"}
                </span>
              </button>
              {data.habits.map(h => {
                const plantKey = (plantChoices[h.id] ?? "sunflower") as PlantKey
                const stage = getStage(h.streak, h.missedDays)
                return (
                  <button key={h.id} onClick={() => { setSelectedHabitId(h.id); setShowDecos(false); setShowEmergy(false) }}
                    className="relative shrink-0 flex flex-col items-center gap-1 rounded-xl px-1 pt-2 pb-1.5 transition-transform hover:scale-105 active:scale-95"
                    style={{ width: 72, background: "linear-gradient(180deg,#faf4e2,#efe6cc)", border: "2px solid #dccfae",
                      boxShadow: "0 3px 8px rgba(0,0,0,0.35)" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/garden-assets/${plantSpriteKey(plantKey, stage)}.png`}
                      alt="" style={{ height: 26, width: "auto" }} />
                    <span className="font-bold truncate max-w-full px-0.5" style={{ color: "#4a3f2c", fontSize: 10 }}>{h.name}</span>
                    {h.streak > 0 && (
                      <span className="absolute font-extrabold" style={{ right: 5, bottom: 3, color: "#7a6f56", fontSize: 9 }}>
                        {h.streak}
                      </span>
                    )}
                    {h.completedToday && (
                      <span className="absolute" style={{ left: 5, top: 3, color: "#5fae3d", fontSize: 9, fontWeight: 800 }}>✓</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Emergy chat */}
        {showEmergy && (
          <EmergyChatPanel
            habits={data?.habits ?? []}
            weather={data?.weather ?? null}
            onClose={() => setShowEmergy(false)}
          />
        )}

        {/* Plant picker */}
        {selectedHabit && !showDecos && !showEmergy && (
          <PlantPicker
            habit={selectedHabit}
            currentPlant={(plantChoices[selectedHabit.id] ?? "sunflower") as PlantKey}
            onSelect={handlePlantSelect}
            onClose={() => setSelectedHabitId(null)}
          />
        )}

        {/* Decoration picker */}
        {showDecos && (
          <DecorationPicker
            selected={decorations}
            unlocked={data?.unlocked ?? []}
            locked={data?.locked ?? []}
            onToggle={handleDecoToggle}
            onClose={() => setShowDecos(false)}
          />
        )}

        {/* How it works */}
        <div className="rounded-2xl border border-border/50 bg-card/50 px-4 py-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">How your garden grows</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              ["🌱 → 🌿", "Seed → Sprout", "Complete 1–2 days"],
              ["🌿 → 🌻", "Seedling → Growing", "3–13 day streak"],
              ["🌻 → ✨", "Blooming", "14+ day streak, glows!"],
              ["🥀", "Wilting", "3+ consecutive missed days"],
              ["💧", "Daily watering", "One tap a day, +5 XP each"],
              ["🖐", "Orbit view", "Drag to spin the garden, pinch to zoom"],
              ["🏡 ⛲", "Level scenery", "Ponds, decks & trees unlock as you level"],
              ["🌧️ 🌙", "Weather & night", "Real weather + day/night lighting"],
            ].map(([icon, label, desc]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <p className="text-sm">{icon} <span className="font-medium text-xs">{label}</span></p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
