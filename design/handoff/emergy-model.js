// Emergy, as geometry. One builder shared by the viewer page and the in-app mockups.
// Proportions and colours follow src/components/emergy/EmergySVG.tsx.

export const MOODS = {
  thriving:  { body: 0x4ade80, band: 0x16a34a, highlight: 0xbbf7d0, mouth: 'smile', gesture: 'wave' },
  happy:     { body: 0x86efac, band: 0x22c55e, highlight: 0xdcfce7, mouth: 'smile', gesture: 'wave' },
  okay:      { body: 0xfde68a, band: 0xf59e0b, highlight: 0xfef3c7, mouth: 'smile', gesture: 'bob'  },
  tired:     { body: 0xd1d5db, band: 0x9ca3af, highlight: 0xf3f4f6, mouth: 'flat',  gesture: 'sigh' },
  wilting:   { body: 0xfca5a5, band: 0xef4444, highlight: 0xfee2e2, mouth: 'flat',  gesture: 'sigh' },
  screaming: { body: 0xf87171, band: 0xdc2626, highlight: 0xfecaca, mouth: 'open',  gesture: 'shake' },
}

function roundedSlab(THREE, w, h, d, r, name, mat) {
  const s = new THREE.Shape()
  const x = -w / 2, y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y);     s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h);     s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r);         s.quadraticCurveTo(x, y, x + r, y)
  const bevel = Math.min(0.07, d * 0.16)
  const g = new THREE.ExtrudeGeometry(s, {
    depth: d - bevel * 2, curveSegments: 20, steps: 1,
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: 0, bevelSegments: 8,
  })
  g.center()
  const mesh = new THREE.Mesh(g, mat)
  mesh.name = name
  return mesh
}

export function buildEmergy(THREE) {
  const M = {
    body:  new THREE.MeshStandardMaterial({ name: 'body',       color: 0xfde68a, roughness: 0.27, metalness: 0.05, emissive: 0xfde68a, emissiveIntensity: 0.16 }),
    band:  new THREE.MeshStandardMaterial({ name: 'band',       color: 0xf59e0b, roughness: 0.26, metalness: 0.06, emissive: 0xf59e0b, emissiveIntensity: 0.12 }),
    gleam: new THREE.MeshStandardMaterial({ name: 'gleam',      color: 0xfef3c7, roughness: 0.3 }),
    leaf:  new THREE.MeshStandardMaterial({ name: 'leaf-green', color: 0x2fb45c, roughness: 0.4, emissive: 0x2fb45c, emissiveIntensity: 0.1 }),
    stem:  new THREE.MeshStandardMaterial({ name: 'stem-green', color: 0x1d8a45, roughness: 0.5 }),
    clay:  new THREE.MeshStandardMaterial({ name: 'terracotta', color: 0xbe6d3d, roughness: 0.78 }),
    soil:  new THREE.MeshStandardMaterial({ name: 'soil',       color: 0x9c6836, roughness: 0.8 }),
    white: new THREE.MeshStandardMaterial({ name: 'eye-white',  color: 0xfffdf6, roughness: 0.22 }),
    dark:  new THREE.MeshStandardMaterial({ name: 'eye-dark',   color: 0x1e2530, roughness: 0.25 }),
    rose:  new THREE.MeshStandardMaterial({ name: 'blush-rose', color: 0xfb7185, roughness: 0.6 }),
  }

  const group = new THREE.Group()
  group.name = 'emergy'

  // ── pot (static) ──
  const potGroup = new THREE.Group()
  potGroup.name = 'pot-group'
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.40, 0.58, 56, 1, false), M.clay)
  pot.name = 'pot'; pot.position.y = 0.29
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.535, 0.044, 20, 64), M.clay)
  rim.name = 'pot-rim'; rim.position.y = 0.585; rim.rotation.x = Math.PI / 2
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.528, 0.51, 0.1, 48), M.soil)
  soil.name = 'soil'; soil.position.y = 0.596
  potGroup.add(pot, rim, soil)
  group.add(potGroup)

  // ── him (everything that can move) ──
  const him = new THREE.Group()
  him.name = 'emergy-body'
  group.add(him)

  const BODY_W = 0.68, BODY_H = 0.80, BODY_D = 0.44
  const bodyY = 0.34 + BODY_H / 2
  const body = roundedSlab(THREE, BODY_W, BODY_H, BODY_D, 0.20, 'body', M.body)
  body.position.y = bodyY
  him.add(body)

  const bandTopY = bodyY + BODY_H / 2 - 0.09
  const band = roundedSlab(THREE, BODY_W + 0.006, 0.18, BODY_D + 0.006, 0.085, 'head-band', M.band)
  band.position.y = bandTopY
  him.add(band)

  const gleam = roundedSlab(THREE, 0.28, 0.07, 0.02, 0.034, 'band-gleam', M.gleam)
  gleam.position.set(-0.12, bandTopY + 0.005, BODY_D / 2 + 0.001)
  him.add(gleam)

  const faceZ = BODY_D / 2
  const eyeY = bodyY + 0.10
  const arms = {}
  const eyes = { whites: [], pupils: [], glints: [] }
  for (const side of [-1, 1]) {
    const key = side < 0 ? 'left' : 'right'
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.078, 40, 32), M.white)
    white.name = `eye-${key}`
    white.position.set(side * 0.125, eyeY, faceZ - 0.048)
    white.scale.set(1, 1.02, 0.5)
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.056, 32, 24), M.dark)
    pupil.name = `pupil-${key}`
    pupil.position.set(side * 0.125, eyeY - 0.004, faceZ - 0.012)
    pupil.scale.set(1, 1.04, 0.42)
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.013, 16, 12), M.white)
    glint.name = `glint-${key}`
    glint.position.set(side * 0.125 + 0.022, eyeY + 0.026, faceZ + 0.004)
    const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.075, 24, 18), M.rose)
    cheek.name = `blush-${key}`
    cheek.position.set(side * 0.225, eyeY - 0.085, faceZ - 0.02)
    cheek.scale.set(1.1, 0.5, 0.14)
    eyes.whites.push(white); eyes.pupils.push(pupil); eyes.glints.push(glint)
    him.add(white, pupil, glint, cheek)

    // arms pivot at the shoulder so they can swing
    const pivot = new THREE.Group()
    pivot.name = `arm-pivot-${key}`
    pivot.position.set(side * 0.22, bodyY + 0.22, 0)
    pivot.userData.rest = side * 1.52          // resting angle: out to the side, slightly down
    pivot.rotation.z = pivot.userData.rest
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.34, 12, 24), M.band)
    arm.name = `arm-${key}`
    arm.position.set(0, -0.225, 0)
    pivot.add(arm)
    him.add(pivot)
    arms[key] = pivot
  }

  const mouthSmile = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.017, 14, 40, Math.PI * 0.78), M.dark)
  mouthSmile.name = 'mouth-smile'
  mouthSmile.position.set(0, eyeY - 0.105, faceZ + 0.006)
  mouthSmile.rotation.z = Math.PI * 1.11
  mouthSmile.scale.set(1, 0.78, 0.6)

  const mouthFlat = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.13, 8, 16), M.dark)
  mouthFlat.name = 'mouth-flat'
  mouthFlat.position.set(0, eyeY - 0.115, faceZ + 0.002)
  mouthFlat.rotation.z = Math.PI / 2
  mouthFlat.scale.set(1, 1, 0.45)
  mouthFlat.visible = false

  const mouthOpen = new THREE.Mesh(new THREE.SphereGeometry(0.062, 28, 20), M.dark)
  mouthOpen.name = 'mouth-open'
  mouthOpen.position.set(0, eyeY - 0.13, faceZ - 0.01)
  mouthOpen.scale.set(1, 1.15, 0.42)
  mouthOpen.visible = false

  him.add(mouthSmile, mouthFlat, mouthOpen)

  const sprout = new THREE.Group()
  sprout.name = 'sprout'
  sprout.position.y = bodyY + BODY_H / 2
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.30, 20), M.stem)
  stem.name = 'stem'; stem.position.y = 0.13
  const leafA = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 20), M.leaf)
  leafA.name = 'leaf-left'
  leafA.position.set(-0.17, 0.19, 0.02); leafA.scale.set(1.5, 0.3, 0.85); leafA.rotation.z = 0.36
  const leafB = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 20), M.leaf)
  leafB.name = 'leaf-right'
  leafB.position.set(0.16, 0.27, 0); leafB.scale.set(1.35, 0.28, 0.8); leafB.rotation.z = -0.3
  sprout.add(stem, leafA, leafB)
  him.add(sprout)

  return {
    group, him, potGroup, sprout, arms, eyes, materials: M,
    mouths: { smile: mouthSmile, flat: mouthFlat, open: mouthOpen },
    metrics: { bodyY, eyeY, bodyH: BODY_H, headY: bodyY + BODY_H / 2 },
  }
}

export function setMood(model, mood) {
  const m = MOODS[mood] ?? MOODS.okay
  model.materials.body.color.setHex(m.body)
  model.materials.body.emissive.setHex(m.body)
  model.materials.band.color.setHex(m.band)
  model.materials.band.emissive.setHex(m.band)
  model.materials.gleam.color.setHex(m.highlight)
  const dull = mood === 'tired'
  const leafHex = dull ? 0x9ca3af : mood === 'wilting' || mood === 'screaming' ? 0x6b8f5e : 0x2fb45c
  model.materials.leaf.color.setHex(leafHex)
  model.materials.leaf.emissive.setHex(leafHex)
  model.materials.stem.color.setHex(dull ? 0x6b7280 : mood === 'wilting' || mood === 'screaming' ? 0x4d7346 : 0x1d8a45)
  for (const [k, mesh] of Object.entries(model.mouths)) mesh.visible = k === m.mouth
  return m
}

const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2

// t in seconds. gesture: null (mood default), or 'wave' / 'sigh' / 'bob' / 'shake' to force one.
export function poseEmergy(model, mood, t, forced) {
  const m = MOODS[mood] ?? MOODS.okay
  const g = forced ?? m.gesture
  const him = model.him
  him.position.set(0, 0, 0)
  him.rotation.set(0, 0, 0)
  him.scale.set(1, 1, 1)
  model.sprout.rotation.set(0, 0, 0)
  model.sprout.position.y = model.metrics.headY
  const arm = (key, up, extra = 0) => {
    const p = model.arms[key]
    // never swing an arm BELOW its rest angle — that is what let it clip past the pot
    const u = Math.max(-0.02, up + extra)
    p.rotation.set(0, 0, p.userData.rest + (key === 'right' ? u : -u))
  }
  arm('left', 0); arm('right', 0)
  for (let i = 0; i < 2; i++) {
    model.eyes.whites[i].scale.y = 1.02
    model.eyes.pupils[i].scale.y = 1.04
    model.eyes.glints[i].visible = true
  }

  if (g === 'wave') {
    // 4.4s loop: settle → lift the arm → three swings → lower → settle
    const T = 4.4, c = t % T
    const lift = c < 0.45 ? ease(c / 0.45)
      : c < 2.5 ? 1
      : c < 2.95 ? 1 - ease((c - 2.5) / 0.45) : 0
    const swings = c > 0.4 && c < 2.55 ? Math.sin((c - 0.4) * 7.4) : 0
    const excited = lift * (0.55 + 0.45 * Math.abs(swings))

    arm('right', lift * (0.72 + 0.34 * (0.5 + 0.5 * swings)))
    arm('left', 0.06 * lift, Math.sin(t * 2.6) * 0.05)

    // he leans away from the raised arm and bounces on the beat
    him.rotation.z = -0.045 * lift - swings * 0.02
    him.rotation.y = 0.06 * lift
    him.position.y = Math.sin(t * 2.6) * 0.008 - 0.014 * lift - Math.abs(swings) * 0.008 * lift
    him.scale.y = 1 + 0.012 * excited
    // the sprout trails the motion
    model.sprout.rotation.z = -swings * 0.2 * lift + Math.sin(t * 2.6 + 0.7) * 0.06
    model.sprout.rotation.x = -0.06 * lift
    // eyes widen mid-wave
    for (let i = 0; i < 2; i++) {
      model.eyes.whites[i].scale.y = 1.02 + 0.12 * excited
      model.eyes.pupils[i].scale.y = 1.04 + 0.12 * excited
    }
  } else if (g === 'sigh') {
    // 6.2s loop: slump → slow inhale → brief hold → long exhale → deeper slump
    const T = 6.2, c = t % T
    let inhale = 0, exhale = 0
    if (c < 1.1) inhale = 0                       // resting slump
    else if (c < 2.5) inhale = ease((c - 1.1) / 1.4)
    else if (c < 2.9) inhale = 1                  // hold
    else if (c < 4.6) { inhale = 1 - ease((c - 2.9) / 1.7); exhale = ease((c - 2.9) / 1.7) }
    else exhale = 1 - ease(Math.min(1, (c - 4.6) / 1.6))

    const slump = 1 - inhale
    him.scale.set(1 + inhale * 0.022, 1 + inhale * 0.05 - exhale * 0.02, 1 + inhale * 0.022)
    him.position.y = inhale * 0.03 - exhale * 0.022 - 0.006
    him.rotation.z = 0.03 * slump + 0.012 * exhale
    him.rotation.x = 0.05 * exhale
    // shoulders rise on the inhale and drop past neutral on the way out
    arm('left', 0.3 * inhale - 0.26 * exhale - 0.12 * slump)
    arm('right', 0.3 * inhale - 0.26 * exhale - 0.12 * slump)
    // the sprout lifts, then folds forward — the visible "sigh"
    model.sprout.rotation.z = 0.4 * slump - 0.12 * inhale
    model.sprout.rotation.x = 0.5 * exhale + 0.12 * slump
    model.sprout.position.y = model.metrics.headY - 0.02 * exhale
    // eyes close down to a squint as he breathes out
    for (let i = 0; i < 2; i++) {
      const squint = 1 - 0.45 * exhale - 0.15 * slump
      model.eyes.whites[i].scale.y = 1.02 * squint
      model.eyes.pupils[i].scale.y = 1.04 * squint
      model.eyes.glints[i].visible = exhale < 0.4
    }
  } else if (g === 'shake') {
    him.position.x = Math.sin(t * 26) * 0.016
    him.position.y = Math.abs(Math.sin(t * 13)) * 0.012
    model.sprout.rotation.z = Math.sin(t * 26 + 1) * 0.12
    arm('left', 0.45 + Math.sin(t * 20) * 0.16)
    arm('right', 0.45 - Math.sin(t * 20) * 0.16)
  } else {
    const breathe = Math.sin(t * 1.5) * 0.5 + 0.5
    him.position.y = Math.sin(t * 1.5) * 0.016
    him.scale.y = 1 + breathe * 0.012
    model.sprout.rotation.z = Math.sin(t * 1.5 + 0.5) * 0.05
    arm('left', Math.sin(t * 1.5) * 0.05)
    arm('right', Math.sin(t * 1.5) * 0.05)
  }
}

// ── shared studio: lights, a soft ground shadow, and the two framings ──
// Three-quarter camera angles: seeing two faces of him is what makes the
// geometry read as geometry at 30px.
export const FITS = {
  full: { w: 320, h: 400, cam: [1.34, 1.18, 3.0], target: [0, 0.72, 0] },
  // square slots (nav button, avatars) — whole body, pot included, filling a 1:1 box
  icon: { w: 320, h: 320, cam: [1.5, 1.24, 3.36], target: [0, 0.68, 0] },
  bust: { w: 280, h: 280, cam: [0.62, 1.12, 1.46], target: [0, 0.94, 0] },
}

function shadowTexture(THREE) {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const rad = g.createRadialGradient(64, 64, 4, 64, 64, 62)
  rad.addColorStop(0, 'rgba(0,0,0,0.62)')
  rad.addColorStop(0.45, 'rgba(0,0,0,0.34)')
  rad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = rad
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}

export function makeStudio(THREE, model) {
  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(0xe8ecff, 0x1a1926, 0.55))
  const key = new THREE.DirectionalLight(0xfff8ea, 2.15); key.position.set(2.6, 3.4, 2.6); scene.add(key)
  const fill = new THREE.DirectionalLight(0xbfd0ff, 0.32); fill.position.set(-2.8, 0.9, 1.4); scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffeecb, 1.0); rim.position.set(-1.6, 2.2, -2.8); scene.add(rim)
  const bounce = new THREE.DirectionalLight(0xffd9a0, 0.22); bounce.position.set(0, -2, 1.2); scene.add(bounce)

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.7),
    new THREE.MeshBasicMaterial({ map: shadowTexture(THREE), transparent: true, depthWrite: false }),
  )
  shadow.name = 'ground-shadow'
  shadow.rotation.x = -Math.PI / 2
  shadow.position.set(0.05, 0.004, 0.04)
  scene.add(shadow)

  if (model) scene.add(model.group)
  return scene
}
