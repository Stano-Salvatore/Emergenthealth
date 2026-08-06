"use client"

import { Fragment, useEffect, useState, useCallback, useRef, type CSSProperties, type ReactNode } from "react"
import { RefreshCw, Leaf, X, Check, Send, Sparkles } from "lucide-react"
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
const STAGE_PX  = [20, 20, 26, 32, 40, 48]
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

// Ground decorations live on the lawn (scene-% coords); sky ones float above.
const DECO_SPOTS: Record<string, { x: number; y: number; s: number }> = {
  gnome:    { x: 44,   y: 63.5, s: 21 },
  bird:     { x: 61,   y: 66,   s: 16 },
  stone:    { x: 86,   y: 59.5, s: 14 },
  mushroom: { x: 26,   y: 66,   s: 14 },
  ladybug:  { x: 52,   y: 73,   s: 11 },
  snail:    { x: 41,   y: 70.5, s: 12 },
  frog:     { x: 20,   y: 68,   s: 16 },
  fox:      { x: 68,   y: 68.5, s: 17 },
  hedgehog: { x: 47,   y: 76.5, s: 15 },
}
const DECO_SKY: Record<string, { x: number; y: number; s: number }> = {
  butterfly: { x: 30, y: 26, s: 20 },
  bee:       { x: 63, y: 22, s: 18 },
  rainbow:   { x: 50, y: 12, s: 30 },
}

// ─── Weather palettes ─────────────────────────────────────────────────────────
// The garden lives in a cozy perpetual dusk — weather shifts the light.

interface WeatherTheme {
  sky: string
  lawn: string; lawnDark: string; lawnEdge: string
  bedTop: string; bedTopB: string; bedSideL: string; bedSideR: string
  stone: string; stoneB: string; stoneSideL: string; stoneSideR: string; stoneLine: string
  wood: string; woodB: string; woodSideL: string; woodSideR: string; plank: string
  water: string; waterDeep: string
  type: "sunny"|"cloudy"|"foggy"|"rainy"|"snowy"|"stormy"
  icon: string; label: string
}

const P_WOOD = { wood:"#9a6a3c", woodB:"#8c5e34", woodSideL:"#5e3f23", woodSideR:"#6f4b29", plank:"rgba(50,30,16,0.5)" }
const P_WARM = {
  lawn:"#4e7a3a", lawnDark:"#446b33", lawnEdge:"#3a5c2b",
  bedTop:"#6fa14c", bedTopB:"#659647", bedSideL:"#2f4d20", bedSideR:"#3a5c28",
  stone:"#cec2ab", stoneB:"#c2b59c", stoneSideL:"#96866a", stoneSideR:"#a89877", stoneLine:"rgba(90,75,55,0.16)",
  ...P_WOOD, water:"#57aecb", waterDeep:"#3a89a8",
}
const P_DIM = {
  lawn:"#456b34", lawnDark:"#3c5e2d", lawnEdge:"#345226",
  bedTop:"#628f44", bedTopB:"#588540", bedSideL:"#2a441d", bedSideR:"#345224",
  stone:"#bdb098", stoneB:"#b1a48a", stoneSideL:"#87785e", stoneSideR:"#968769", stoneLine:"rgba(80,66,48,0.16)",
  ...P_WOOD, water:"#4a99b5", waterDeep:"#337892",
}
const P_DARK = {
  lawn:"#3a5a2e", lawnDark:"#324e28", lawnEdge:"#2a4221",
  bedTop:"#4d7336", bedTopB:"#456a31", bedSideL:"#223a17", bedSideR:"#2a461d",
  stone:"#a99c85", stoneB:"#9d9079", stoneSideL:"#756750", stoneSideR:"#82745a", stoneLine:"rgba(70,58,42,0.18)",
  ...P_WOOD, water:"#3a86a4", waterDeep:"#2a6a84",
}
const P_SNOW = {
  lawn:"#d7dfe9", lawnDark:"#c6d1de", lawnEdge:"#a9b8c9",
  bedTop:"#e3eaf2", bedTopB:"#d6dfe9", bedSideL:"#8fa0b5", bedSideR:"#9fb0c4",
  stone:"#e0dbd2", stoneB:"#d4cdc0", stoneSideL:"#a89f90", stoneSideR:"#b5ab9a", stoneLine:"rgba(90,80,70,0.13)",
  ...P_WOOD, water:"#a5cfe4", waterDeep:"#7fb3cc",
}

function getWeatherTheme(code?: number | null): WeatherTheme {
  if (code == null || code <= 1) return { sky:"linear-gradient(180deg,#2c3550 0%,#3c4a6e 40%,#6b5f7d 72%,#c98a63 100%)", ...P_WARM, type:"sunny",  icon:"☀️",  label:"Sunny"  }
  if (code <= 3)                 return { sky:"linear-gradient(180deg,#2b3550 0%,#4a5877 55%,#8d8398 100%)",             ...P_DIM,  type:"cloudy", icon:"⛅",  label:"Cloudy" }
  if (code <= 48)                return { sky:"linear-gradient(180deg,#3e4a5e 0%,#66748a 60%,#98a2b1 100%)",             ...P_DIM,  type:"foggy",  icon:"🌫️", label:"Foggy"  }
  if (code <= 67)                return { sky:"linear-gradient(180deg,#1e2738 0%,#35435c 60%,#526078 100%)",             ...P_DARK, type:"rainy",  icon:"🌧️", label:"Rainy"  }
  if (code <= 77)                return { sky:"linear-gradient(180deg,#5a6c8e 0%,#9fb2cc 60%,#cfd9e8 100%)",             ...P_SNOW, type:"snowy",  icon:"❄️",  label:"Snowy"  }
  return                                { sky:"linear-gradient(180deg,#121724 0%,#20283c 60%,#333e52 100%)",             ...P_DARK, type:"stormy", icon:"⛈️", label:"Stormy" }
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

// ─── Scene geometry ───────────────────────────────────────────────────────────
// One hand-drawn isometric diorama, coordinates in scene-%.

type Pt = [number, number]

const C = { x: 50, y: 49 }                 // plaza center
const PLAZA = { hw: 21, hh: 10.5 }
const BEDS  = { hw: 27.5, hh: 14 }         // outer edge of the raised-bed ring
const LAWN  = { hw: 46, hh: 24.5, cy: 55 }
const BED_LIFT = 3.4, PLAZA_LIFT = 1.1, DECK_LIFT = 3.2

const dia = (cx: number, cy: number, hw: number, hh: number): Pt[] =>
  [[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]]
const upPt = (p: Pt, dy: number): Pt => [p[0], p[1] - dy]

function quadStyle(pts: Pt[], z: number, bg: string): CSSProperties {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  const x0 = Math.min(...xs), y0 = Math.min(...ys)
  const w = Math.max(...xs) - x0, h = Math.max(...ys) - y0
  const poly = pts.map(p => `${(((p[0] - x0) / w) * 100).toFixed(2)}% ${(((p[1] - y0) / h) * 100).toFixed(2)}%`).join(",")
  return { position: "absolute", left: `${x0}%`, top: `${y0}%`, width: `${w}%`, height: `${h}%`,
    clipPath: `polygon(${poly})`, zIndex: z, background: bg }
}

function Quad({ pts, z, bg, style }: { pts: Pt[]; z: number; bg: string; style?: CSSProperties }) {
  return <div style={{ ...quadStyle(pts, z, bg), ...style }} />
}

// wall dropping height h below edge a→b
const wallPts = (a: Pt, b: Pt, h: number): Pt[] => [a, b, [b[0], b[1] + h], [a[0], a[1] + h]]

function Sprite({ x, y, s, z, children, style }: {
  x: number; y: number; s: number; z: number; children: ReactNode; style?: CSSProperties
}) {
  return (
    <div style={{ position: "absolute", left: `${x}%`, top: `${y}%`, transform: "translate(-50%,-100%)",
      fontSize: s, lineHeight: 1, zIndex: z, filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.45))",
      pointerEvents: "none", ...style }}>
      {children}
    </div>
  )
}

// Habit plant slots (10): on the bed ring and front lawn
const PLANT_SLOTS: Pt[] = [
  [38, 39.5], [43.5, 36.7], [48, 34.5],   // NW bed
  [56, 34.5], [62, 37.5], [68, 41],       // NE bed
  [60.5, 58],                             // SE bed
  [33, 64.5], [24, 60], [56.5, 63],       // front lawn
]

const STARS: Pt[] = [[6,5],[15,10],[26,4],[38,8],[52,3],[64,7],[76,11],[87,5],[94,10],[21,15],[71,16],[91,18],[45,13],[57,17]]
const LAWN_FLOWERS: [number, number, string][] = [
  [12,57,"#ffd9e8"],[18,52,"#fff"],[24,66,"#ffe9a3"],[8,61,"#fff"],[30,72,"#ffd9e8"],[40,76,"#fff"],
  [60,77,"#ffe9a3"],[70,72,"#ffd9e8"],[80,64,"#fff"],[88,57,"#ffe9a3"],[84,50,"#ffd9e8"],[76,44,"#fff"],
  [34,38,"#ffe9a3"],[42,34,"#ffd9e8"],[58,33,"#fff"],[66,37,"#ffd9e8"],[16,47,"#ffe9a3"],[57,71,"#fff"],
]
const BED_FLOWERS: [number, number][] = [[27,40],[33,36.5],[40,33.5],[47,31],[56,32],[63,35],[70,39],[74,43],[71,52],[66,57],[60,61],[30,46]]
const FIREFLIES: Pt[] = [[24,50],[36,62],[58,46],[73,57],[47,42],[81,46],[30,40],[64,66]]
const BULBS: Pt[] = [[7,10],[17,14],[29,16],[41,14],[52,9],[64,11],[76,13],[88,12],[97,11]]

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

// ─── Scene pieces ─────────────────────────────────────────────────────────────

function Pond({ x, y, hw, hh, theme, lily }: { x: number; y: number; hw: number; hh: number; theme: WeatherTheme; lily: boolean }) {
  return (
    <>
      <Quad pts={dia(x, y, hw + 1.1, hh + 0.7)} z={3} bg={theme.lawnEdge} />
      <Quad pts={dia(x, y, hw, hh)} z={3}
        bg={`radial-gradient(ellipse at 45% 38%, #79c8de 0 20%, ${theme.water} 52%, ${theme.waterDeep} 100%), radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(10,30,45,0.35) 100%)`} />
      <span style={{ position: "absolute", left: `${x - 2}%`, top: `${y - 0.6}%`, width: 5, height: 3,
        borderRadius: "50%", background: "rgba(255,255,255,0.35)", zIndex: 4 }} />
      {lily && <Sprite x={x} y={y + 0.6} s={15} z={4}>🪷</Sprite>}
    </>
  )
}

function PotShelf() {
  return (
    <>
      <div style={{ position: "absolute", left: "31.5%", top: "43.5%", transform: "translate(-50%,-100%)",
        width: 86, height: 64, zIndex: 9 }}>
        <div style={{ position: "absolute", left: 6, bottom: 0, width: 7, height: 58, background: "linear-gradient(90deg,#7d5530,#5e3f23)", borderRadius: 2 }} />
        <div style={{ position: "absolute", right: 6, bottom: 0, width: 7, height: 58, background: "linear-gradient(90deg,#7d5530,#5e3f23)", borderRadius: 2 }} />
        <div style={{ position: "absolute", left: 0, bottom: 22, width: "100%", height: 8, background: "linear-gradient(180deg,#a9743f,#8a5c33)", borderRadius: 2 }} />
        <div style={{ position: "absolute", left: 0, bottom: 52, width: "100%", height: 8, background: "linear-gradient(180deg,#a9743f,#8a5c33)", borderRadius: 2 }} />
      </div>
      <Sprite x={27} y={35.1} s={17} z={10}>🪴</Sprite>
      <Sprite x={31.5} y={35.1} s={16} z={10}>🌿</Sprite>
      <Sprite x={36} y={35.1} s={15} z={10}>🌵</Sprite>
      <Sprite x={28} y={39.8} s={14} z={10}>🍄</Sprite>
      <Sprite x={34} y={39.8} s={16} z={10}>🪻</Sprite>
      <Sprite x={31.5} y={43.3} s={14} z={10}>🧺</Sprite>
    </>
  )
}

function Gazebo() {
  return (
    <>
      <div style={{ position: "absolute", left: "71%", top: "40.5%", transform: "translate(-50%,-100%)",
        width: 132, height: 86, zIndex: 8 }}>
        <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 132, height: 80, borderRadius: "66px 66px 0 0", background: "rgba(20,26,20,0.18)" }} />
        <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 132, height: 80, border: "4px solid #7d5530", borderBottom: "none", borderRadius: "66px 66px 0 0" }} />
        <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 84, height: 80, border: "3px solid #6e4a29", borderBottom: "none", borderRadius: "42px 42px 0 0" }} />
        <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 30, height: 80, border: "3px solid #6e4a29", borderBottom: "none", borderRadius: "15px 15px 0 0" }} />
        <div style={{ position: "absolute", left: "50%", bottom: 22, transform: "translateX(-50%)", width: 126, height: 26, border: "2.5px solid #6e4a29", borderRadius: "50%" }} />
        <div style={{ position: "absolute", left: "50%", top: -9, transform: "translateX(-50%)", fontSize: 14 }}>🌿</div>
      </div>
      <Sprite x={64.5} y={40.5} s={15} z={9}>🌿</Sprite>
      <Sprite x={77.5} y={40.5} s={14} z={9}>🌿</Sprite>
      <Sprite x={71} y={36.5} s={15} z={9}
        style={{ filter: "drop-shadow(0 0 8px rgba(255,170,70,0.95))", animation: "gardenGlowPulse 3s ease-in-out infinite" }}>🏮</Sprite>
    </>
  )
}

function Deck({ theme }: { theme: WeatherTheme }) {
  const dk: Pt[] = [[70, 54], [81, 48.5], [90, 53.5], [79, 59]]
  return (
    <>
      <Quad pts={wallPts(upPt(dk[3], DECK_LIFT), upPt(dk[2], DECK_LIFT), DECK_LIFT + 1)} z={5}
        bg={`linear-gradient(180deg,${theme.woodSideR},${theme.woodSideL})`} />
      <Quad pts={wallPts(upPt(dk[0], DECK_LIFT), upPt(dk[3], DECK_LIFT), DECK_LIFT + 1)} z={5} bg={theme.woodSideL} />
      <Quad pts={dk.map(p => upPt(p, DECK_LIFT))} z={6}
        bg={`repeating-linear-gradient(63.4deg, transparent 0 9px, ${theme.plank} 9px 10px), linear-gradient(135deg, ${theme.wood} 0 60%, ${theme.woodB} 100%)`} />
      <Quad pts={[[76, 60.2], [82.5, 57], [85.5, 58.6], [79, 61.9]]} z={6}
        bg={`repeating-linear-gradient(63.4deg, transparent 0 9px, ${theme.plank} 9px 10px), ${theme.woodB}`} />
      {/* table + props */}
      <div style={{ position: "absolute", left: "83.5%", top: "50.2%", transform: "translate(-50%,-100%)", width: 52, height: 26, zIndex: 12 }}>
        <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", width: 52, height: 13, background: "linear-gradient(135deg,#a9743f,#8f5f33)", borderRadius: 4 }} />
        <div style={{ position: "absolute", left: "20%", top: 12, width: 6, height: 13, background: "#5e3f23" }} />
        <div style={{ position: "absolute", left: "74%", top: 12, width: 6, height: 13, background: "#5e3f23" }} />
      </div>
      <Sprite x={82.5} y={48.6} s={15} z={13}>🫖</Sprite>
      <Sprite x={86} y={49} s={14} z={13}>🪴</Sprite>
      <Sprite x={77.5} y={55.8} s={16} z={13}>🧺</Sprite>
      <Sprite x={88} y={55.2} s={13} z={13}
        style={{ filter: "drop-shadow(0 0 7px rgba(255,190,90,0.95))" }}>🕯️</Sprite>
    </>
  )
}

function PillarPlanters() {
  const pN = dia(C.x, C.y, PLAZA.hw, PLAZA.hh)
  const W: Pt = [pN[3][0] - 1.3, pN[3][1] - PLAZA_LIFT + 0.8]
  const S: Pt = [pN[2][0] - 1.3, pN[2][1] - PLAZA_LIFT + 0.8]
  return (
    <>
      {[W, S].map(([x, y], i) => (
        <div key={i}>
          <div style={{ position: "absolute", left: `${x}%`, top: `${y + 0.4}%`, transform: "translate(-50%,-100%)",
            width: 26, height: 34, zIndex: 12, background: "linear-gradient(90deg,#cfc2a8 0 55%,#a99a7c 55% 100%)",
            borderRadius: 3, boxShadow: "0 2px 4px rgba(0,0,0,0.4)" }} />
          <div style={{ position: "absolute", left: `${x}%`, top: `${y + 0.55}%`,
            transform: "translate(-50%,-100%) translateY(-34px)", width: 32, height: 7, zIndex: 12,
            background: "linear-gradient(180deg,#d8ccb2,#b3a385)", borderRadius: 2 }} />
        </div>
      ))}
      <Sprite x={W[0]} y={W[1] - 5.4} s={22} z={13}>🪴</Sprite>
      <Sprite x={S[0]} y={S[1] - 5.4} s={20} z={13}>🌷</Sprite>
    </>
  )
}

function Pedestal() {
  return (
    <>
      <div style={{ position: "absolute", left: `${C.x}%`, top: `${C.y + 2}%`, transform: "translate(-50%,-50%)",
        width: "26%", height: "20%", zIndex: 13, pointerEvents: "none",
        background: "radial-gradient(closest-side, rgba(255,180,90,0.32), rgba(255,150,70,0.10) 55%, transparent 78%)" }} />
      <div style={{ position: "absolute", left: `${C.x}%`, top: `${C.y + 3.5}%`, transform: "translate(-50%,-100%)",
        width: 64, height: 58, zIndex: 14, pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 64, height: 30,
          clipPath: "polygon(50% 0,100% 26%,100% 74%,50% 100%,0 74%,0 26%)",
          background: "linear-gradient(90deg,#9a5c40 0 50%,#8a4f36 50% 100%)" }} />
        <div style={{ position: "absolute", left: "50%", bottom: 20, transform: "translateX(-50%)", width: 64, height: 32,
          clipPath: "polygon(50% 0,100% 50%,50% 100%,0 50%)",
          background: `repeating-linear-gradient(63.4deg, transparent 0 12px, rgba(60,30,18,0.3) 12px 13px),
            repeating-linear-gradient(116.6deg, transparent 0 12px, rgba(60,30,18,0.3) 12px 13px),
            linear-gradient(135deg,#a86a4a,#95573a)` }} />
        <div style={{ position: "absolute", left: "50%", bottom: 32, transform: "translateX(-50%)", width: 34, height: 10,
          background: "linear-gradient(180deg,#e8c979,#c9a24e)", borderRadius: "50%" }} />
      </div>
      <div style={{ position: "absolute", left: `${C.x}%`, top: `${C.y - 3.2}%`, transform: "translate(-50%,-100%)",
        fontSize: 30, lineHeight: 1, zIndex: 15, pointerEvents: "none", animation: "gardenGlowPulse 3s ease-in-out infinite",
        filter: "sepia(1) saturate(2.6) hue-rotate(-12deg) brightness(1.35) drop-shadow(0 0 14px rgba(255,200,90,1)) drop-shadow(0 0 30px rgba(255,170,60,0.75))" }}>
        🌷
      </div>
      {[[46.5, 44], [54, 43.5], [50, 41.5]].map(([x, y], i) => (
        <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, fontSize: 11, zIndex: 15,
          opacity: 0.9, animation: `gardenFloat ${3 + i}s ease-in-out ${i * 0.6}s infinite` }}>✨</span>
      ))}
    </>
  )
}

// ─── Garden scene (the full game screen) ─────────────────────────────────────

function GardenScene({
  habits, plantChoices, decorations, weather, level, levelInfo, watered, watering, sparkling,
  onPlantClick, onWater, onEmergy, onDecorate, onRefresh, loading, emergyOpen, decorateOpen,
}: {
  habits: HabitData[]
  plantChoices: Record<string, string>
  decorations: string[]
  weather: { code: number; temp: number } | null
  level: number
  levelInfo: GardenData["level"] | null
  watered: boolean
  watering: boolean
  sparkling: boolean
  onPlantClick: (id: string) => void
  onWater: () => void
  onEmergy: () => void
  onDecorate: () => void
  onRefresh: () => void
  loading: boolean
  emergyOpen: boolean
  decorateOpen: boolean
}) {
  const theme = getWeatherTheme(weather?.code)
  const activeDecos = ALL_DECORATIONS.filter(d => decorations.includes(d.id))
  const lawnPts = dia(C.x, LAWN.cy, LAWN.hw, LAWN.hh)
  const pN = dia(C.x, C.y, PLAZA.hw, PLAZA.hh)
  const bN = dia(C.x, C.y, BEDS.hw, BEDS.hh)
  const ring = [
    { o: [bN[3], bN[0]] as [Pt, Pt], i: [pN[3], pN[0]] as [Pt, Pt] },
    { o: [bN[0], bN[1]] as [Pt, Pt], i: [pN[0], pN[1]] as [Pt, Pt] },
    { o: [bN[1], bN[2]] as [Pt, Pt], i: [pN[1], pN[2]] as [Pt, Pt] },
  ]

  return (
    <div className="w-full overflow-x-auto rounded-3xl">
      <div className="relative select-none min-w-[680px]" style={{ height: 620 }}>
        {/* Sky + stars */}
        <div className="absolute inset-0" style={{ background: theme.sky }} />
        {STARS.map(([x, y], i) => (
          <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: i % 3 ? 2 : 3,
            height: i % 3 ? 2 : 3, borderRadius: "50%", background: "#fff", opacity: 0.3 + (i % 4) * 0.15, zIndex: 1 }} />
        ))}

        {/* Lawn island */}
        <Quad pts={lawnPts.map(([x, y]) => [x, y + 2.6] as Pt)} z={1} bg="#2e2013"
          style={{ filter: "drop-shadow(0 16px 22px rgba(0,0,0,0.55))" }} />
        <Quad pts={lawnPts.map(([x, y]) => [x, y + 1.4] as Pt)} z={1} bg="#3d2b1a" />
        <Quad pts={lawnPts} z={2} bg={`
          radial-gradient(ellipse at 50% 45%, rgba(255,200,120,0.10), transparent 55%),
          radial-gradient(ellipse at 30% 65%, ${theme.lawnDark} 0 8%, transparent 9%),
          radial-gradient(ellipse at 72% 40%, ${theme.lawnDark} 0 7%, transparent 8%),
          radial-gradient(ellipse at 60% 75%, ${theme.lawnDark} 0 6%, transparent 7%),
          ${theme.lawn}`} />
        {LAWN_FLOWERS.map(([x, y, color], i) => (
          <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: 3, height: 3,
            borderRadius: "50%", background: color, opacity: 0.9, zIndex: 3 }} />
        ))}

        {/* Ponds — second one unlocks at level 3, lilies at level 5 */}
        <Pond x={13.5} y={58} hw={9} hh={4.5} theme={theme} lily={level >= 5} />
        {level >= 3 && <Pond x={31} y={72.5} hw={8} hh={4} theme={theme} lily={level >= 5} />}

        {/* Raised bed ring */}
        {ring.map(({ o, i }, k) => (
          <Fragment key={k}>
            <Quad pts={wallPts(upPt(o[0], BED_LIFT), upPt(o[1], BED_LIFT), BED_LIFT + 1.2)} z={5}
              bg={`linear-gradient(180deg,${theme.bedSideR},${theme.bedSideL})`} />
            <Quad pts={[upPt(o[0], BED_LIFT), upPt(o[1], BED_LIFT), upPt(i[1], BED_LIFT), upPt(i[0], BED_LIFT)]} z={6}
              bg={`radial-gradient(ellipse at 20% 50%, ${theme.bedTopB} 0 12%, transparent 13%),
                   radial-gradient(ellipse at 55% 30%, ${theme.bedTopB} 0 10%, transparent 11%),
                   radial-gradient(ellipse at 80% 60%, ${theme.bedTopB} 0 11%, transparent 12%),
                   ${theme.bedTop}`} />
            <Quad pts={wallPts(upPt(i[0], BED_LIFT), upPt(i[1], BED_LIFT), BED_LIFT)} z={6} bg={theme.bedSideL} />
            <Quad pts={[upPt(o[0], BED_LIFT), upPt(o[1], BED_LIFT), upPt(o[1], BED_LIFT - 0.5), upPt(o[0], BED_LIFT - 0.5)]} z={7}
              bg="rgba(160,205,110,0.45)" />
          </Fragment>
        ))}
        {BED_FLOWERS.map(([x, y], i) => (
          <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y - BED_LIFT}%`, width: 4, height: 4,
            borderRadius: "50%", background: ["#ffd9e8", "#ffe9a3", "#f6b6ce", "#fff"][i % 4], opacity: 0.95, zIndex: 7 }} />
        ))}

        {/* Plaza */}
        <Quad pts={wallPts(upPt(pN[3], PLAZA_LIFT), upPt(pN[2], PLAZA_LIFT), PLAZA_LIFT + 0.4)} z={5} bg={theme.stoneSideL} />
        <Quad pts={wallPts(upPt(pN[2], PLAZA_LIFT), upPt(pN[1], PLAZA_LIFT), PLAZA_LIFT + 0.4)} z={5} bg={theme.stoneSideR} />
        <Quad pts={pN.map(p => upPt(p, PLAZA_LIFT))} z={6} bg={`
          radial-gradient(ellipse at 50% 50%, rgba(255,190,110,0.10), transparent 60%),
          repeating-linear-gradient(63.4deg, transparent 0 52px, ${theme.stoneLine} 52px 53.2px),
          repeating-linear-gradient(116.6deg, transparent 0 52px, ${theme.stoneLine} 52px 53.2px),
          linear-gradient(135deg, ${theme.stone} 0 55%, ${theme.stoneB} 100%)`} />

        {/* Structures — unlock as the garden levels up */}
        <Pedestal />
        {level >= 2 && <PotShelf />}
        {level >= 4 && (
          <>
            <Sprite x={13} y={53.5} s={36} z={4}>🌳</Sprite>
            <Sprite x={87.5} y={52.5} s={34} z={4}>🌲</Sprite>
          </>
        )}
        {level >= 5 && <Deck theme={theme} />}
        {level >= 6 && <Gazebo />}
        {level >= 7 && <PillarPlanters />}
        {level >= 8 && <Sprite x={50} y={31.6} s={34} z={4}>🏡</Sprite>}

        {/* Plaza props */}
        <Sprite x={59} y={60.5} s={19} z={14}
          style={{ filter: "drop-shadow(0 0 10px rgba(255,170,70,0.95))", animation: "gardenGlowPulse 3.6s ease-in-out infinite" }}>🏮</Sprite>

        {/* Decorations */}
        {activeDecos.map(d => {
          const sky = DECO_SKY[d.id]
          if (sky) {
            return (
              <Sprite key={d.id} x={sky.x} y={sky.y} s={sky.s} z={32}
                style={{ animation: "gardenFloat 4s ease-in-out infinite", filter: "none" }}>{d.emoji}</Sprite>
            )
          }
          const spot = DECO_SPOTS[d.id] ?? { x: 50, y: 70, s: 15 }
          return <Sprite key={d.id} x={spot.x} y={spot.y} s={spot.s} z={8}>{d.emoji}</Sprite>
        })}

        {/* Habit plants in pots */}
        {habits.slice(0, PLANT_SLOTS.length).map((h, i) => {
          const [x, y] = PLANT_SLOTS[i]
          const plantKey = (plantChoices[h.id] ?? "sunflower") as PlantKey
          const plant = PLANT_TYPES[plantKey] ?? PLANT_TYPES.sunflower
          const stage = getStage(h.streak, h.missedDays)
          const px = STAGE_PX[stage]
          const isMature = stage === 5
          const isDead = stage === 0
          return (
            <button key={h.id} onClick={() => onPlantClick(h.id)}
              className="absolute group focus:outline-none"
              style={{ left: `${x}%`, top: `${y}%`, transform: "translate(-50%,-100%)", zIndex: 16, width: 44, height: 20 + px }}>
              {/* pot */}
              <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", width: 30, height: 20 }}>
                <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", width: 30, height: 7,
                  background: "linear-gradient(180deg,#cf7748,#b35f35)", borderRadius: 3 }} />
                <div style={{ position: "absolute", left: "50%", top: 6, transform: "translateX(-50%)", width: 24, height: 14,
                  background: "linear-gradient(90deg,#c06a3d 0 55%,#9c5230 55% 100%)",
                  clipPath: "polygon(6% 0,94% 0,78% 100%,22% 100%)" }} />
              </div>
              {/* plant */}
              <span className="inline-block transition-transform group-hover:scale-110 group-active:scale-95"
                style={{ position: "absolute", left: "50%", bottom: 17, transform: "translateX(-50%)" }}>
                <span className="inline-block" style={{
                  fontSize: px, lineHeight: 1,
                  filter: isDead ? "grayscale(1) opacity(0.55)"
                    : isMature ? "drop-shadow(0 0 8px rgba(255,230,50,0.8))"
                    : "drop-shadow(0 2px 3px rgba(0,0,0,0.4))",
                  animation: isMature ? "gardenGlow 2s ease-in-out infinite"
                    : h.completedToday ? "gardenFloat 3s ease-in-out infinite" : undefined,
                }}>
                  {plant.stages[stage]}
                </span>
              </span>
              {/* streak chip */}
              {h.streak > 0 && (
                <span style={{ position: "absolute", left: "50%", bottom: 17 + px + 3, transform: "translateX(-50%)",
                  background: "rgba(24,20,14,0.8)", border: "1px solid rgba(255,180,80,0.55)", color: "#ffd08e",
                  fontSize: 9, fontWeight: 700, borderRadius: 99, padding: "2px 6px", lineHeight: 1, whiteSpace: "nowrap" }}>
                  {h.streak}d
                </span>
              )}
              {/* label */}
              <span style={{ position: "absolute", left: "50%", bottom: -13, transform: "translateX(-50%)",
                color: "rgba(255,246,224,0.95)", fontSize: 9.5, fontWeight: 600, whiteSpace: "nowrap",
                textShadow: "0 1px 3px rgba(0,0,0,0.95)" }}>
                {h.name.length > 9 ? h.name.slice(0, 8) + "…" : h.name}
              </span>
            </button>
          )
        })}
        {habits.length === 0 && !loading && (
          <p className="absolute left-1/2 z-30 text-sm text-center px-6" style={{ top: "68%", transform: "translateX(-50%)",
            color: "rgba(255,246,224,0.95)", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}>
            No habits yet — add some in Habits to grow your garden 🌱
          </p>
        )}

        {/* Fireflies */}
        {theme.type !== "snowy" && FIREFLIES.map(([x, y], i) => (
          <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: 5, height: 5,
            borderRadius: "50%", background: "#ffe9a3", boxShadow: "0 0 9px 3px rgba(255,224,130,0.8)",
            zIndex: 33, opacity: 0, animation: `gardenFirefly ${5 + (i % 3)}s ease-in-out ${(i * 0.7) % 3}s infinite` }} />
        ))}

        {/* String lights + hanging stars (stars at level 9) */}
        <svg className="absolute inset-x-0 top-0 w-full pointer-events-none" style={{ height: "30%", zIndex: 31 }}
          viewBox="0 0 100 30" preserveAspectRatio="none">
          <path d="M-2,7 Q28,20 55,9 T102,12" fill="none" stroke="rgba(35,26,18,0.65)" strokeWidth="0.35" />
          {BULBS.map(([x, y], i) => (
            <circle key={i} cx={x} cy={y + 1.3} r="0.55" fill={i % 2 ? "#ffd98c" : "#ffe9b0"}
              style={{ filter: "drop-shadow(0 0 1.6px rgba(255,205,115,0.95))",
                animation: `gardenBulb 2.4s ease-in-out ${i * 0.3}s infinite` }} />
          ))}
        </svg>
        {level >= 9 && [[9, 13], [13, 18], [17, 12]].map(([x, y], i) => (
          <div key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, fontSize: 12, zIndex: 31,
            filter: "drop-shadow(0 0 5px rgba(255,220,130,0.9))", animation: `gardenFloat ${4 + i}s ease-in-out infinite` }}>⭐</div>
        ))}

        {/* Watering sparkles */}
        {sparkling && (
          <div className="absolute inset-0 z-[38] pointer-events-none">
            {[40, 47, 53, 60, 44, 57].map((x, i) => (
              <span key={i} className="absolute text-2xl"
                style={{ left: `${x}%`, top: `${42 + (i % 3) * 7}%`,
                  animation: `gardenSparkle 1.4s ease-out ${i * 0.12}s both` }}>
                {i % 2 === 0 ? "💧" : "✨"}
              </span>
            ))}
          </div>
        )}

        {/* Weather FX */}
        {theme.type === "rainy"  && <RainDrops />}
        {theme.type === "snowy"  && <Snowflakes />}
        {theme.type === "foggy"  && <FogLayer />}
        {theme.type === "stormy" && <><RainDrops /><LightningFlash /></>}

        {/* Atmosphere */}
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 42,
          background: "radial-gradient(ellipse at 50% 50%, rgba(255,170,80,0.08), transparent 60%)" }} />
        <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 43,
          boxShadow: "inset 0 0 130px rgba(12,9,28,0.62)", borderRadius: "inherit" }} />

        {/* ── Game UI chrome ── */}
        {/* Level chip */}
        {levelInfo && (
          <div className="absolute z-50" style={{ top: 14, left: 14 }}>
            <div className="flex items-center gap-2.5 rounded-2xl px-3.5 py-2 pl-2.5"
              style={{ background: "rgba(22,26,22,0.82)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-center rounded-xl" style={{ width: 34, height: 34, background: "rgba(255,255,255,0.1)", fontSize: 19 }}>
                {levelInfo.emoji}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center justify-center rounded-full font-extrabold"
                    style={{ background: "#3e5d33", color: "#cde8b0", fontSize: 10, width: 18, height: 18 }}>
                    {levelInfo.level}
                  </span>
                  <span className="font-bold" style={{ color: "#f2efe4", fontSize: 13 }}>{levelInfo.name}</span>
                </div>
                <div className="mt-1 rounded-full" style={{ width: 120, height: 6, background: "rgba(255,255,255,0.14)" }}>
                  <div className="h-full rounded-full" style={{ width: `${levelInfo.progress}%`, background: "linear-gradient(90deg,#8fd05e,#5fae3d)" }} />
                </div>
                <div className="mt-0.5 font-semibold" style={{ color: "#a9c790", fontSize: 9 }}>
                  {levelInfo.xp.toLocaleString()} XP · {levelInfo.xpToNext} to next
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Weather chip + refresh */}
        {weather && (
          <div className="absolute z-50 flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ top: 14, right: 64,
            background: "rgba(22,26,22,0.82)", backdropFilter: "blur(6px)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ fontSize: 13 }}>{theme.icon}</span>
            <span className="font-semibold" style={{ color: "#f2efe4", fontSize: 11.5 }}>{weather.temp}°C · {theme.label}</span>
          </div>
        )}
        <button onClick={onRefresh} disabled={loading}
          className="absolute z-50 flex items-center justify-center rounded-full transition-opacity hover:opacity-80"
          style={{ top: 12, right: 14, width: 38, height: 38, background: "rgba(22,26,22,0.82)",
            border: "1px solid rgba(255,255,255,0.1)", color: "#cfe6b8" }}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>

        {/* Round corner buttons */}
        <button onClick={onEmergy}
          className="absolute z-50 flex flex-col items-center justify-center gap-0 transition-transform hover:scale-105 active:scale-95"
          style={{ bottom: 16, left: 16, width: 58, height: 58, borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, #6f9c50, #46702f)",
            border: emergyOpen ? "3px solid #ffe9b0" : "3px solid rgba(240,240,220,0.85)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
          <span style={{ fontSize: 19 }}>✨</span>
          <span className="font-bold" style={{ color: "#f4f2e2", fontSize: 8.5 }}>Emergy</span>
        </button>
        <button onClick={onDecorate}
          className="absolute z-50 flex flex-col items-center justify-center gap-0 transition-transform hover:scale-105 active:scale-95"
          style={{ bottom: 16, right: 16, width: 58, height: 58, borderRadius: "50%",
            background: "radial-gradient(circle at 35% 30%, #6f9c50, #46702f)",
            border: decorateOpen ? "3px solid #ffe9b0" : "3px solid rgba(240,240,220,0.85)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}>
          <span style={{ fontSize: 19 }}>🪨</span>
          <span className="font-bold" style={{ color: "#f4f2e2", fontSize: 8.5 }}>Decorate</span>
        </button>

        {/* Bottom card bar: Water + habit cards */}
        <div className="absolute z-50 flex gap-2 overflow-x-auto rounded-2xl p-2"
          style={{ bottom: 14, left: 88, right: 88, background: "rgba(22,26,22,0.55)", backdropFilter: "blur(6px)" }}>
          <button onClick={onWater} disabled={watered || watering}
            className="relative shrink-0 flex flex-col items-center gap-1 rounded-xl px-1 pt-2 pb-1.5 transition-transform hover:scale-105 active:scale-95 disabled:hover:scale-100"
            style={{ width: 72, background: "linear-gradient(180deg,#faf4e2,#efe6cc)",
              border: watered ? "2px solid #b9d89a" : "2px solid #8fd05e",
              boxShadow: "0 3px 8px rgba(0,0,0,0.35)", opacity: watered ? 0.75 : 1 }}>
            <span style={{ fontSize: 24, lineHeight: 1 }}>💧</span>
            <span className="font-bold" style={{ color: "#4a3f2c", fontSize: 10 }}>
              {watered ? "Watered" : watering ? "…" : "Water"}
            </span>
            <span className="absolute font-extrabold" style={{ right: 5, bottom: 3, color: "#7a6f56", fontSize: 9 }}>
              {watered ? "✓" : "+5"}
            </span>
          </button>
          {habits.map(h => {
            const plantKey = (plantChoices[h.id] ?? "sunflower") as PlantKey
            const plant = PLANT_TYPES[plantKey] ?? PLANT_TYPES.sunflower
            const stage = getStage(h.streak, h.missedDays)
            return (
              <button key={h.id} onClick={() => onPlantClick(h.id)}
                className="relative shrink-0 flex flex-col items-center gap-1 rounded-xl px-1 pt-2 pb-1.5 transition-transform hover:scale-105 active:scale-95"
                style={{ width: 72, background: "linear-gradient(180deg,#faf4e2,#efe6cc)", border: "2px solid #dccfae",
                  boxShadow: "0 3px 8px rgba(0,0,0,0.35)" }}>
                <span style={{ fontSize: 24, lineHeight: 1,
                  filter: stage === 0 ? "grayscale(1) opacity(0.5)" : undefined }}>
                  {plant.stages[stage]}
                </span>
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

  return (
    <>
      {/* CSS keyframes injected once */}
      <style>{`
        @keyframes gardenRain {
          0%   { transform: translateY(-5px); }
          100% { transform: translateY(650px); }
        }
        @keyframes gardenSnow {
          0%   { transform: translateY(-5px) translateX(0); }
          50%  { transform: translateY(300px) translateX(18px); }
          100% { transform: translateY(650px) translateX(-10px); }
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
          0%, 100% { opacity: 0.92; }
          50%      { opacity: 1; }
        }
        @keyframes gardenFloat {
          0%, 100% { transform: translateY(0px); }
          50%      { transform: translateY(-8px); }
        }
        @keyframes gardenGlow {
          0%, 100% { filter: drop-shadow(0 0 4px rgba(255,230,50,0.7)); }
          50%      { filter: drop-shadow(0 0 14px rgba(255,230,50,1)); }
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
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Leaf className="h-6 w-6 text-green-400" /> Garden
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Your habits, growing in a cozy corner of the world
          </p>
        </div>

        {/* Game screen */}
        {loading && !data ? (
          <div className="w-full rounded-3xl bg-secondary/30 flex items-center justify-center" style={{ height: 620 }}>
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <GardenScene
            habits={data?.habits ?? []}
            plantChoices={plantChoices}
            decorations={decorations}
            weather={data?.weather ?? null}
            level={data?.level.level ?? 1}
            levelInfo={data?.level ?? null}
            watered={data?.watered.today ?? false}
            watering={watering}
            sparkling={sparkling}
            loading={loading}
            emergyOpen={showEmergy}
            decorateOpen={showDecos}
            onPlantClick={id => { setSelectedHabitId(id); setShowDecos(false); setShowEmergy(false) }}
            onWater={handleWater}
            onEmergy={() => { setShowEmergy(v => !v); setShowDecos(false); setSelectedHabitId(null) }}
            onDecorate={() => { setShowDecos(v => !v); setShowEmergy(false); setSelectedHabitId(null) }}
            onRefresh={load}
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
              ["🏡 ⛲", "Level scenery", "Ponds, decks & gazebos unlock as you level"],
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
