// Garden engine — PixiJS isometric tile-grid renderer for the habit garden.
//
// Design notes:
// - The garden is a COLS×ROWS grid; each cell has a ground type derived from
//   the garden level (plaza, ponds, deck expand as you level). Objects (habit
//   plant pots, earned decorations) sit on cells and can be dragged in edit
//   mode; only their positions are persisted ({ placed: { id: {x,y} } }).
// - Art comes from an asset registry. Every sprite key resolves to either a
//   painted PNG under /garden-assets/<key>.png (if present) or a generated
//   fallback (emoji rendered to canvas / procedural Graphics). Dropping PNGs
//   into public/garden-assets upgrades the art with no code changes.
// - The canvas is transparent; the sky gradient, string lights and vignette
//   are cheap CSS layers owned by the React wrapper.

import {
  Application, Assets, CanvasSource, Container, Graphics, Sprite, Text, Texture, Ticker,
  type FederatedPointerEvent,
} from "pixi.js"

// ─── Grid / projection ────────────────────────────────────────────────────────

export const COLS = 10
export const ROWS = 10
const TW = 76            // tile width (px, world space)
const TH = 38            // tile height
const SKIRT = 20         // visible block thickness on south-facing edges

export interface Cell { x: number; y: number }

const cellKey = (c: Cell) => `${c.x},${c.y}`
const inGrid = (c: Cell) => c.x >= 0 && c.x < COLS && c.y >= 0 && c.y < ROWS

// cell → world coords of the tile's center
function cellToWorld(c: Cell): { wx: number; wy: number } {
  return { wx: (c.x - c.y) * (TW / 2), wy: (c.x + c.y) * (TH / 2) }
}
function worldToCell(wx: number, wy: number): Cell {
  const fx = (wx / (TW / 2) + wy / (TH / 2)) / 2
  const fy = (wy / (TH / 2) - wx / (TW / 2)) / 2
  return { x: Math.round(fx), y: Math.round(fy) }
}

// ─── Ground map (derived from level, not persisted) ──────────────────────────

export type Ground = "grass" | "stone" | "water" | "wood"

export function buildGroundMap(level: number): Ground[][] {
  const g: Ground[][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => "grass" as Ground))
  // stone plaza
  for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) g[y][x] = "stone"
  // first pond
  g[6][1] = "water"; g[7][1] = "water"; g[7][2] = "water"
  // second pond at level 3
  if (level >= 3) { g[8][4] = "water"; g[8][5] = "water" }
  // wooden deck at level 5
  if (level >= 5) for (let y = 3; y <= 5; y++) for (let x = 8; x <= 9; x++) g[y][x] = "wood"
  return g
}

// ─── Asset registry ───────────────────────────────────────────────────────────
// key → fallback emoji + display size. A painted override may exist at
// /garden-assets/<key>.png — the loader prefers it when it loads.

interface AssetDef { emoji: string; size: number }

const SPRITE_DEFS: Record<string, AssetDef> = {
  // structures
  tree_oak:   { emoji: "🌳", size: 84 },
  tree_pine:  { emoji: "🌲", size: 80 },
  house:      { emoji: "🏡", size: 72 },
  shelf:      { emoji: "🪜", size: 60 },
  lantern:    { emoji: "🏮", size: 40 },
  lily:       { emoji: "🪷", size: 34 },
  teapot:     { emoji: "🫖", size: 30 },
  basket:     { emoji: "🧺", size: 34 },
  candle:     { emoji: "🕯️", size: 26 },
  potted:     { emoji: "🪴", size: 38 },
  // decorations (ids match the earned-decoration system)
  gnome:      { emoji: "🧙", size: 44 },
  bird:       { emoji: "🐦", size: 32 },
  stone:      { emoji: "🪨", size: 30 },
  mushroom:   { emoji: "🍄", size: 30 },
  ladybug:    { emoji: "🐞", size: 22 },
  snail:      { emoji: "🐌", size: 24 },
  frog:       { emoji: "🐸", size: 32 },
  fox:        { emoji: "🦊", size: 36 },
  hedgehog:   { emoji: "🦔", size: 30 },
  butterfly:  { emoji: "🦋", size: 30 },
  bee:        { emoji: "🐝", size: 26 },
  rainbow:    { emoji: "🌈", size: 60 },
  bloom:      { emoji: "🌼", size: 34 },
  // habit plant growth stages (shared) + one mature "model" per plant type
  plant_wilt:      { emoji: "🥀", size: 22 },
  plant_seed:      { emoji: "🌱", size: 16 },
  plant_sprout:    { emoji: "🌿", size: 24 },
  plant_leafy:     { emoji: "🌿", size: 32 },
  bloom_sunflower: { emoji: "🌻", size: 46 },
  bloom_rose:      { emoji: "🌹", size: 44 },
  bloom_cactus:    { emoji: "🌵", size: 42 },
  bloom_mushroom:  { emoji: "🍄", size: 38 },
  bloom_bamboo:    { emoji: "🎋", size: 48 },
  bloom_sakura:    { emoji: "🌸", size: 46 },
  bloom_oak:       { emoji: "🌳", size: 46 },
  bloom_tulip:     { emoji: "🌷", size: 42 },
  bloom_fern:      { emoji: "🌿", size: 40 },
  bloom_bonsai:    { emoji: "🪴", size: 42 },
  bird_fly:   { emoji: "🐦", size: 28 },
  petal:      { emoji: "🌸", size: 12 },
  sparkle:    { emoji: "✨", size: 22 },
  droplet:    { emoji: "💧", size: 20 },
  star:       { emoji: "⭐", size: 20 },
}

const textureCache = new Map<string, Texture>()

function emojiTexture(emoji: string, px: number): Texture {
  const key = `emoji:${emoji}:${px}`
  const hit = textureCache.get(key)
  if (hit) return hit
  const scale = 2
  const c = document.createElement("canvas")
  c.width = c.height = Math.ceil(px * scale)
  const ctx = c.getContext("2d")!
  ctx.font = `${Math.floor(px * scale * 0.86)}px serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(emoji, c.width / 2, c.height / 2 + px * scale * 0.04)
  // canvas is oversampled 2× for crispness; resolution makes it display at px
  const t = new Texture({ source: new CanvasSource({ resource: c, resolution: scale }) })
  textureCache.set(key, t)
  return t
}

// Resolves a sprite texture synchronously (emoji fallback now); if a painted
// override exists at /garden-assets/<key>.png it is swapped in when loaded.
function spriteTextureSync(key: string, onUpgrade: (t: Texture, key: string) => void): Texture {
  const cached = textureCache.get(`asset:${key}`)
  if (cached) return cached
  const def = SPRITE_DEFS[key]
  const fallback = emojiTexture(def?.emoji ?? "❓", def?.size ?? 32)
  // fire-and-forget upgrade
  Assets.load<Texture>({ src: `/garden-assets/${key}.png` })
    .then(t => { textureCache.set(`asset:${key}`, t); onUpgrade(t, key) })
    .catch(() => { textureCache.set(`asset:${key}`, fallback) })
  return fallback
}

// Painted PNGs are baked at 2x (any scale, really) — normalize the sprite so
// its on-screen height stays the registry size regardless of texture source.
function paintSprite(s: Sprite, key: string): (t: Texture) => void {
  return (t: Texture) => {
    if (s.destroyed) return
    s.texture = t
    const def = SPRITE_DEFS[key]
    if (def && t.height > 0) s.scale.set(def.size / t.height)
  }
}

// ─── Ground tile textures (procedural) ────────────────────────────────────────

interface GroundColors { top: number; topAlt: number; sideL: number; sideR: number; edge: number }

const GROUND_COLORS: Record<Ground, GroundColors> = {
  grass: { top: 0x5c8a44, topAlt: 0x527c3c, sideL: 0x33511f, sideR: 0x3f6128, edge: 0x74a356 },
  stone: { top: 0xcec2ab, topAlt: 0xc2b59c, sideL: 0x96866a, sideR: 0xa89877, edge: 0xdfd5c0 },
  water: { top: 0x4fa8c8, topAlt: 0x4fa8c8, sideL: 0x2e7591, sideR: 0x37809d, edge: 0x7fc8de },
  wood:  { top: 0x9a6a3c, topAlt: 0x8c5e34, sideL: 0x5e3f23, sideR: 0x6f4b29, edge: 0xb28049 },
}

// four texture variants per ground type so neighbouring tiles never repeat
function tileTexture(app: Application, ground: Ground, variant: number): Texture {
  const key = `tile:${ground}:${variant}`
  const hit = textureCache.get(key)
  if (hit) return hit
  const alt = variant % 2 === 1
  const c = GROUND_COLORS[ground]
  const g = new Graphics()
  const hw = TW / 2, hh = TH / 2

  if (ground === "water") {
    // sunken basin: grassy rim + thick sides, water surface recessed below
    const gr = GROUND_COLORS.grass
    g.poly([-hw, hh, 0, TH, 0, TH + SKIRT, -hw, hh + SKIRT]).fill(gr.sideL)
    g.poly([0, TH, hw, hh, hw, hh + SKIRT, 0, TH + SKIRT]).fill(gr.sideR)
    g.poly([0, 0, hw, hh, 0, TH, -hw, hh]).fill(gr.top)
    // inner walls of the basin (visible on the north faces)
    const s = 0.78, dy = 7
    g.poly([0, TH * (1 - s) / 2 + dy - 6, hw * s, hh + dy - 6, hw * s, hh + dy, 0, TH - (TH * (1 - s)) / 2 + dy]).fill(0x2c4a26)
    g.poly([0, TH * (1 - s) / 2 + dy - 6, -hw * s, hh + dy - 6, -hw * s, hh + dy, 0, TH - (TH * (1 - s)) / 2 + dy]).fill(0x223a1e)
    // water surface
    g.poly([0, TH * (1 - s) / 2 + dy, hw * s, hh + dy, 0, TH - (TH * (1 - s)) / 2 + dy, -hw * s, hh + dy]).fill(c.top)
    // shading near the far walls + glint
    g.poly([0, TH * (1 - s) / 2 + dy, hw * s, hh + dy, hw * s - 8, hh + dy, 0, TH * (1 - s) / 2 + dy + 4]).fill({ color: 0x1e4a5e, alpha: 0.4 })
    g.poly([0, TH * (1 - s) / 2 + dy, -hw * s, hh + dy, -hw * s + 8, hh + dy, 0, TH * (1 - s) / 2 + dy + 4]).fill({ color: 0x1e4a5e, alpha: 0.3 })
    g.ellipse(-6, hh + dy - 1, 6, 2.2).fill({ color: 0xcdeef7, alpha: 0.55 })
  } else {
    // side skirt (SW + SE faces) with a darker foot for weight
    g.poly([-hw, hh, 0, TH, 0, TH + SKIRT, -hw, hh + SKIRT]).fill(c.sideL)
    g.poly([0, TH, hw, hh, hw, hh + SKIRT, 0, TH + SKIRT]).fill(c.sideR)
    // vertical texture streaks on the faces
    for (let i = 0; i < 3; i++) {
      const fx = -hw + 8 + i * 11 + (variant % 2) * 4
      g.moveTo(fx, hh + (fx + hw) * (hh / hw) * 0 + 6 + i).lineTo(fx, hh + SKIRT - 5)
        .stroke({ width: 1.4, color: 0x000000, alpha: 0.1 })
      const fx2 = 8 + i * 11 + (variant % 2) * 3
      g.moveTo(fx2, TH + 2 - i).lineTo(fx2, TH + SKIRT - 6)
        .stroke({ width: 1.4, color: 0xffffff, alpha: 0.06 })
    }
    g.poly([-hw, hh + SKIRT - 4, 0, TH + SKIRT - 4, 0, TH + SKIRT, -hw, hh + SKIRT]).fill({ color: 0x000000, alpha: 0.18 })
    g.poly([0, TH + SKIRT - 4, hw, hh + SKIRT - 4, hw, hh + SKIRT, 0, TH + SKIRT]).fill({ color: 0x000000, alpha: 0.14 })
    // top diamond
    g.poly([0, 0, hw, hh, 0, TH, -hw, hh]).fill(alt ? c.topAlt : c.top)
    // soft top edge highlight (NW + NE edges)
    g.poly([0, 0, hw, hh, hw - 4, hh, 0, 4]).fill({ color: c.edge, alpha: 0.4 })
    g.poly([0, 0, -hw, hh, -hw + 4, hh, 0, 4]).fill({ color: c.edge, alpha: 0.3 })
  }

  if (ground === "grass") {
    // mottled patches, speckles in two tones, tufts, and blades that
    // overhang the front edges onto the skirt
    g.ellipse((variant - 1.5) * 9, hh + (variant % 2 ? 3 : -2), 13, 6)
      .fill({ color: 0x000000, alpha: 0.07 })
    for (let i = 0; i < 8; i++) {
      const a = ((i + variant) * 2.399) % (Math.PI * 2)
      const r = 5 + ((i + variant) % 4) * 4
      g.circle(Math.cos(a) * r, hh + Math.sin(a) * r * 0.5, i % 2 ? 2.2 : 1.4)
        .fill({ color: i % 3 === 0 ? 0x86b465 : c.edge, alpha: 0.32 })
    }
    const tufts: [number, number][] = alt
      ? [[-hw + 12, hh + 4], [-6, TH - 3], [hw - 16, hh + 6], [hw - 26, hh - 3]]
      : [[-hw + 18, hh + 7], [8, TH - 4], [hw - 10, hh + 3], [-hw + 26, hh - 4]]
    for (const [tx, ty] of tufts) {
      g.poly([tx - 3, ty, tx - 1, ty - 6, tx, ty]).fill(c.edge)
      g.poly([tx - 1, ty, tx + 1, ty - 8, tx + 2, ty]).fill(0x86b465)
      g.poly([tx + 2, ty, tx + 4, ty - 5, tx + 5, ty]).fill(c.edge)
    }
    // overhanging blades spilling over the front edges
    const hang: [number, number][] = [[-hw + 14, hh + 8], [-8, TH + 2], [12, TH - 1], [hw - 18, hh + 9]]
    for (const [bx, by] of hang) {
      g.poly([bx - 2, by, bx, by + 6 + (variant % 2) * 2, bx + 2.4, by]).fill({ color: c.top, alpha: 0.95 })
    }
    if (variant === 3) {
      g.circle(-8, hh - 4, 1.6).fill(0xffd9e8)
      g.circle(10, hh + 5, 1.4).fill(0xffe9a3)
    }
  }
  if (ground === "stone") {
    // beveled slab: highlight rim, surface mottle, cracks and a chipped corner
    g.poly([0, 3, hw - 5, hh, 0, TH - 3, -hw + 5, hh])
      .stroke({ width: 1.6, color: 0xe8dfcc, alpha: 0.6 })
    for (let i = 0; i < 6; i++) {
      const a = ((i + variant * 2) * 2.399) % (Math.PI * 2)
      const r = 4 + ((i + variant) % 3) * 5
      g.ellipse(Math.cos(a) * r, hh + Math.sin(a) * r * 0.45, 2.6, 1.4)
        .fill({ color: i % 2 ? 0xb5a88e : 0xe0d6c2, alpha: 0.35 })
    }
    if (variant === 0 || variant === 2) {
      g.moveTo(-hw + 8, hh + 2).lineTo(-6, hh - 3).lineTo(2, hh + 4)
        .stroke({ width: 1, color: 0x8a7a5e, alpha: 0.4 })
    }
    if (variant === 1 || variant === 3) {
      g.moveTo(4, 8).lineTo(10, hh - 2).lineTo(hw - 12, hh + 1)
        .stroke({ width: 1, color: 0x8a7a5e, alpha: 0.35 })
    }
    if (variant === 2) {
      g.poly([hw - 8, hh - 2, hw - 2, hh, hw - 7, hh + 3]).fill({ color: 0x9a8c70, alpha: 0.6 })
    }
  }
  if (ground === "wood") {
    // plank seam, wavy grain lines, nail heads
    g.moveTo(-hw + 6, hh - 1).lineTo(0, TH - 2).stroke({ width: 1.6, color: 0x503219, alpha: 0.5 })
    g.moveTo(-hw / 2, hh / 2 + 4).quadraticCurveTo(0, hh + (variant % 2 ? 3 : -2), hw / 2 - 8, TH - 4)
      .stroke({ width: 1.1, color: 0x503219, alpha: 0.4 })
    g.moveTo(-hw / 2 + 10, hh / 2 - 2).quadraticCurveTo(6, hh - 4, hw / 2, TH - 12)
      .stroke({ width: 1.1, color: 0x503219, alpha: 0.32 })
    g.circle(-hw + 12, hh + 1, 1.3).fill({ color: 0x3d2712, alpha: 0.7 })
    g.circle(hw - 14, hh - 1, 1.3).fill({ color: 0x3d2712, alpha: 0.7 })
    g.ellipse(6, hh / 2 + 2, 3, 1.4).fill({ color: 0xb28049, alpha: 0.5 })
  }
  const t = app.renderer.generateTexture({ target: g, resolution: 2 })
  g.destroy()
  textureCache.set(key, t)
  return t
}

function glowTexture(app: Application, color: number, radius: number): Texture {
  const key = `glow:${color}:${radius}`
  const hit = textureCache.get(key)
  if (hit) return hit
  const g = new Graphics()
  for (let i = 6; i >= 1; i--) {
    g.circle(0, 0, (radius * i) / 6).fill({ color, alpha: 0.05 + (6 - i) * 0.018 })
  }
  const t = app.renderer.generateTexture({ target: g, resolution: 1 })
  g.destroy()
  textureCache.set(key, t)
  return t
}

// ─── Scene data ──────────────────────────────────────────────────────────────

export interface EngineHabit {
  id: string; name: string; streak: number; completedToday: boolean; missedDays: number
  stageEmoji: string; stage: number; plantKey: string
}

// which sprite represents a plant type at a growth stage
export function plantSpriteKey(plant: string, stage: number): string {
  if (stage === 0) return "plant_wilt"
  if (stage === 1) return "plant_seed"
  if (stage === 2) return plant === "cactus" || plant === "mushroom" ? `bloom_${plant}` : "plant_sprout"
  if (stage === 3) return "plant_leafy"
  return SPRITE_DEFS[`bloom_${plant}`] ? `bloom_${plant}` : "plant_leafy"
}

// on-screen plant height per stage (the mature stage grows once more at 5)
const PLANT_STAGE_SIZE = [22, 16, 24, 32, 40, 47]

export interface EngineData {
  habits: EngineHabit[]
  decorations: string[]           // active earned decoration ids
  level: number
  weatherCode: number | null
  placed: Record<string, Cell>    // user-arranged object positions
}

export interface EngineCallbacks {
  onPlantClick: (habitId: string) => void
  onPlaced: (placed: Record<string, Cell>) => void
}

// Default object positions (cells); overridden by data.placed
const DEFAULT_HABIT_CELLS: Cell[] = [
  { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }, { x: 7, y: 3 },
  { x: 7, y: 4 }, { x: 2, y: 3 }, { x: 2, y: 4 }, { x: 4, y: 7 }, { x: 6, y: 7 },
]
const DEFAULT_DECO_CELLS: Record<string, Cell> = {
  gnome: { x: 5, y: 7 }, bird: { x: 2, y: 6 }, stone: { x: 8, y: 7 }, mushroom: { x: 1, y: 4 },
  ladybug: { x: 7, y: 8 }, snail: { x: 3, y: 8 }, frog: { x: 0, y: 6 }, fox: { x: 8, y: 8 },
  hedgehog: { x: 1, y: 8 },
}
// sky decorations are ambient, not grid-placed
const SKY_DECOS = new Set(["butterfly", "bee", "rainbow"])

const STRUCTURES: { key: string; cell: Cell; minLevel: number; dy?: number }[] = [
  { key: "tree_oak",  cell: { x: 0, y: 0 }, minLevel: 4 },
  { key: "tree_pine", cell: { x: 9, y: 0 }, minLevel: 4 },
  { key: "house",     cell: { x: 4, y: 0 }, minLevel: 8 },
  { key: "shelf",     cell: { x: 1, y: 1 }, minLevel: 2 },
  { key: "teapot",    cell: { x: 8, y: 3 }, minLevel: 5, dy: -6 },
  { key: "basket",    cell: { x: 9, y: 5 }, minLevel: 5, dy: -6 },
  { key: "candle",    cell: { x: 9, y: 3 }, minLevel: 5, dy: -6 },
  { key: "potted",    cell: { x: 8, y: 5 }, minLevel: 5, dy: -6 },
]

// weather → mood
function weatherKind(code: number | null): "sunny"|"cloudy"|"foggy"|"rainy"|"snowy"|"stormy" {
  if (code == null || code <= 1) return "sunny"
  if (code <= 3) return "cloudy"
  if (code <= 48) return "foggy"
  if (code <= 67) return "rainy"
  if (code <= 77) return "snowy"
  return "stormy"
}

const GROUND_TINT: Record<string, number> = {
  sunny: 0xffffff, cloudy: 0xd8dce6, foggy: 0xccd4dd, rainy: 0xaebbd0, snowy: 0xe8eef8, stormy: 0x8d99b0,
}

// ─── Engine ───────────────────────────────────────────────────────────────────

interface PlacedSprite {
  id: string                      // "habit:<id>" | "deco:<id>"
  cell: Cell
  root: Container                 // positioned at cell anchor
  sway?: Sprite                   // inner sprite to sway
  phase: number
  draggable: boolean
}

export class GardenEngine {
  private app!: Application
  private world!: Container
  private groundLayer!: Container
  private shadowLayer!: Container
  private objectLayer!: Container
  private airLayer!: Container    // butterflies, birds, petals (world space)
  private fxLayer!: Container     // screen-space particles (rain/snow/sparkles)
  private nightOverlay!: Sprite
  private highlight!: Graphics
  private cb: EngineCallbacks
  private data: EngineData | null = null
  private placedSprites: PlacedSprite[] = []
  private occupied = new Set<string>()
  private ground: Ground[][] = buildGroundMap(1)
  private editMode = false
  private dragging: PlacedSprite | null = null
  private dragOffset = { x: 0, y: 0 }
  private t = 0
  private host: HTMLElement
  private destroyed = false
  private ambient: { sprite: Sprite; kind: string; seed: number; data?: Record<string, number> }[] = []
  private rainDrops: Graphics[] = []
  private lightningAt = 0
  // parallax: pointer (desktop) or gyroscope tilt (mobile) shifts the island
  // against the fixed sky — motion parallax is what sells the depth
  private basePos = { x: 0, y: 0 }
  private par = { tx: 0, ty: 0, cx: 0, cy: 0 }
  private onOrient: ((e: DeviceOrientationEvent) => void) | null = null

  private constructor(host: HTMLElement, cb: EngineCallbacks) {
    this.host = host
    this.cb = cb
  }

  static async create(host: HTMLElement, cb: EngineCallbacks): Promise<GardenEngine> {
    const e = new GardenEngine(host, cb)
    e.app = new Application()
    await e.app.init({
      backgroundAlpha: 0,
      antialias: true,
      resizeTo: host,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    })
    if (e.destroyed) { e.app.destroy(true); return e }  // unmounted mid-init
    host.appendChild(e.app.canvas)
    e.app.canvas.style.position = "absolute"
    e.app.canvas.style.inset = "0"

    e.world = new Container()
    e.groundLayer = new Container()
    e.shadowLayer = new Container()
    e.objectLayer = new Container()
    e.objectLayer.sortableChildren = true
    e.airLayer = new Container()
    e.world.addChild(e.groundLayer, e.shadowLayer, e.objectLayer, e.airLayer)
    e.app.stage.addChild(e.world)

    e.fxLayer = new Container()
    e.app.stage.addChild(e.fxLayer)

    e.nightOverlay = new Sprite(Texture.WHITE)
    e.nightOverlay.tint = 0x1c2050
    e.nightOverlay.alpha = 0
    e.nightOverlay.eventMode = "none"
    e.app.stage.addChild(e.nightOverlay)

    e.highlight = new Graphics()
    e.highlight.visible = false
    e.world.addChild(e.highlight)

    e.app.stage.eventMode = "static"
    e.app.stage.hitArea = { contains: () => true }
    e.app.stage.on("pointermove", ev => e.onPointerMove(ev))
    e.app.stage.on("pointerup", () => e.onPointerUp())
    e.app.stage.on("pointerupoutside", () => e.onPointerUp())

    e.app.ticker.add(tk => e.tick(tk))
    e.layoutWorld()

    // gyroscope parallax on devices that expose orientation without a
    // permission prompt (Android WebView / Chrome)
    e.onOrient = (ev: DeviceOrientationEvent) => {
      if (ev.gamma == null || ev.beta == null) return
      e.par.tx = Math.max(-1, Math.min(1, ev.gamma / 22))
      e.par.ty = Math.max(-1, Math.min(1, (ev.beta - 42) / 22))
    }
    try { window.addEventListener("deviceorientation", e.onOrient) } catch {}
    return e
  }

  destroy() {
    this.destroyed = true
    if (this.onOrient) { try { window.removeEventListener("deviceorientation", this.onOrient) } catch {} }
    try { this.app?.destroy(true, { children: true }) } catch {}
  }

  // fit + center the iso grid inside the host.
  // app.screen is in CSS pixels regardless of devicePixelRatio — using renderer
  // dimensions here shrank and offset the garden on high-DPR phones.
  private layoutWorld() {
    const w = this.app.screen.width
    const h = this.app.screen.height
    const gridW = (COLS + ROWS) / 2 * TW
    const gridH = (COLS + ROWS) / 2 * TH + SKIRT + 90
    const scale = Math.min(w / (gridW + 60), h / (gridH + 60))
    this.world.scale.set(scale)
    // world origin is the grid's top corner; shift so the island's center of
    // mass sits mid-canvas (parallax offsets are applied on top in tick())
    this.basePos = { x: w / 2, y: h * 0.47 - ((COLS + ROWS) / 4) * TH * scale }
    this.world.position.set(this.basePos.x, this.basePos.y)
    this.nightOverlay.width = w
    this.nightOverlay.height = h
  }

  resize() { this.layoutWorld() }

  // Halt the render loop while the garden isn't on screen.
  setPaused(paused: boolean) {
    if (paused) this.app.ticker.stop()
    else this.app.ticker.start()
  }

  setEditMode(on: boolean) {
    this.editMode = on
    this.highlight.visible = false
    for (const p of this.placedSprites) {
      p.root.cursor = on && p.draggable ? "grab" : "pointer"
    }
  }

  // ── scene build ──────────────────────────────────────────────────────────

  update(data: EngineData) {
    this.data = data
    this.ground = buildGroundMap(data.level)
    this.buildGround()
    this.buildObjects()
    this.buildAmbient()
  }

  private buildGround() {
    this.groundLayer.removeChildren().forEach(c => c.destroy())
    const kind = weatherKind(this.data?.weatherCode ?? null)
    const tint = GROUND_TINT[kind]

    // thick soil slab under the whole island + soft ground shadow, so the
    // garden reads as a fat floating diorama chunk
    const rightV: [number, number] = [((COLS - 1) * TW) / 2 + TW / 2, ((COLS - 1) * TH) / 2]
    const bottomV: [number, number] = [0, (COLS + ROWS - 2) * (TH / 2) + TH / 2]
    const leftV: [number, number] = [-(((ROWS - 1) * TW) / 2 + TW / 2), ((ROWS - 1) * TH) / 2]
    const slab = new Graphics()
    for (let i = 3; i >= 1; i--) {
      slab.ellipse(0, bottomV[1] / 2 + 74 + i * 6, 330 + i * 26, 84 + i * 10)
        .fill({ color: 0x000000, alpha: 0.07 })
    }
    const D1 = SKIRT + 16, D2 = SKIRT + 30
    slab.poly([leftV[0], leftV[1] + D2, leftV[0], leftV[1] + SKIRT - 2,
      bottomV[0], bottomV[1] + SKIRT - 2, bottomV[0], bottomV[1] + D2]).fill(0x33231a)
    slab.poly([bottomV[0], bottomV[1] + D2, bottomV[0], bottomV[1] + SKIRT - 2,
      rightV[0], rightV[1] + SKIRT - 2, rightV[0], rightV[1] + D2]).fill(0x3d2a1e)
    slab.poly([leftV[0], leftV[1] + D1, bottomV[0], bottomV[1] + D1,
      bottomV[0], bottomV[1] + D2, leftV[0], leftV[1] + D2]).fill(0x241811)
    slab.poly([bottomV[0], bottomV[1] + D1, rightV[0], rightV[1] + D1,
      rightV[0], rightV[1] + D2, bottomV[0], bottomV[1] + D2]).fill(0x2b1d14)
    // soil strata lines + embedded pebbles on the slab faces
    const faces: [[number, number], [number, number]][] = [[leftV, bottomV], [bottomV, rightV]]
    for (const [A, B] of faces) {
      for (const d of [SKIRT + 5, SKIRT + 12]) {
        slab.moveTo(A[0], A[1] + d).lineTo(B[0], B[1] + d)
          .stroke({ width: 1.5, color: 0x000000, alpha: 0.14 })
      }
      for (let i = 1; i < 5; i++) {
        const px = A[0] + (B[0] - A[0]) * (i / 5)
        const py = A[1] + (B[1] - A[1]) * (i / 5)
        slab.ellipse(px, py + SKIRT + 8 + (i % 2) * 7, 3.4, 2).fill({ color: 0x54402c, alpha: 0.8 })
      }
    }
    this.groundLayer.addChild(slab)
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const g = this.ground[y][x]
      const tex = tileTexture(this.app, g, (x * 13 + y * 7) % 4)
      const s = new Sprite(tex)
      const { wx, wy } = cellToWorld({ x, y })
      s.anchor.set(0.5, 0)
      s.position.set(wx, wy - TH / 2 - this.elev({ x, y }))
      s.tint = tint
      this.groundLayer.addChild(s)
    }
    // warm pool of light around the pedestal
    const glow = new Sprite(glowTexture(this.app, 0xffb054, 150))
    const pc = cellToWorld({ x: 4, y: 4 })
    glow.anchor.set(0.5)
    glow.position.set((pc.wx + cellToWorld({ x: 5, y: 5 }).wx) / 2, (pc.wy + cellToWorld({ x: 5, y: 5 }).wy) / 2 + TH / 2)
    glow.scale.y = 0.55
    this.groundLayer.addChild(glow)
  }

  // deterministic terrain elevation for grass tiles — a raised back plateau
  // (terraced hill with exposed retaining walls) plus small stepped jitter;
  // hard surfaces (plaza/deck/water) stay flat
  private elev(c: Cell): number {
    if (!inGrid(c) || this.ground[c.y][c.x] !== "grass") return 0
    const plateau = c.x + c.y <= 5 ? 10 : 0
    return plateau + ((c.x * 7 + c.y * 13) % 3) * 3
  }

  // fake camera perspective: things nearer the viewer render slightly larger
  private persp(wy: number): number {
    const gridH = ((COLS + ROWS) / 2) * TH
    return 0.93 + (Math.max(0, Math.min(wy + gridH * 0.1, gridH)) / gridH) * 0.13
  }

  private resolveCell(id: string, fallback: Cell): Cell {
    const p = this.data?.placed?.[id]
    if (p && inGrid(p) && this.ground[p.y]?.[p.x] !== "water") return p
    return fallback
  }

  private buildObjects() {
    this.objectLayer.removeChildren().forEach(c => c.destroy())
    this.shadowLayer.removeChildren().forEach(c => c.destroy())
    this.placedSprites = []
    this.occupied.clear()
    if (!this.data) return
    const upgrade = () => { /* texture swapped in-place by reference */ }

    // pedestal + glowing bloom (center of plaza, fixed)
    const center = cellToWorld({ x: 4, y: 4 })
    const cx = (center.wx + cellToWorld({ x: 5, y: 5 }).wx) / 2
    const cy = (center.wy + cellToWorld({ x: 5, y: 5 }).wy) / 2 + TH / 2
    // chunky raised pedestal block: brick body, beveled stone cap, gold dish
    const ped = new Graphics()
    ped.poly([-26, -18, 0, -5, 0, 22, -26, 9]).fill(0x8a4f36)
    ped.poly([0, -5, 26, -18, 26, 9, 0, 22]).fill(0x7a422c)
    ped.moveTo(-26, -4).lineTo(0, 9).moveTo(0, 9).lineTo(26, -4)
      .stroke({ width: 1.4, color: 0x5e3423, alpha: 0.6 })
    ped.poly([0, -44, 26, -31, 0, -18, -26, -31]).fill(0xa86a4a)
    ped.poly([0, -18, 26, -31, 26, -18, 0, -5]).fill(0x95573a)
    ped.poly([0, -31, -26, -18, -26, -31, 0, -44]).fill(0x8a4f36)
    ped.poly([0, -44, 26, -31, 0, -18, -26, -31])
      .stroke({ width: 1.6, color: 0xc9855e, alpha: 0.5 })
    ped.poly([0, -50, 16, -42, 0, -34, -16, -42]).fill(0xd8ccb5)
    ped.poly([0, -34, 16, -42, 16, -38, 0, -30]).fill(0xa89877)
    ped.poly([0, -42, -16, -34, -16, -38, 0, -46]).fill(0xbcae94)
    ped.ellipse(0, -44, 10, 4.2).fill(0xe8c979)
    ped.position.set(cx, cy)
    ped.zIndex = 8 + 8
    this.objectLayer.addChild(ped)
    const bloom: Sprite = new Sprite(spriteTextureSync("bloom", t => paintSprite(bloom, "bloom")(t)))
    bloom.anchor.set(0.5, 1)
    bloom.position.set(cx, cy - 38)
    bloom.zIndex = 8 + 8.1
    this.objectLayer.addChild(bloom)
    const bloomGlow = new Sprite(glowTexture(this.app, 0xffd060, 60))
    bloomGlow.anchor.set(0.5)
    bloomGlow.position.set(cx, cy - 60)
    bloomGlow.zIndex = 8 + 8.05
    this.objectLayer.addChild(bloomGlow)
    this.ambient.push({ sprite: bloomGlow, kind: "pulse", seed: 1 })

    // standing lantern on the plaza (fixed)
    const lc = cellToWorld({ x: 6, y: 6 })
    this.addFixedSprite("lantern", { x: 6, y: 6 }, lc.wx + 14, lc.wy + TH / 2 - 4, upgrade, true)

    // structures by level
    for (const st of STRUCTURES) {
      if ((this.data.level ?? 1) < st.minLevel) continue
      const { wx, wy } = cellToWorld(st.cell)
      this.addFixedSprite(st.key, st.cell, wx, wy + TH / 2 + (st.dy ?? 0), upgrade, false)
    }
    // lilies on ponds at level 5
    if (this.data.level >= 5) {
      const l1 = cellToWorld({ x: 1, y: 7 })
      this.addFixedSprite("lily", { x: 1, y: 7 }, l1.wx, l1.wy + TH / 2 - 2, upgrade, false)
      if (this.data.level >= 5 && this.ground[8][4] === "water") {
        const l2 = cellToWorld({ x: 4, y: 8 })
        this.addFixedSprite("lily", { x: 4, y: 8 }, l2.wx, l2.wy + TH / 2 - 2, upgrade, false)
      }
    }

    // habit plants in pots (draggable)
    this.data.habits.slice(0, DEFAULT_HABIT_CELLS.length).forEach((h, i) => {
      const id = `habit:${h.id}`
      const cell = this.resolveCell(id, DEFAULT_HABIT_CELLS[i])
      this.spawnPot(id, cell, h)
    })

    // earned ground decorations (draggable)
    for (const d of this.data.decorations) {
      if (SKY_DECOS.has(d)) continue
      const id = `deco:${d}`
      const cell = this.resolveCell(id, DEFAULT_DECO_CELLS[d] ?? { x: 5, y: 8 })
      this.spawnDeco(id, d, cell)
    }
  }

  private addFixedSprite(key: string, cell: Cell, wx: number, wy: number, onUp: () => void, glow: boolean) {
    const s: Sprite = new Sprite(spriteTextureSync(key, t => { paintSprite(s, key)(t); onUp() }))
    s.anchor.set(0.5, 1)
    const holder = new Container()
    holder.position.set(wx, wy - this.elev(cell))
    holder.scale.set(this.persp(wy))
    holder.zIndex = cell.x + cell.y
    holder.addChild(s)
    this.objectLayer.addChild(holder)
    this.occupied.add(cellKey(cell))
    if (glow) {
      const g = new Sprite(glowTexture(this.app, 0xffa050, 44))
      g.anchor.set(0.5)
      g.position.set(wx, wy - 20)
      g.zIndex = cell.x + cell.y - 0.1
      this.objectLayer.addChild(g)
      this.ambient.push({ sprite: g, kind: "flicker", seed: wx })
    }
  }

  private spawnShadow(root: Container, w: number) {
    const sh = new Graphics()
    sh.ellipse(0, 0, w, w * 0.4).fill({ color: 0x142010, alpha: 0.34 })
    sh.position.set(root.x, root.y + 1)
    this.shadowLayer.addChild(sh)
    return sh
  }

  private spawnPot(id: string, cell: Cell, h: EngineHabit) {
    const { wx, wy } = cellToWorld(cell)
    const root = new Container()
    root.position.set(wx, wy + TH / 2 - 2 - this.elev(cell))
    root.scale.set(this.persp(wy))
    root.zIndex = cell.x + cell.y

    // terracotta pot drawn from the same 3/4 camera as the ground:
    // tapered body with side shading, elliptical rim, visible soil inside
    const pot = new Graphics()
    pot.poly([-12, -16, 12, -16, 9, -1, -9, -1]).fill(0xc06a3d)
    pot.poly([-12, -16, -4, -16, -6, -1, -9, -1]).fill({ color: 0x8a4527, alpha: 0.4 })
    pot.poly([6, -16, 12, -16, 9, -1, 5, -1]).fill({ color: 0xe89060, alpha: 0.45 })
    pot.ellipse(0, -1, 9, 2.6).fill(0x8a4527)
    pot.ellipse(0, -16, 14, 4.4).fill(0xd98352)
    pot.ellipse(0, -16, 10.4, 3).fill(0x4a3421)
    pot.ellipse(0, -16.7, 10.4, 2.3).fill({ color: 0x5c4128, alpha: 0.85 })
    root.addChild(pot)

    // plant (sways) — dimensional sprite art per type + stage, sized by stage
    const key = plantSpriteKey(h.plantKey, h.stage)
    const target = PLANT_STAGE_SIZE[h.stage] ?? 32
    const plant: Sprite = new Sprite(spriteTextureSync(key, t => {
      if (plant.destroyed) return
      plant.texture = t
      if (t.height > 0) plant.scale.set(target / t.height)
    }))
    plant.anchor.set(0.5, 1)
    plant.position.set(0, -16)
    if (plant.texture.height > 0) plant.scale.set(target / plant.texture.height)
    root.addChild(plant)

    if (h.stage === 5) {
      const g = new Sprite(glowTexture(this.app, 0xffe060, 40))
      g.anchor.set(0.5)
      g.position.set(0, -34)
      root.addChildAt(g, 0)
      this.ambient.push({ sprite: g, kind: "pulse", seed: wx })
    }

    // streak chip
    if (h.streak > 0) {
      const label = new Text({ text: `${h.streak}d`, style: { fontSize: 11, fill: 0xffd08e, fontWeight: "700", fontFamily: "system-ui, sans-serif" } })
      label.anchor.set(0.5)
      const chipW = label.width + 12
      const chip = new Graphics()
      chip.roundRect(-chipW / 2, -9, chipW, 18, 9).fill({ color: 0x18140e, alpha: 0.8 })
        .stroke({ width: 1, color: 0xffb450, alpha: 0.55 })
      const chipC = new Container()
      chipC.addChild(chip, label)
      chipC.position.set(0, -26 - plant.height)
      chipC.scale.set(0.85)
      root.addChild(chipC)
    }

    // name label
    const name = new Text({ text: h.name.length > 10 ? h.name.slice(0, 9) + "…" : h.name,
      style: { fontSize: 11, fill: 0xfff6e0, fontWeight: "600", fontFamily: "system-ui, sans-serif",
        dropShadow: { distance: 1, blur: 2, alpha: 0.9, color: 0x000000 } } })
    name.anchor.set(0.5, 0)
    name.position.set(0, 4)
    name.scale.set(0.9)
    root.addChild(name)

    root.eventMode = "static"
    root.cursor = "pointer"
    const ps: PlacedSprite = { id, cell, root, sway: plant, phase: wx * 0.13, draggable: true }
    root.on("pointerdown", ev => this.onObjectDown(ev, ps, () => this.cb.onPlantClick(h.id)))
    this.objectLayer.addChild(root)
    this.shadowLayer.addChild(this.spawnShadow(root, 13))
    this.placedSprites.push(ps)
    this.occupied.add(cellKey(cell))
  }

  private spawnDeco(id: string, key: string, cell: Cell) {
    const { wx, wy } = cellToWorld(cell)
    const root = new Container()
    root.position.set(wx, wy + TH / 2 - 2 - this.elev(cell))
    root.scale.set(this.persp(wy))
    root.zIndex = cell.x + cell.y
    const s: Sprite = new Sprite(spriteTextureSync(key, t => paintSprite(s, key)(t)))
    s.anchor.set(0.5, 1)
    root.addChild(s)
    root.eventMode = "static"
    root.cursor = "pointer"
    const ps: PlacedSprite = { id, cell, root, phase: wx * 0.17, draggable: true }
    root.on("pointerdown", ev => this.onObjectDown(ev, ps, () => {}))
    this.objectLayer.addChild(root)
    this.shadowLayer.addChild(this.spawnShadow(root, 10))
    this.placedSprites.push(ps)
    this.occupied.add(cellKey(cell))
  }

  // ── ambient life ──────────────────────────────────────────────────────────

  private buildAmbient() {
    this.airLayer.removeChildren().forEach(c => c.destroy())
    this.fxLayer.removeChildren().forEach(c => c.destroy())
    this.ambient = this.ambient.filter(a => a.kind === "pulse" || a.kind === "flicker")
    this.rainDrops = []
    if (!this.data) return
    const kind = weatherKind(this.data.weatherCode)

    // butterflies / bee decorations wander in the air
    if (this.data.decorations.includes("butterfly")) this.spawnAir("butterfly", "flutter", 2)
    if (this.data.decorations.includes("bee")) this.spawnAir("bee", "orbit", 1)
    if (this.data.decorations.includes("rainbow")) {
      const r: Sprite = new Sprite(spriteTextureSync("rainbow", t => paintSprite(r, "rainbow")(t)))
      r.anchor.set(0.5, 1)
      const { wx, wy } = cellToWorld({ x: 5, y: 0 })
      r.position.set(wx, wy - 60)
      r.alpha = 0.85
      this.airLayer.addChild(r)
    }

    // fireflies (always at dusk; none in snow)
    if (kind !== "snowy") {
      for (let i = 0; i < 9; i++) {
        const f = new Graphics()
        f.circle(0, 0, 2.6).fill(0xffe9a3)
        const tex = this.app.renderer.generateTexture({ target: f })
        f.destroy()
        const s = new Sprite(tex)
        s.anchor.set(0.5)
        const cell = { x: (i * 3) % COLS, y: (i * 7 + 2) % ROWS }
        const { wx, wy } = cellToWorld(cell)
        s.position.set(wx, wy - 20 - (i % 3) * 14)
        this.airLayer.addChild(s)
        this.ambient.push({ sprite: s, kind: "firefly", seed: i * 1.7, data: { bx: wx, by: wy - 26 } })
      }
    }

    // drifting cloud shadows, masked to the island so they never darken the sky
    if (kind === "sunny" || kind === "cloudy") {
      const cloudLayer = new Container()
      const mask = new Graphics()
      const top = cellToWorld({ x: 0, y: 0 }), right = cellToWorld({ x: COLS - 1, y: 0 })
      const bottom = cellToWorld({ x: COLS - 1, y: ROWS - 1 }), left = cellToWorld({ x: 0, y: ROWS - 1 })
      mask.poly([top.wx, top.wy - TH / 2, right.wx + TW / 2, right.wy,
        bottom.wx, bottom.wy + TH / 2, left.wx - TW / 2, left.wy]).fill(0xffffff)
      cloudLayer.addChild(mask)
      cloudLayer.mask = mask
      for (let i = 0; i < 3; i++) {
        const g = new Graphics()
        g.ellipse(0, 0, 90 + i * 30, 34 + i * 8).fill({ color: 0x10241c, alpha: kind === "cloudy" ? 0.10 : 0.06 })
        const tex = this.app.renderer.generateTexture({ target: g })
        g.destroy()
        const s = new Sprite(tex)
        s.anchor.set(0.5)
        s.position.set(-300 + i * 260, (i - 1) * 110 + 160)
        cloudLayer.addChild(s)
        this.ambient.push({ sprite: s, kind: "cloud", seed: i * 200 })
      }
      this.shadowLayer.addChild(cloudLayer)
    }

    // rain / snow particles (screen space)
    if (kind === "rainy" || kind === "stormy") {
      for (let i = 0; i < 70; i++) {
        const d = new Graphics()
        d.rect(0, 0, 1.4, 12 + (i % 4) * 4).fill({ color: 0xbcd8f0, alpha: 0.5 })
        d.position.set(Math.random() * 2000, Math.random() * 1200)
        this.fxLayer.addChild(d)
        this.rainDrops.push(d)
      }
    }
    if (kind === "snowy") {
      for (let i = 0; i < 40; i++) {
        const d = new Graphics()
        d.circle(0, 0, 2 + (i % 3)).fill({ color: 0xffffff, alpha: 0.8 })
        d.position.set(Math.random() * 2000, Math.random() * 1200)
        this.fxLayer.addChild(d)
        this.rainDrops.push(d)
      }
    }
  }

  private spawnAir(key: string, kind: string, count: number) {
    for (let i = 0; i < count; i++) {
      const s: Sprite = new Sprite(spriteTextureSync(key, t => paintSprite(s, key)(t)))
      s.anchor.set(0.5)
      const { wx, wy } = cellToWorld({ x: 2 + i * 4, y: 2 })
      s.position.set(wx, wy - 60)
      this.airLayer.addChild(s)
      this.ambient.push({ sprite: s, kind, seed: i * 2.3 + key.length, data: { bx: wx, by: wy - 60 } })
    }
  }

  sparkle() {
    for (let i = 0; i < 10; i++) {
      const s = new Sprite(emojiTexture(i % 2 ? "✨" : "💧", 20))
      s.anchor.set(0.5)
      const { wx, wy } = cellToWorld({ x: 3 + (i % 4), y: 3 + Math.floor(i / 4) })
      s.position.set(wx, wy - 10)
      s.alpha = 0
      this.airLayer.addChild(s)
      this.ambient.push({ sprite: s, kind: "sparkleUp", seed: this.t + i * 0.12, data: { born: this.t } })
    }
  }

  // ── interaction ──────────────────────────────────────────────────────────

  private onObjectDown(ev: FederatedPointerEvent, ps: PlacedSprite, onTap: () => void) {
    if (!this.editMode) { onTap(); return }
    if (!ps.draggable) return
    this.dragging = ps
    const local = this.world.toLocal(ev.global)
    this.dragOffset = { x: ps.root.x - local.x, y: ps.root.y - local.y }
    ps.root.alpha = 0.8
    ps.root.zIndex = 999
    this.highlight.visible = true
  }

  private onPointerMove(ev: FederatedPointerEvent) {
    if (!this.dragging) {
      // pointer parallax (desktop hover / touch drag over the sky)
      const w = this.app.screen.width, h = this.app.screen.height
      this.par.tx = Math.max(-1, Math.min(1, (ev.global.x - w / 2) / (w / 2)))
      this.par.ty = Math.max(-1, Math.min(1, (ev.global.y - h / 2) / (h / 2)))
      return
    }
    const local = this.world.toLocal(ev.global)
    this.dragging.root.position.set(local.x + this.dragOffset.x, local.y + this.dragOffset.y)
    const cell = worldToCell(local.x + this.dragOffset.x, local.y + this.dragOffset.y - TH / 2 + 2)
    this.drawHighlight(cell, this.canPlace(cell))
  }

  private onPointerUp() {
    const ps = this.dragging
    if (!ps) return
    this.dragging = null
    this.highlight.visible = false
    ps.root.alpha = 1
    const cell = worldToCell(ps.root.x, ps.root.y - TH / 2 + 2)
    if (this.canPlace(cell)) {
      this.occupied.delete(cellKey(ps.cell))
      ps.cell = cell
      this.occupied.add(cellKey(cell))
      const placed: Record<string, Cell> = {}
      for (const p of this.placedSprites) placed[p.id] = p.cell
      this.cb.onPlaced(placed)
    }
    const { wx, wy } = cellToWorld(ps.cell)
    ps.root.position.set(wx, wy + TH / 2 - 2 - this.elev(ps.cell))
    ps.root.scale.set(this.persp(wy))
    ps.root.zIndex = ps.cell.x + ps.cell.y
  }

  private canPlace(cell: Cell): boolean {
    if (!inGrid(cell)) return false
    if (this.ground[cell.y][cell.x] === "water") return false
    if (this.dragging && cellKey(cell) === cellKey(this.dragging.cell)) return true
    return !this.occupied.has(cellKey(cell))
  }

  private drawHighlight(cell: Cell, ok: boolean) {
    this.highlight.clear()
    if (!inGrid(cell)) return
    const { wx, wy } = cellToWorld(cell)
    const hw = TW / 2, hh = TH / 2
    this.highlight
      .poly([wx, wy - hh, wx + hw, wy, wx, wy + hh, wx - hw, wy])
      .fill({ color: ok ? 0x8fd05e : 0xd05e5e, alpha: 0.35 })
      .stroke({ width: 2, color: ok ? 0xb8e88e : 0xe89898, alpha: 0.9 })
  }

  // ── animation loop ────────────────────────────────────────────────────────

  private tick(tk: Ticker) {
    this.t += tk.deltaMS / 1000
    const t = this.t
    const kind = weatherKind(this.data?.weatherCode ?? null)

    // sway plants
    for (const p of this.placedSprites) {
      if (p.sway) p.sway.rotation = Math.sin(t * 1.3 + p.phase) * 0.045
    }

    // ambient behaviours
    for (let i = this.ambient.length - 1; i >= 0; i--) {
      const a = this.ambient[i]
      const s = a.sprite
      if (s.destroyed) { this.ambient.splice(i, 1); continue }
      switch (a.kind) {
        case "pulse":
          s.alpha = 0.75 + Math.sin(t * 2 + a.seed) * 0.25
          break
        case "flicker":
          s.alpha = 0.7 + Math.sin(t * 7 + a.seed) * 0.12 + Math.sin(t * 13.7 + a.seed) * 0.08
          break
        case "firefly": {
          const bx = a.data!.bx, by = a.data!.by
          s.position.set(bx + Math.sin(t * 0.6 + a.seed * 3) * 26, by + Math.cos(t * 0.44 + a.seed * 2) * 14)
          const night = isNight()
          s.alpha = Math.max(0, Math.sin(t * 1.4 + a.seed * 5)) * (night ? 0.95 : 0.55)
          break
        }
        case "flutter": {
          const bx = a.data!.bx, by = a.data!.by
          s.position.set(bx + Math.sin(t * 0.5 + a.seed) * 150, by + Math.sin(t * 1.1 + a.seed * 2) * 30 - 10)
          // preserve painted-texture scale magnitude when flipping
          const m = Math.abs(s.scale.y) || 1
          s.scale.x = Math.cos(t * 6 + a.seed) > 0 ? m : -m
          break
        }
        case "orbit": {
          const bx = a.data!.bx, by = a.data!.by
          s.position.set(bx + Math.cos(t * 0.9 + a.seed) * 60, by + Math.sin(t * 1.8 + a.seed) * 18)
          break
        }
        case "cloud": {
          s.x += tk.deltaMS * 0.008
          if (s.x > 500) s.x = -500
          break
        }
        case "sparkleUp": {
          const age = t - (a.data!.born ?? t)
          s.alpha = age < 0.3 ? age / 0.3 : Math.max(0, 1 - (age - 0.3) / 1.2)
          s.y -= tk.deltaMS * 0.02
          if (age > 1.6) { s.destroy(); this.ambient.splice(i, 1) }
          break
        }
      }
    }

    // rain / snow
    const w = this.app.screen.width
    const h = this.app.screen.height
    for (const d of this.rainDrops) {
      if (kind === "snowy") {
        d.y += tk.deltaMS * 0.045
        d.x += Math.sin(t + d.y * 0.01) * 0.4
      } else {
        d.y += tk.deltaMS * 0.5
      }
      if (d.y > h + 20) { d.y = -20; d.x = Math.random() * w }
    }

    // stormy lightning
    if (kind === "stormy" && t - this.lightningAt > 5 + Math.random() * 3) {
      this.lightningAt = t
    }
    const sinceFlash = t - this.lightningAt
    const flash = kind === "stormy" && sinceFlash < 0.25 ? Math.max(0, 0.5 - sinceFlash * 2.4) : 0

    // parallax — ease toward target, island shifts against the fixed sky,
    // the air layer (butterflies, clouds, fireflies) drifts a touch more
    this.par.cx += (this.par.tx - this.par.cx) * 0.04
    this.par.cy += (this.par.ty - this.par.cy) * 0.04
    this.world.position.set(this.basePos.x - this.par.cx * 14, this.basePos.y - this.par.cy * 9)
    this.airLayer.position.set(-this.par.cx * 9, -this.par.cy * 6)

    // night lighting
    const targetNight = (isNight() ? 0.32 : kind === "stormy" ? 0.25 : kind === "rainy" ? 0.12 : 0)
    this.nightOverlay.alpha += (targetNight - this.nightOverlay.alpha) * 0.02
    if (flash > 0) {
      this.nightOverlay.tint = 0xffffff
      this.nightOverlay.alpha = flash
    } else {
      this.nightOverlay.tint = 0x1c2050
    }
  }
}

function isNight(): boolean {
  const hr = new Date().getHours()
  return hr >= 20 || hr < 6
}
