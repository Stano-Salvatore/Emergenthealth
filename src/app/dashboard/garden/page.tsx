"use client"

import { useEffect, useState, useCallback, useRef, type CSSProperties } from "react"
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

// Ground decorations live on isometric tiles [row, col]; sky ones float above.
const DECO_TILES: Record<string, [number, number]> = {
  gnome:    [6, 3],
  bird:     [2, 1],
  stone:    [7, 4],
  mushroom: [6, 5],
  ladybug:  [6, 1],
  snail:    [7, 5],
  frog:     [6, 0],
  fox:      [7, 6],
  hedgehog: [7, 1],
}
const DECO_SKY: Record<string, { x: number; y: number }> = {
  butterfly: { x: 24, y: 30 },
  bee:       { x: 66, y: 26 },
  rainbow:   { x: 50, y: 8  },
}

// ─── Weather ─────────────────────────────────────────────────────────────────

interface WeatherTheme {
  sky: string
  grassA: string; grassB: string
  stoneA: string; stoneB: string
  water: string
  type: "sunny"|"cloudy"|"foggy"|"rainy"|"snowy"|"stormy"|"clear"
  icon: string; label: string
}

const STONE = { stoneA: "#e2d5c1", stoneB: "#d5c7b0" }

function getWeatherTheme(code?: number | null): WeatherTheme {
  if (code == null || code <= 1) return { sky:"linear-gradient(180deg,#4d84bc 0%,#8fc2e8 52%,#f4d7a3 100%)", grassA:"#8dba60", grassB:"#7caa52", ...STONE, water:"#5ac4ec", type:"sunny",  icon:"☀️",  label:"Sunny"   }
  if (code <= 3)                 return { sky:"linear-gradient(180deg,#75889f 0%,#aeb8c2 60%,#d8d2c4 100%)", grassA:"#7ea75c", grassB:"#6f974f", ...STONE, water:"#54b4dc", type:"cloudy", icon:"⛅",  label:"Cloudy"  }
  if (code <= 48)                return { sky:"linear-gradient(180deg,#65758a 0%,#93a2b1 60%,#b6bfc8 100%)", grassA:"#719755", grassB:"#64884a", ...STONE, water:"#4ea4c8", type:"foggy",  icon:"🌫️", label:"Foggy"   }
  if (code <= 67)                return { sky:"linear-gradient(180deg,#3a4a61 0%,#5b6f87 62%,#77889c 100%)", grassA:"#5e8a4e", grassB:"#527a44", ...STONE, water:"#4498c4", type:"rainy",  icon:"🌧️", label:"Rainy"   }
  if (code <= 77)                return { sky:"linear-gradient(180deg,#a9bcd6 0%,#d7e1ee 60%,#eef2f7 100%)", grassA:"#e3ebf4", grassB:"#d2dde9", stoneA:"#e9e4dc", stoneB:"#ddd6ca", water:"#a5cfe4", type:"snowy",  icon:"❄️",  label:"Snowy"   }
  return                                { sky:"linear-gradient(180deg,#20283a 0%,#333f55 60%,#465268 100%)", grassA:"#4c7440", grassB:"#416638", ...STONE, water:"#3a86ac", type:"stormy", icon:"⛈️", label:"Stormy"  }
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
  level: { level: number; name: string; emoji: string; progress: number; xp: number; xpToNext: number }
  unlocked: string[]
  locked: { id: string; req: string; have: number; need: number }[]
  watered: { today: boolean; count: number }
}

// Ambient scenery that appears as the garden levels up — the whole garden
// visibly grows richer with XP, independent of individual habit plants.
// Placed on isometric tiles [row, col]; the lotus floats on the pond.
const LEVEL_FLAIR: { min: number; emoji: string; r: number; c: number; size: number }[] = [
  { min: 2, emoji: "🌼", r: 6, c: 6, size: 18 },
  { min: 3, emoji: "🌾", r: 0, c: 5, size: 20 },
  { min: 4, emoji: "🌺", r: 2, c: 7, size: 18 },
  { min: 5, emoji: "🪷", r: 5, c: 0, size: 18 },
  { min: 6, emoji: "🌳", r: 0, c: 0, size: 36 },
  { min: 7, emoji: "🌲", r: 0, c: 7, size: 38 },
  { min: 8, emoji: "⛲", r: 1, c: 3, size: 28 },
  { min: 9, emoji: "🏡", r: 0, c: 3, size: 34 },
]

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
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-40">
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
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-40">
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
    <div className="absolute inset-0 pointer-events-none z-40"
      style={{ background: "linear-gradient(180deg, rgba(148,163,184,0.45) 0%, rgba(148,163,184,0.15) 60%, transparent 100%)" }} />
  )
}

function LightningFlash() {
  return (
    <div className="absolute inset-0 pointer-events-none z-40 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.7)", animation: "gardenLightning 5s linear infinite" }} />
  )
}

// ─── Garden scene ─────────────────────────────────────────────────────────────
// A cozy isometric "diorama island": diamond tiles projected in 2D, a stone
// plaza with a glowing lantern in the middle, ponds, string lights, fireflies.

// G = grass, P = stone plaza, W = water
const TILE_GRID = [
  "GGGGGGGG",
  "GGPPPPGG",
  "GGPPPPGG",
  "GGPPPPGG",
  "GGPPPPGG",
  "WGPPPPGG",
  "GGGGGGGG",
  "GGWGGGGG",
]
const TW = 12   // tile width, % of scene width
const TH = 6    // tile height, % of scene height
const ISO_TOP = 30 // y of the back corner, %
const DIAMOND = "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)"

const isoX = (r: number, c: number) => 50 + (c - r) * (TW / 2)
const isoY = (r: number, c: number) => ISO_TOP + (c + r) * (TH / 2)

// Where an object stands on a tile: centered, feet at ~3/4 down the diamond.
function tileAnchor(r: number, c: number): CSSProperties {
  return {
    left: `${isoX(r, c)}%`,
    top: `${isoY(r, c) + TH * 0.72}%`,
    transform: "translate(-50%, -100%)",
    zIndex: 10 + r + c,
  }
}

// Grass tiles ringing the plaza where habit plants live (up to 10)
const PLANT_SLOTS: [number, number][] = [
  [2, 6], [3, 6], [4, 6], [5, 6], [6, 4], [6, 2], [5, 1], [3, 1], [1, 1], [1, 6],
]

const STRING_LIGHT_BULBS: [number, number][] = [
  [6, 9], [16, 13], [28, 15], [40, 13], [50, 8], [62, 11], [74, 13], [86, 12], [96, 10],
]

const FIREFLIES = [
  { x: 20, y: 48, d: 0   },
  { x: 34, y: 60, d: 1.2 },
  { x: 62, y: 44, d: 2.1 },
  { x: 76, y: 62, d: 0.6 },
  { x: 47, y: 40, d: 1.7 },
  { x: 86, y: 50, d: 2.6 },
]

function GardenScene({
  habits, plantChoices, decorations, weather, level, sparkling, onPlantClick,
}: {
  habits: HabitData[]
  plantChoices: Record<string, string>
  decorations: string[]
  weather: { code: number; temp: number } | null
  level: number
  sparkling: boolean
  onPlantClick: (id: string) => void
}) {
  const theme = getWeatherTheme(weather?.code)
  const activeDecos = ALL_DECORATIONS.filter(d => decorations.includes(d.id))
  const flair = LEVEL_FLAIR.filter(f => level >= f.min)

  return (
    <div className="relative w-full rounded-2xl overflow-hidden select-none" style={{ height: 440 }}>
      {/* Sky */}
      <div className="absolute inset-0" style={{ background: theme.sky }} />

      {/* Sun / clouds */}
      {theme.type === "sunny" && (
        <div className="absolute top-5 right-8 text-4xl pointer-events-none z-10"
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

      {/* String lights swinging across the top */}
      <svg className="absolute inset-x-0 top-0 w-full pointer-events-none" style={{ height: "26%", zIndex: 30 }}
        viewBox="0 0 100 26" preserveAspectRatio="none">
        <path d="M0,6 Q25,20 50,8 T100,10" fill="none" stroke="rgba(50,38,26,0.55)" strokeWidth="0.4" />
        {STRING_LIGHT_BULBS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y + 1.5} r="1.1" fill="#ffd98c"
            style={{ filter: "drop-shadow(0 0 2px rgba(255,200,110,0.9))",
              animation: `gardenBulb 2.4s ease-in-out ${i * 0.3}s infinite` }} />
        ))}
      </svg>

      {/* Island plate — soil thickness under the tiles, floating with a shadow */}
      <div className="absolute" style={{ left: "2%", top: "32.8%", width: "96%", height: "48%",
        clipPath: DIAMOND, background: "#46301c", zIndex: 0,
        filter: "drop-shadow(0 16px 20px rgba(0,0,0,0.4))" }} />
      <div className="absolute" style={{ left: "2%", top: "31.4%", width: "96%", height: "48%",
        clipPath: DIAMOND, background: "#5c3f26", zIndex: 1 }} />

      {/* Isometric tiles */}
      {TILE_GRID.flatMap((row, r) => row.split("").map((t, c) => {
        const alt = (r + c) % 2 === 1
        const bg = t === "W"
          ? `radial-gradient(ellipse at 50% 40%, ${theme.water} 0%, ${theme.water} 45%, rgba(0,0,0,0.18) 100%), ${theme.water}`
          : t === "P"
            ? (alt ? theme.stoneA : theme.stoneB)
            : (alt ? theme.grassA : theme.grassB)
        return (
          <div key={`${r}-${c}`} className="absolute" style={{
            left: `${isoX(r, c) - TW / 2}%`, top: `${isoY(r, c)}%`,
            width: `${TW}%`, height: `${TH}%`,
            clipPath: DIAMOND, background: bg, zIndex: 2,
          }} />
        )
      }))}

      {/* Warm lantern glow over the plaza */}
      <div className="absolute pointer-events-none" style={{
        left: "53%", top: "52%", transform: "translate(-50%, -50%)",
        width: "46%", height: "38%", zIndex: 8,
        background: "radial-gradient(closest-side, rgba(255,176,84,0.35), rgba(255,176,84,0.12) 55%, transparent 78%)",
      }} />
      {/* Lantern centerpiece */}
      <div className="absolute pointer-events-none" style={{
        left: "53%", top: "51.5%", transform: "translate(-50%, -100%)", fontSize: 30, zIndex: 17,
        animation: "gardenGlowPulse 3s ease-in-out infinite",
      }}>🏮</div>

      {/* Level scenery — unlocks as the whole garden levels up */}
      {flair.map(f => (
        <div key={`${f.min}-${f.emoji}`} className="absolute pointer-events-none"
          style={{ ...tileAnchor(f.r, f.c), fontSize: f.size,
            filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))" }}>
          {f.emoji}
        </div>
      ))}

      {/* Decorations */}
      {activeDecos.map(d => {
        const sky = DECO_SKY[d.id]
        if (sky) {
          return (
            <div key={d.id} className="absolute pointer-events-none" style={{
              left: `${sky.x}%`, top: `${sky.y}%`, fontSize: 22, zIndex: 32,
              animation: "gardenFloat 4s ease-in-out infinite",
            }}>{d.emoji}</div>
          )
        }
        const [r, c] = DECO_TILES[d.id] ?? [7, 7]
        return (
          <div key={d.id} className="absolute pointer-events-none"
            style={{ ...tileAnchor(r, c), fontSize: 20,
              filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))" }}>
            {d.emoji}
          </div>
        )
      })}

      {/* Fireflies */}
      {FIREFLIES.map((f, i) => (
        <span key={i} className="absolute rounded-full pointer-events-none" style={{
          left: `${f.x}%`, top: `${f.y}%`, width: 5, height: 5, zIndex: 35, opacity: 0,
          background: "#ffe9a3", boxShadow: "0 0 8px 3px rgba(255,224,130,0.75)",
          animation: `gardenFirefly ${5 + (i % 3)}s ease-in-out ${f.d}s infinite`,
        }} />
      ))}

      {/* Watering sparkles */}
      {sparkling && (
        <div className="absolute inset-0 z-40 pointer-events-none">
          {[36, 46, 54, 62, 44].map((x, i) => (
            <span key={i} className="absolute text-2xl"
              style={{ left: `${x}%`, top: `${40 + (i % 3) * 9}%`,
                animation: `gardenSparkle 1.4s ease-out ${i * 0.12}s both` }}>
              {i % 2 === 0 ? "💧" : "✨"}
            </span>
          ))}
        </div>
      )}

      {/* Habit plants — each on its own tile around the plaza */}
      {habits.slice(0, PLANT_SLOTS.length).map((h, i) => {
        const [r, c] = PLANT_SLOTS[i]
        const plantKey = (plantChoices[h.id] ?? "sunflower") as PlantKey
        const plant = PLANT_TYPES[plantKey] ?? PLANT_TYPES.sunflower
        const stage = getStage(h.streak, h.missedDays)
        const px = STAGE_PX[stage]
        const isMature = stage === 5
        const isDead = stage === 0

        return (
          <button key={h.id} onClick={() => onPlantClick(h.id)}
            className="absolute flex flex-col items-center gap-0.5 group focus:outline-none"
            style={tileAnchor(r, c)}>
            {/* Streak badge */}
            {h.streak > 0 && (
              <span className="text-[9px] font-bold bg-orange-500/80 text-white rounded-full px-1.5 py-0.5 leading-none mb-0.5">
                {h.streak}d🔥
              </span>
            )}
            {/* Plant emoji (hover scale on a wrapper so it doesn't fight the anchor transform) */}
            <span className="inline-block transition-transform group-hover:scale-110 group-active:scale-95">
              <span
                className="inline-block"
                style={{
                  fontSize: px,
                  lineHeight: 1,
                  filter: isDead
                    ? "grayscale(1) opacity(0.5)"
                    : isMature
                      ? "drop-shadow(0 0 8px rgba(255,230,50,0.8))"
                      : "drop-shadow(0 2px 3px rgba(0,0,0,0.3))",
                  animation: isMature
                    ? "gardenGlow 2s ease-in-out infinite"
                    : h.completedToday
                      ? "gardenFloat 3s ease-in-out infinite"
                      : undefined,
                }}
              >
                {plant.stages[stage]}
              </span>
            </span>
            {/* Label */}
            <span className="text-[9px] font-medium text-white/90 truncate max-w-[56px] leading-none mt-0.5"
              style={{ textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
              {h.name.length > 7 ? h.name.slice(0, 6) + "…" : h.name}
            </span>
          </button>
        )
      })}
      {habits.length === 0 && (
        <p className="absolute left-1/2 z-30 text-white/80 text-sm text-center px-6"
          style={{ top: "50%", transform: "translateX(-50%)", textShadow: "0 1px 4px rgba(0,0,0,0.6)" }}>
          No habits yet — add some in Habits to grow your garden
        </p>
      )}

      {/* Weather FX */}
      {theme.type === "rainy"  && <RainDrops />}
      {theme.type === "snowy"  && <Snowflakes />}
      {theme.type === "foggy"  && <FogLayer />}
      {theme.type === "stormy" && <><RainDrops /><LightningFlash /></>}

      {/* Cozy vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{
        zIndex: 45, boxShadow: "inset 0 0 80px rgba(18,14,36,0.35)", borderRadius: "inherit",
      }} />

      {/* Weather badge */}
      {weather && (
        <div className="absolute top-3 left-4 z-50 flex items-center gap-1.5 bg-black/25 backdrop-blur-sm rounded-full px-3 py-1">
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
  const [watering, setWatering]           = useState(false)
  const [sparkling, setSparkling]         = useState(false)

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
        setSparkling(true)
        setTimeout(() => setSparkling(false), 1800)
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
          100% { transform: translateY(470px); }
        }
        @keyframes gardenSnow {
          0%   { transform: translateY(-5px) translateX(0); }
          50%  { transform: translateY(210px) translateX(18px); }
          100% { transform: translateY(470px) translateX(-10px); }
        }
        @keyframes gardenBulb {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
        @keyframes gardenFirefly {
          0%, 100% { opacity: 0; transform: translate(0, 0); }
          25%      { opacity: 0.9; }
          50%      { opacity: 0.3; transform: translate(9px, -14px); }
          75%      { opacity: 0.8; transform: translate(-6px, -6px); }
        }
        @keyframes gardenGlowPulse {
          0%, 100% { filter: drop-shadow(0 0 6px rgba(255,190,90,0.8)); }
          50%      { filter: drop-shadow(0 0 16px rgba(255,190,90,1)); }
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
        @keyframes gardenSparkle {
          0%   { opacity: 0; transform: translateY(6px) scale(0.6); }
          30%  { opacity: 1; transform: translateY(-6px) scale(1.1); }
          100% { opacity: 0; transform: translateY(-22px) scale(0.9); }
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

        {/* Level banner + daily watering */}
        {data?.level && (
          <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 to-card px-4 py-3 flex items-center gap-3">
            <span className="text-3xl leading-none">{data.level.emoji}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <p className="text-sm font-bold">{data.level.name}</p>
                <p className="text-xs text-muted-foreground">Lv.{data.level.level} · {data.level.xp.toLocaleString()} XP</p>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${data.level.progress}%` }} />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">{data.level.xpToNext} XP to the next level</p>
            </div>
            <Button
              size="sm"
              variant={data.watered.today ? "ghost" : "default"}
              onClick={handleWater}
              disabled={data.watered.today || watering}
              className="shrink-0 gap-1.5"
            >
              💧 {data.watered.today ? "Watered ✓" : watering ? "Watering…" : "Water (+5 XP)"}
            </Button>
          </div>
        )}

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
          <div className="w-full rounded-2xl bg-secondary/30 flex items-center justify-center" style={{ height: 440 }}>
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <GardenScene
            habits={data?.habits ?? []}
            plantChoices={plantChoices}
            decorations={decorations}
            weather={data?.weather ?? null}
            level={data?.level.level ?? 1}
            sparkling={sparkling}
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
            unlocked={data?.unlocked ?? []}
            locked={data?.locked ?? []}
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
              ["💧", "Daily watering", "One tap a day, +5 XP each"],
              ["🧙 🦋", "Decorations", "Earned with streaks, XP & logs"],
              ["🌳 ⛲", "Level scenery", "The garden grows richer as you level"],
              ["🌧️", "Weather", "Reflects real weather outside"],
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
