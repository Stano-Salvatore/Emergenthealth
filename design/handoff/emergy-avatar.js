// <emergy-avatar mood="okay" fit="bust" gesture="">  — the 3D mascot, mounted anywhere in the UI.
// One WebGL renderer is shared by every instance on the page and blitted into
// each element's own 2D canvas, so a nav button, a sidebar mark and a chat
// portrait cost one context between them.

const THREE_URL = 'https://unpkg.com/three@0.184.0/build/three.module.js'


let bootPromise = null
const instances = new Set()

async function boot() {
  const THREE = await import(THREE_URL)
  const { buildEmergy, setMood, poseEmergy, makeStudio, FITS } = await import('./emergy-model.js')

  const off = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas: off, antialias: true, alpha: true })
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const model = buildEmergy(THREE)
  const scene = makeStudio(THREE, model)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40)

  const ctx = { THREE, renderer, off, scene, camera, model, setMood, poseEmergy, FITS, lastFit: null }
  const t0 = performance.now()
  let last = 0
  function tick(now) {
    requestAnimationFrame(tick)
    if (now - last < 33) return          // ~30fps is plenty for a mascot
    last = now
    const t = (now - t0) / 1000
    for (const fit of ['full', 'icon', 'bust']) {
      for (const el of instances) if (el._fit === fit && el._visible) el._draw(ctx, t)
    }
  }
  requestAnimationFrame(tick)
  return ctx
}

class EmergyAvatar extends HTMLElement {
  static observedAttributes = ['mood', 'fit', 'gesture']

  connectedCallback() {
    if (!this._canvas) {
      // fill whatever box the host gives us; square if the host has no height
      this.style.display = 'block'
      if (!this.style.width) this.style.width = '100%'
      if (!this.style.height) this.style.height = '100%'
      this._canvas = document.createElement('canvas')
      this._canvas.style.cssText = 'display:block;width:100%;height:100%'
      this._ctx2d = this._canvas.getContext('2d')
      this.appendChild(this._canvas)
      this._ro = new ResizeObserver(() => this._resize())
      this._ro.observe(this)
      this._io = new IntersectionObserver(es => { this._visible = es.some(e => e.isIntersecting) }, { rootMargin: '120px' })
      this._io.observe(this)
    }
    this._visible = true
    this._resize()
    instances.add(this)
    bootPromise ??= boot()
  }

  disconnectedCallback() { instances.delete(this) }

  attributeChangedCallback() { /* read live in _draw */ }

  get _fit() { const f = this.getAttribute('fit'); return f === 'full' || f === 'icon' || f === 'bust' ? f : 'icon' }

  _resize() {
    const r = this.getBoundingClientRect()
    const cssW = r.width || 40
    const cssH = r.height > cssW * 0.6 ? r.height : cssW    // hosts that don't set a height get a square
    const w = Math.max(8, Math.round(cssW * 2))
    const h = Math.max(8, Math.round(cssH * 2))
    if (r.height < cssW * 0.6) this.style.aspectRatio = '1 / 1'
    if (this._canvas.width !== w) this._canvas.width = w
    if (this._canvas.height !== h) this._canvas.height = h
  }

  /** Play a one-off gesture (default 4.4s for a wave, 6.2s for a sigh). */
  play(gesture, ms) {
    this._forced = gesture
    this._forcedUntil = performance.now() + (ms ?? (gesture === 'sigh' ? 6400 : 4600))
  }

  _draw(ctx, t) {
    const { renderer, camera, off, scene, model, setMood, poseEmergy, FITS } = ctx
    const f = FITS[this._fit]
    if (ctx.lastFit !== this._fit) {
      renderer.setSize(f.w, f.h, false)
      camera.aspect = f.w / f.h
      camera.position.set(...f.cam)
      camera.lookAt(...f.target)
      camera.updateProjectionMatrix()
      ctx.lastFit = this._fit
    }
    const mood = this.getAttribute('mood') || 'okay'
    const forced = this._forcedUntil > performance.now() ? this._forced : (this.getAttribute('gesture') || null)
    setMood(model, mood)
    poseEmergy(model, mood, t, forced)
    renderer.render(scene, camera)
    const c = this._canvas
    this._ctx2d.clearRect(0, 0, c.width, c.height)
    const s = Math.min(c.width / f.w, c.height / f.h)
    const dw = f.w * s, dh = f.h * s
    this._ctx2d.drawImage(off, 0, 0, f.w, f.h, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh)
  }
}

if (!customElements.get('emergy-avatar')) customElements.define('emergy-avatar', EmergyAvatar)

/** Make every mascot on the page wave (or sigh). */
window.emergyPlay = (gesture, ms) => { for (const el of instances) el.play(gesture, ms) }
