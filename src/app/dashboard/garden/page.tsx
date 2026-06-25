"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { RefreshCw, Leaf, X, Check, Send, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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

// stage 0 = wilting (3+ missed), 1 = seed, 2 = sprout, 3 = seedling, 4 = grown, 5 = mature
const STAGE_PX  = [28, 28, 36, 48, 60, 76]
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

// Fixed positions in the scene for decorations (% of container)
const DECO_POSITIONS: Record<string, { x: number; y: number; sky: boolean }> = {
  gnome:     { x: 8,  y: 75, sky: false },
  butterfly: { x: 22, y: 28, sky: true  },
  bee:       { x: 68, y: 22, sky: true  },
  bird:      { x: 82, y: 68, sky: false },
  stone:     { x: 45, y: 82, sky: false },
  mushroom:  { x: 72, y: 78, sky: false },
  rainbow:   { x: 50, y: 10, sky: true  },
  ladybug:   { x: 33, y: 72, sky: false },
  snail:     { x: 60, y: 85, sky: false },
  frog:      { x: 14, y: 85, sky: false },
  fox:       { x: 88, y: 80, sky: false },
  hedgehog:  { x: 4,  y: 80, sky: false },
}

// ─── Weather ─────────────────────────────────────────────────────────────────

interface WeatherTheme {
  skyTop: string; skyBot: string
  groundTop: string; groundBot: string
  type: "sunny"|"cloudy"|"foggy"|"rainy"|"snowy"|"stormy"|"clear"
  icon: string; label: string
}

function getWeatherTheme(code?: number | null): WeatherTheme {
  if (code == null || code <= 1) return { skyTop:"#38bdf8", skyBot:"#93c5fd", groundTop:"#16a34a", groundBot:"#15803d", type:"sunny",  icon:"☀️",  label:"Sunny"   }
  if (code <= 3)                 return { skyTop:"#94a3b8", skyBot:"#cbd5e1", groundTop:"#15803d", groundBot:"#166534", type:"cloudy", icon:"⛅",  label:"Cloudy"  }
  if (code <= 48)                return { skyTop:"#64748b", skyBot:"#94a3b8", groundTop:"#166534", groundBot:"#14532d", type:"foggy",  icon:"🌫️", label:"Foggy"   }
  if (code <= 67)                return { skyTop:"#334155", skyBot:"#475569", groundTop:"#14532d", groundBot:"#052e16", type:"rainy",  icon:"🌧️", label:"Rainy"   }
  if (code <= 77)                return { skyTop:"#bfdbfe", skyBot:"#dbeafe", groundTop:"#d1fae5", groundBot:"#a7f3d0", type:"snowy",  icon:"❄️",  label:"Snowy"   }
  return                                { skyTop:"#1e293b", skyBot:"#334155", groundTop:"#052e16", groundBot:"#064e3b", type:"stormy", icon:"⛈️", label:"Stormy"  }
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
  weather: { code: number; temp: number } | null
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

// ─── Weather particles ────────────────────────────────────────────────────────

function RainDrops() {
  const drops = Array.from({ length: 24 }, (_, i) => ({
    left: `${(i * 4.3 + 1) % 100}%`,
    delay: `${((i * 0.13) % 1.2).toFixed(2)}s`,
    duration: `${(0.55 + (i % 5) * 0.1).toFixed(2)}s`,
    height: `${14 + (i % 4) * 5}px`,
    opacity: 0.4 + (i % 3) * 0.2,
  }))
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
      {drops.map((d, i) => (
        <div key={i} className="absolute w-0.5 rounded-full bg-blue-200"
          style={{ left: d.left, top: -20, height: d.height, opacity: d.opacity,
            animation: `gardenRain ${d.duration} linear ${d.delay} infinite` }} />
      ))}
    </div>
  )
}

function Snowflakes() {
  const flakes = Array.from({ length: 18 }, (_, i) => ({
    left: `${(i * 5.8 + 2) % 100}%`,
    delay: `${((i * 0.25) % 2.5).toFixed(2)}s`,
    duration: `${(2.5 + (i % 4) * 0.6).toFixed(2)}s`,
    size: 10 + (i % 4) * 3,
  }))
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-10">
      {flakes.map((f, i) => (
        <div key={i} className="absolute select-none"
          style={{ left: f.left, top: -24, fontSize: f.size,
            animation: `gardenSnow ${f.duration} linear ${f.delay} infinite` }}>
          ❄️
        </div>
      ))}
    </div>
  )
}

function FogLayer() {
  return (
    <div className="absolute inset-0 pointer-events-none z-10"
      style={{ background: "linear-gradient(180deg, rgba(148,163,184,0.45) 0%, rgba(148,163,184,0.15) 60%, transparent 100%)" }} />
  )
}

function LightningFlash() {
  return (
    <div className="absolute inset-0 pointer-events-none z-10 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.7)", animation: "gardenLightning 5s linear infinite" }} />
  )
}

// ─── Garden scene ─────────────────────────────────────────────────────────────

function GardenScene({
  habits, plantChoices, decorations, weather, onPlantClick,
}: {
  habits: HabitData[]
  plantChoices: Record<string, string>
  decorations: string[]
  weather: { code: number; temp: number } | null
  onPlantClick: (id: string) => void
}) {
  const theme = getWeatherTheme(weather?.code)
  const activeDecos = ALL_DECORATIONS.filter(d => decorations.includes(d.id))

  return (
    <div className="relative w-full rounded-2xl overflow-hidden select-none" style={{ height: 420 }}>
      {/* Sky */}
      <div className="absolute inset-0" style={{
        background: `linear-gradient(180deg, ${theme.skyTop} 0%, ${theme.skyBot} 58%, ${theme.groundTop} 58%, ${theme.groundBot} 100%)`,
      }} />

      {/* Weather FX */}
      {theme.type === "rainy"  && <RainDrops />}
      {theme.type === "snowy"  && <Snowflakes />}
      {theme.type === "foggy"  && <FogLayer />}
      {theme.type === "stormy" && <><RainDrops /><LightningFlash /></>}

      {/* Sun / moon */}
      {(theme.type === "sunny" || theme.type === "clear") && (
        <div className="absolute top-5 right-8 text-5xl pointer-events-none z-10"
          style={{ animation: "gardenSunSpin 40s linear infinite", filter: "drop-shadow(0 0 16px #fbbf24)" }}>
          ☀️
        </div>
      )}
      {theme.type === "cloudy" && (
        <>
          <div className="absolute top-6 left-12 text-3xl pointer-events-none z-10"
            style={{ animation: "gardenFloat 6s ease-in-out infinite" }}>⛅</div>
          <div className="absolute top-10 right-20 text-2xl pointer-events-none z-10 opacity-70"
            style={{ animation: "gardenFloat 8s ease-in-out 2s infinite" }}>☁️</div>
        </>
      )}
      {theme.type === "stormy" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 text-3xl pointer-events-none z-10 opacity-70">⛈️</div>
      )}

      {/* Decorations */}
      {activeDecos.map(d => {
        const pos = DECO_POSITIONS[d.id] ?? { x: 50, y: 50, sky: false }
        const anim = ["butterfly","bee","rainbow"].includes(d.id)
          ? "gardenFloat 4s ease-in-out infinite"
          : undefined
        return (
          <div key={d.id} className="absolute z-20 pointer-events-none"
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, fontSize: 22, animation: anim,
              filter: pos.sky ? undefined : "drop-shadow(0 2px 3px rgba(0,0,0,0.3))" }}>
            {d.emoji}
          </div>
        )
      })}

      {/* Ground line indicator */}
      <div className="absolute w-full pointer-events-none" style={{ top: "58%" }}>
        <div className="w-full h-px bg-black/10" />
      </div>

      {/* Plants — centered row at ground level */}
      <div className="absolute bottom-0 left-0 right-0 z-30 flex items-end justify-center gap-4 px-6 pb-5"
        style={{ paddingTop: 8 }}>
        {habits.slice(0, 10).map(h => {
          const plantKey = (plantChoices[h.id] ?? "sunflower") as PlantKey
          const plant = PLANT_TYPES[plantKey] ?? PLANT_TYPES.sunflower
          const stage = getStage(h.streak, h.missedDays)
          const px = STAGE_PX[stage]
          const isMature = stage === 5
          const isDead = stage === 0

          return (
            <button key={h.id} onClick={() => onPlantClick(h.id)}
              className="flex flex-col items-center gap-0.5 group transition-transform hover:scale-110 active:scale-95 focus:outline-none">
              {/* Streak badge */}
              {h.streak > 0 && (
                <span className="text-[9px] font-bold bg-orange-500/80 text-white rounded-full px-1.5 py-0.5 leading-none mb-0.5">
                  {h.streak}d🔥
                </span>
              )}
              {/* Plant emoji */}
              <span
                style={{
                  fontSize: px,
                  lineHeight: 1,
                  filter: isDead
                    ? "grayscale(1) opacity(0.5)"
                    : isMature
                      ? "drop-shadow(0 0 8px rgba(255,230,50,0.8))"
                      : undefined,
                  animation: isMature
                    ? "gardenGlow 2s ease-in-out infinite"
                    : h.completedToday
                      ? "gardenFloat 3s ease-in-out infinite"
                      : undefined,
                }}
              >
                {plant.stages[stage]}
              </span>
              {/* Label */}
              <span className="text-[9px] font-medium text-white/90 truncate max-w-[56px] leading-none mt-0.5"
                style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
                {h.name.length > 7 ? h.name.slice(0, 6) + "…" : h.name}
              </span>
              {/* Soil patch */}
              <div className="w-10 h-2 rounded-full mt-0.5 opacity-60"
                style={{ background: "radial-gradient(ellipse, #92400e 0%, #78350f 100%)" }} />
            </button>
          )
        })}
        {habits.length === 0 && (
          <p className="text-white/70 text-sm" style={{ textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>
            No habits yet — add some in Habits to grow your garden
          </p>
        )}
      </div>

      {/* Weather badge */}
      {weather && (
        <div className="absolute top-3 left-4 z-30 flex items-center gap-1.5 bg-black/25 backdrop-blur-sm rounded-full px-3 py-1">
          <span className="text-sm">{theme.icon}</span>
          <span className="text-xs text-white font-medium">{weather.temp}°C · {theme.label}</span>
        </div>
      )}
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

function DecorationPicker({ selected, onToggle, onClose }: {
  selected: string[]
  onToggle: (id: string) => void
  onClose: () => void
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-sm">Garden Decorations</p>
          <p className="text-xs text-muted-foreground mt-0.5">Add creatures and objects to your garden</p>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-secondary transition-colors text-muted-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {ALL_DECORATIONS.map(d => {
          const active = selected.includes(d.id)
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

// ─── Habit list ───────────────────────────────────────────────────────────────

function HabitRow({ habit, plantKey, onClick }: { habit: HabitData; plantKey: PlantKey; onClick: () => void }) {
  const plant = PLANT_TYPES[plantKey] ?? PLANT_TYPES.sunflower
  const stage = getStage(habit.streak, habit.missedDays)

  return (
    <button onClick={onClick}
      className="flex items-center gap-3 w-full rounded-xl px-3 py-2.5 hover:bg-secondary/40 transition-colors text-left group">
      <span style={{ fontSize: 26, lineHeight: 1, filter: stage === 0 ? "grayscale(1) opacity(0.4)" : undefined }}>
        {plant.stages[stage]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{habit.name}</span>
          <span className="text-xs text-muted-foreground shrink-0">{plant.name}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn("text-xs", stage === 0 ? "text-red-400" : stage >= 4 ? "text-green-400" : "text-muted-foreground")}>
            {STAGE_LABEL[stage]}
          </span>
          {habit.streak > 0 && <span className="text-xs text-orange-400">🔥 {habit.streak}d streak</span>}
          {habit.missedDays >= 3 && <span className="text-xs text-red-400">⚠️ {habit.missedDays}d missed</span>}
          {habit.completedToday && <span className="text-xs text-green-400">✓ Done today</span>}
        </div>
      </div>
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
        Change plant →
      </span>
    </button>
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

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/garden")
      if (res.ok) {
        const d: GardenData = await res.json()
        setData(d)
        setPlantChoices(d.plantChoices)
        setDecorations(d.decorations)
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

  // Garden summary stats
  const thriving = data?.habits.filter(h => getStage(h.streak, h.missedDays) >= 4).length ?? 0
  const wilting  = data?.habits.filter(h => getStage(h.streak, h.missedDays) === 0).length ?? 0
  const doneToday = data?.habits.filter(h => h.completedToday).length ?? 0

  return (
    <>
      {/* CSS keyframes injected once */}
      <style>{`
        @keyframes gardenRain {
          0%   { transform: translateY(-5px); }
          100% { transform: translateY(440px); }
        }
        @keyframes gardenSnow {
          0%   { transform: translateY(-5px) translateX(0); }
          50%  { transform: translateY(200px) translateX(18px); }
          100% { transform: translateY(440px) translateX(-10px); }
        }
        @keyframes gardenFloat {
          0%, 100% { transform: translateY(0px); }
          50%      { transform: translateY(-8px); }
        }
        @keyframes gardenGlow {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(255,230,50,0.7)); }
          50%      { filter: drop-shadow(0 0 14px rgba(255,230,50,1)); }
        }
        @keyframes gardenSunSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes gardenLightning {
          0%, 92%, 94%, 96%, 100% { opacity: 0; }
          93%, 95%                { opacity: 0.6; }
        }
      `}</style>

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Leaf className="h-6 w-6 text-green-400" /> Garden
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Your habits, growing in the wild
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={showEmergy ? "default" : "outline"}
              onClick={() => { setShowEmergy(v => !v); setShowDecos(false); setSelectedHabitId(null) }}
              className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Emergy
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowDecos(v => !v); setSelectedHabitId(null); setShowEmergy(false) }}>
              🪨 Decorate
            </Button>
            <Button size="sm" variant="ghost" onClick={load} disabled={loading} className="gap-1">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Summary chips */}
        {data && data.habits.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="text-xs px-3 py-1.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
              🌻 {thriving} thriving
            </span>
            <span className="text-xs px-3 py-1.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
              ✅ {doneToday}/{data.habits.length} done today
            </span>
            {wilting > 0 && (
              <span className="text-xs px-3 py-1.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20">
                🥀 {wilting} wilting — tend them!
              </span>
            )}
          </div>
        )}

        {/* Garden scene */}
        {loading ? (
          <div className="w-full rounded-2xl bg-secondary/30 flex items-center justify-center" style={{ height: 420 }}>
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <GardenScene
            habits={data?.habits ?? []}
            plantChoices={plantChoices}
            decorations={decorations}
            weather={data?.weather ?? null}
            onPlantClick={id => { setSelectedHabitId(id); setShowDecos(false) }}
          />
        )}

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
            onToggle={handleDecoToggle}
            onClose={() => setShowDecos(false)}
          />
        )}

        {/* Habit plant list */}
        {data && data.habits.length > 0 && (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border/60">
              <p className="text-sm font-semibold">Your plants</p>
              <p className="text-xs text-muted-foreground mt-0.5">Click any to change its plant type</p>
            </div>
            <div className="divide-y divide-border/40 p-2">
              {data.habits.map(h => (
                <HabitRow
                  key={h.id}
                  habit={h}
                  plantKey={(plantChoices[h.id] ?? "sunflower") as PlantKey}
                  onClick={() => { setSelectedHabitId(h.id); setShowDecos(false) }}
                />
              ))}
            </div>
          </div>
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
              ["🌧️", "Weather", "Reflects real weather outside"],
              ["🧙 🦋", "Decorations", "Purely cosmetic fun"],
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
