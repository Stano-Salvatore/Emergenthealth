"use client"

// The real-3D garden: renders the habitgarden.glb diorama (exported from the
// hand-built three.js scene) and drives it from live habit data. Object names
// in the model are semantic — habit_<n>_plant_stem, bee_0_wing_l, fog_bank_2 —
// so growth stages, decorations and ambient animation are all name-driven.
// Replaces the PixiJS engine as the garden renderer; the CSS atmosphere
// layers (sky, stars, string lights, vignette) are kept identical.

import { useEffect, useRef } from "react"
import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import type { EngineData } from "./engine"

const GLB_URL = "/garden-3d/habitgarden.glb"

// ── weather buckets (same WMO code ranges the 2D engine used) ────────────────
function bucket(code: number | null): "clear" | "cloud" | "fog" | "rain" | "snow" | "storm" {
  if (code == null || code <= 1) return "clear"
  if (code <= 3) return "cloud"
  if (code <= 48) return "fog"
  if (code <= 67 || (code >= 80 && code <= 82)) return "rain"
  if (code <= 77 || code === 85 || code === 86) return "snow"
  return "storm"
}

function skyFor(code: number | null): string {
  if (code == null || code <= 1) return "linear-gradient(180deg,#2c3550 0%,#3c4a6e 40%,#6b5f7d 72%,#c98a63 100%)"
  if (code <= 3)  return "linear-gradient(180deg,#2b3550 0%,#4a5877 55%,#8d8398 100%)"
  if (code <= 48) return "linear-gradient(180deg,#3e4a5e 0%,#66748a 60%,#98a2b1 100%)"
  if (code <= 67) return "linear-gradient(180deg,#1e2738 0%,#35435c 60%,#526078 100%)"
  if (code <= 77) return "linear-gradient(180deg,#5a6c8e 0%,#9fb2cc 60%,#cfd9e8 100%)"
  return "linear-gradient(180deg,#121724 0%,#20283c 60%,#333e52 100%)"
}

// stage → which named plant parts show (cumulative). Parts vary per habit slot
// (some plants are stem+spike, some clump+bud, some stem+leaf+blooms).
type PartKind = "pot" | "early" | "mid" | "bud" | "bloom"
function partKind(rest: string): PartKind {
  if (rest.includes("pot")) return "pot"
  if (rest.includes("bloom")) return "bloom"
  if (rest.includes("bud")) return "bud"
  if (rest.includes("base_leaf") || rest.includes("stem")) return "early"
  return "mid" // spike / leaf / clump
}

const WILT_TINT = new THREE.Color(0x7a5230)

interface HabitSlot {
  parts: Record<PartKind, THREE.Mesh[]>
  habitId: string | null
}

interface Flyer {
  pivot: THREE.Group
  wings: THREE.Object3D[]
  base: THREE.Vector3
  seed: number
  kind: "bee" | "butterfly"
}

class Garden3DEngine {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls!: OrbitControls
  private host: HTMLElement
  private raf = 0
  private clock = new THREE.Clock()
  private model: THREE.Group | null = null
  private slots: HabitSlot[] = []
  private decoGroups: Record<string, THREE.Object3D[]> = {}
  private fogBanks: THREE.Object3D[] = []
  private flyers: Flyer[] = []
  private flames: THREE.Object3D[] = []
  private catTail: THREE.Object3D | null = null
  private hemi: THREE.HemisphereLight
  private sun: THREE.DirectionalLight
  private center = new THREE.Vector3()
  private topY = 0
  private precip: THREE.Points | null = null
  private precipKind: "rain" | "snow" | null = null
  private sparkles: { pts: THREE.Points; born: number }[] = []
  private data: EngineData | null = null
  private wiltOriginal = new Map<THREE.Mesh, THREE.Material>()
  private wiltTinted = new Map<THREE.Mesh, THREE.Material>()
  private lastFlash = 0
  private destroyed = false
  private downAt: { x: number; y: number } | null = null

  onPlantClick: (habitId: string) => void = () => {}

  constructor(host: HTMLElement) {
    this.host = host
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setSize(host.clientWidth || 1, host.clientHeight || 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    host.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300)
    this.hemi = new THREE.HemisphereLight(0x9a8fc0, 0x2e2318, 1.15)
    this.sun = new THREE.DirectionalLight(0xffc98a, 2.2)
    this.sun.position.set(6, 10, 4)
    const fill = new THREE.DirectionalLight(0x8ab0ff, 0.5)
    fill.position.set(-7, 6, -5)
    this.scene.add(this.hemi, this.sun, fill)

    this.renderer.domElement.addEventListener("pointerdown", e => {
      this.downAt = { x: e.clientX, y: e.clientY }
    })
    this.renderer.domElement.addEventListener("pointerup", e => {
      if (!this.downAt) return
      const dx = e.clientX - this.downAt.x, dy = e.clientY - this.downAt.y
      this.downAt = null
      if (dx * dx + dy * dy < 36) this.pick(e)
    })

    new GLTFLoader().load(GLB_URL, gltf => {
      if (this.destroyed) return
      this.setupModel(gltf.scene)
    })

    this.tick = this.tick.bind(this)
    this.raf = requestAnimationFrame(this.tick)
  }

  // ── model wiring ───────────────────────────────────────────────────────────
  private setupModel(root: THREE.Group) {
    this.model = root
    this.scene.add(root)

    // slots for up to 12 habit plants
    this.slots = Array.from({ length: 12 }, () => ({
      parts: { pot: [], early: [], mid: [], bud: [], bloom: [] },
      habitId: null,
    }))

    const flyerMeshes: Record<string, { body: THREE.Mesh[]; wings: THREE.Mesh[] }> = {}
    const catTailMeshes: THREE.Mesh[] = []
    const decoPatterns: [string, RegExp][] = [
      ["gnome", /^gnome_/], ["bird", /^robin_/], ["butterfly", /^butterfly_/], ["bee", /^bee_/],
    ]

    root.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      const name = o.name
      const mat = o.material as THREE.MeshStandardMaterial
      if (mat && !Array.isArray(mat)) {
        mat.metalness = 0
        mat.roughness = 0.82
        if (name.includes("string_bulb") || name.includes("candle_flame") || name.includes("lantern") || name.includes("bloom_core")) {
          mat.emissive = mat.color.clone()
          mat.emissiveIntensity = name.includes("candle_flame") ? 1.6 : 0.9
        }
        if (name.startsWith("water") || name.startsWith("tile_water")) {
          mat.roughness = 0.25
          mat.transparent = true
          mat.opacity = 0.92
        }
        if (name.startsWith("fog_bank")) {
          mat.depthWrite = false
        }
      }

      const hm = name.match(/^habit_(\d+)_(.+)$/)
      if (hm) {
        const idx = parseInt(hm[1], 10)
        if (idx < 12) this.slots[idx].parts[partKind(hm[2])].push(o)
      }
      for (const [id, re] of decoPatterns) {
        if (re.test(name)) (this.decoGroups[id] ??= []).push(o)
      }
      if (name.startsWith("fog_bank")) this.fogBanks.push(o)
      if (name.startsWith("candle_flame")) this.flames.push(o)
      if (name.startsWith("cat_tail")) catTailMeshes.push(o)
      const fm = name.match(/^(bee_\d+|butterfly_[a-z])_(body|wing_l|wing_r|breast|head|tail)/)
      if (fm) {
        const g = (flyerMeshes[fm[1]] ??= { body: [], wings: [] })
        ;(fm[2].startsWith("wing") ? g.wings : g.body).push(o)
      }
    })

    // reparent flyers (verts are world-baked) onto pivots so they can move
    for (const [key, g] of Object.entries(flyerMeshes)) {
      const all = [...g.body, ...g.wings]
      const box = new THREE.Box3()
      all.forEach(m => box.expandByObject(m))
      const c = box.getCenter(new THREE.Vector3())
      const pivot = new THREE.Group()
      pivot.position.copy(c)
      this.model!.add(pivot)
      for (const m of all) {
        m.geometry.translate(-c.x, -c.y, -c.z)
        m.removeFromParent()
        pivot.add(m)
      }
      this.flyers.push({
        pivot, wings: g.wings, base: c.clone(),
        seed: key.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0),
        kind: key.startsWith("bee") ? "bee" : "butterfly",
      })
    }
    if (catTailMeshes.length) {
      const box = new THREE.Box3()
      catTailMeshes.forEach(m => box.expandByObject(m))
      const c = box.getCenter(new THREE.Vector3())
      c.y = box.min.y
      const pivot = new THREE.Group()
      pivot.position.copy(c)
      this.model.add(pivot)
      for (const m of catTailMeshes) {
        m.geometry.translate(-c.x, -c.y, -c.z)
        m.removeFromParent()
        pivot.add(m)
      }
      this.catTail = pivot
    }

    // frame the island
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    box.getCenter(this.center)
    this.topY = box.max.y
    const maxDim = Math.max(size.x, size.y, size.z)
    const dist = (maxDim / 2) / Math.tan((this.camera.fov * Math.PI) / 360) * 1.18
    const dir = new THREE.Vector3(1, 0.72, 1).normalize()
    this.camera.position.copy(this.center).addScaledVector(dir, dist)
    this.camera.lookAt(this.center)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.copy(this.center)
    this.controls.enablePan = false
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = dist * 0.55
    this.controls.maxDistance = dist * 1.7
    this.controls.minPolarAngle = 0.55
    this.controls.maxPolarAngle = 1.38
    this.controls.update()

    this.resize()
    if (this.data) this.apply()
  }

  // ── data → scene state ─────────────────────────────────────────────────────
  update(data: EngineData) {
    this.data = data
    if (this.model) this.apply()
  }

  private setWilt(m: THREE.Mesh, wilted: boolean) {
    if (wilted) {
      if (!this.wiltTinted.has(m)) {
        const orig = m.material as THREE.MeshStandardMaterial
        this.wiltOriginal.set(m, orig)
        const t = orig.clone()
        t.color.lerp(WILT_TINT, 0.6)
        this.wiltTinted.set(m, t)
      }
      m.material = this.wiltTinted.get(m)!
    } else if (this.wiltOriginal.has(m)) {
      m.material = this.wiltOriginal.get(m)!
    }
  }

  private apply() {
    const d = this.data!
    // habit slots: cumulative part visibility per growth stage
    this.slots.forEach((slot, i) => {
      const habit = d.habits[i]
      slot.habitId = habit?.id ?? null
      const stage = habit?.stage ?? -1
      const hasEarly = slot.parts.early.length > 0
      const show: Record<PartKind, boolean> = {
        pot: stage >= 0,
        early: stage >= 2,
        mid: stage >= 3 || (stage === 2 && !hasEarly),
        bud: stage >= 4,
        bloom: stage >= 5,
      }
      const wilted = stage === 0
      ;(Object.keys(show) as PartKind[]).forEach(k => {
        for (const m of slot.parts[k]) {
          m.visible = show[k] || (wilted && (k === "early" || (k === "mid" && !hasEarly)))
          if (k !== "pot") this.setWilt(m, wilted)
        }
      })
    })
    // earned decorations toggle their critters
    for (const [id, meshes] of Object.entries(this.decoGroups)) {
      const on = d.decorations.includes(id)
      meshes.forEach(m => { m.visible = on })
    }
    for (const f of this.flyers) {
      const on = d.decorations.includes(f.kind === "bee" ? "bee" : "butterfly")
      f.pivot.visible = on
    }
    // weather
    const b = bucket(d.weatherCode)
    this.fogBanks.forEach(m => { m.visible = b === "fog" })
    this.setPrecip(b === "rain" || b === "storm" ? "rain" : b === "snow" ? "snow" : null)
    this.sun.intensity = b === "clear" ? 2.2 : b === "cloud" ? 1.6 : b === "storm" ? 0.9 : 1.3
    this.hemi.intensity = b === "storm" ? 0.8 : 1.15
  }

  private setPrecip(kind: "rain" | "snow" | null) {
    if (kind === this.precipKind) return
    if (this.precip) { this.precip.removeFromParent(); this.precip.geometry.dispose(); (this.precip.material as THREE.Material).dispose() }
    this.precip = null
    this.precipKind = kind
    if (!kind || !this.model) return
    const n = kind === "rain" ? 500 : 300
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = this.center.x + (Math.random() - 0.5) * 14
      pos[i * 3 + 1] = this.topY + Math.random() * 8
      pos[i * 3 + 2] = this.center.z + (Math.random() - 0.5) * 14
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      color: kind === "rain" ? 0x9db8d9 : 0xffffff,
      size: kind === "rain" ? 0.06 : 0.1,
      transparent: true, opacity: kind === "rain" ? 0.55 : 0.85, depthWrite: false,
    })
    this.precip = new THREE.Points(geo, mat)
    this.scene.add(this.precip)
  }

  sparkle() {
    if (!this.model) return
    const n = 70
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 3.4
      pos[i * 3] = this.center.x + Math.cos(a) * r
      pos[i * 3 + 1] = this.center.y + Math.random() * 1.4
      pos[i * 3 + 2] = this.center.z + Math.sin(a) * r
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      color: 0xffe9a8, size: 0.16, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const pts = new THREE.Points(geo, mat)
    this.scene.add(pts)
    this.sparkles.push({ pts, born: this.clock.elapsedTime })
  }

  private pick(e: PointerEvent) {
    if (!this.model) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, this.camera)
    const hits = ray.intersectObjects(this.model.children, true)
    for (const h of hits) {
      const m = h.object.name.match(/^habit_(\d+)_/)
      if (m) {
        const slot = this.slots[parseInt(m[1], 10)]
        if (slot?.habitId) { this.onPlantClick(slot.habitId); return }
      }
    }
  }

  // ── frame loop ─────────────────────────────────────────────────────────────
  private tick() {
    if (this.destroyed) return
    this.raf = requestAnimationFrame(this.tick)
    const t = this.clock.getElapsedTime()
    this.controls?.update()

    for (const f of this.flyers) {
      if (!f.pivot.visible) continue
      const s = f.seed
      if (f.kind === "bee") {
        f.pivot.position.set(
          f.base.x + Math.cos(t * 0.9 + s) * 0.6,
          f.base.y + Math.sin(t * 2.1 + s) * 0.22,
          f.base.z + Math.sin(t * 0.9 + s) * 0.6,
        )
        f.pivot.rotation.y = -(t * 0.9 + s) + Math.PI / 2
        for (const w of f.wings) w.rotation.x = Math.sin(t * 40 + s) * 0.5
      } else {
        f.pivot.position.set(
          f.base.x + Math.cos(t * 0.45 + s) * 1.1,
          f.base.y + Math.sin(t * 1.3 + s) * 0.4,
          f.base.z + Math.sin(t * 0.6 + s * 2) * 1.1,
        )
        for (const w of f.wings) w.rotation.z = Math.sin(t * 9 + s) * 0.55
      }
    }
    if (this.catTail) this.catTail.rotation.y = Math.sin(t * 1.4) * 0.22
    for (const fl of this.flames) {
      const k = 1 + Math.sin(t * 11 + fl.position.x) * 0.12
      fl.scale.set(k, 1 / k * (1 + Math.sin(t * 7) * 0.08), k)
    }
    for (const fb of this.fogBanks) {
      if (fb.visible) fb.position.x = Math.sin(t * 0.12 + fb.position.z) * 0.8
    }

    if (this.precip) {
      const pos = this.precip.geometry.attributes.position as THREE.BufferAttribute
      const speed = this.precipKind === "rain" ? 10 : 1.6
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - speed * 0.016
        if (this.precipKind === "snow") pos.setX(i, pos.getX(i) + Math.sin(t + i) * 0.004)
        if (y < this.center.y - 1) y = this.topY + 6
        pos.setY(i, y)
      }
      pos.needsUpdate = true
    }

    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i]
      const age = t - s.born
      if (age > 1.4) {
        s.pts.removeFromParent(); s.pts.geometry.dispose(); (s.pts.material as THREE.Material).dispose()
        this.sparkles.splice(i, 1)
        continue
      }
      s.pts.position.y += 0.014
      ;(s.pts.material as THREE.PointsMaterial).opacity = 1 - age / 1.4
    }

    // storm lightning
    if (this.data && bucket(this.data.weatherCode) === "storm") {
      if (t - this.lastFlash > 4 + (Math.sin(t * 0.7) + 1) * 2) {
        this.lastFlash = t
        this.hemi.intensity = 3.2
        setTimeout(() => { if (!this.destroyed) this.hemi.intensity = 0.8 }, 130)
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  destroy() {
    this.destroyed = true
    cancelAnimationFrame(this.raf)
    this.controls?.dispose()
    this.scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose()
        const m = o.material
        if (Array.isArray(m)) m.forEach(x => x.dispose())
        else m?.dispose()
      }
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

// ── React wrapper (same contract as GardenCanvas) ────────────────────────────

const STARS: [number, number][] = [[6,5],[15,10],[26,4],[38,8],[52,3],[64,7],[76,11],[87,5],[94,10],[21,15],[71,16],[91,18],[45,13],[57,17]]
const BULBS: [number, number][] = [[7,10],[17,14],[29,16],[41,14],[52,9],[64,11],[76,13],[88,12],[97,11]]

export interface Garden3DProps {
  data: EngineData | null
  sparkleSignal: number
  onPlantClick: (habitId: string) => void
}

export function Garden3D({ data, sparkleSignal, onPlantClick }: Garden3DProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Garden3DEngine | null>(null)
  const cbRef = useRef(onPlantClick)
  useEffect(() => { cbRef.current = onPlantClick }, [onPlantClick])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const engine = new Garden3DEngine(host)
    engine.onPlantClick = id => cbRef.current(id)
    engineRef.current = engine
    const ro = new ResizeObserver(() => engine.resize())
    ro.observe(host)
    return () => {
      ro.disconnect()
      engineRef.current = null
      engine.destroy()
    }
  }, [])

  useEffect(() => {
    if (data) engineRef.current?.update(data)
  }, [data])

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
      <div className="absolute inset-0" style={{ background: sky }} />
      {STARS.map(([x, y], i) => (
        <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: i % 3 ? 2 : 3,
          height: i % 3 ? 2 : 3, borderRadius: "50%", background: "#fff", opacity: 0.3 + (i % 4) * 0.15 }} />
      ))}

      {/* WebGL scene (canvas is transparent; sky shows through) */}
      <div ref={hostRef} className="absolute inset-0" style={{ touchAction: "none" }} />

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

      {/* Warm wash + vignette */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 22,
        background: "radial-gradient(ellipse at 50% 50%, rgba(255,170,80,0.08), transparent 60%)" }} />
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 23,
        boxShadow: "inset 0 0 130px rgba(12,9,28,0.62)", borderRadius: "inherit" }} />
    </div>
  )
}
