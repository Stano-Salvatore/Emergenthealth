// Framework-free 3D garden scene: owns renderer, camera, controls and the
// animation loop. Mount it into any DOM element; drive it with update(data).
//
//   const scene = await createGardenScene(hostEl, { onPlantClick })
//   scene.update({ habits, decorations, level, weatherCode, hour })
//   scene.destroy()

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { group } from './core.js';
import { buildTerrain } from './terrain.js';
import { buildFlora, HABITS } from './flora.js';
import { buildDecor } from './decor.js';
import { buildFauna } from './fauna.js';
import { buildWeatherFX } from './weather.js';

/** Open-Meteo WMO code → the effect kind used by weather.js */
export function kindForCode(code) {
  if (code == null) return 'clear';
  if (code <= 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code <= 48) return 'fog';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'rain';
  if (code <= 86) return 'snow';
  return 'rain';
}

/** 0…1 completion (or a streak ratio) → a 0…5 growth stage. */
export function stageForProgress(p) {
  if (!p || p <= 0) return 0;
  return Math.max(1, Math.min(5, Math.ceil(p * 5)));
}

// Scenery unlocked per garden level. Strings match object names exactly,
// regexes match families. Everything not listed is always visible.
const LEVEL_GROUPS = [
  [2, ['string_lights', 'lantern_plaza_a', 'lantern_plaza_b', 'lantern_path', 'candle_jar']],
  [3, [/^lily_pad_/, /^lily_flower_/, /^koi_\d+$/]],
  [4, [/^tree_(blossom|pine_[a-z])$/]],
  [5, ['plant_shelf', /^planter_box_\d+$/]],
  [6, ['potting_bench', 'watering_can', 'crock_jar', 'stool', 'cushion', 'cat']],
  [7, ['balustrade', 'basket', /^stepping_stone_\d+$/]],
  [8, ['pergola']],
];

const DAY_START = 6, DAY_END = 20;   // sun above the horizon 06:00–20:00
const MOON_START = 19, MOON_HOURS = 12;

export async function createGardenScene(host, opts = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(11, 8.5, 12);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  Object.assign(renderer.domElement.style, { width: '100%', height: '100%', display: 'block', touchAction: 'none' });
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 7;
  controls.maxDistance = 36;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.target.set(0, 0.6, 0);

  // Start far enough back that the island fits the viewport — on a tall
  // phone the horizontal fov is the tight one, so fit against whichever
  // half-angle is smaller. Runs once; after that the user's zoom rules.
  const fitCamera = () => {
    const FIT_R = 8.0;                       // island half-extent incl. trees
    const vh = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hh = Math.atan(Math.tan(vh) * camera.aspect);
    const d = Math.min(Math.max((FIT_R / Math.tan(Math.min(vh, hh))) * 0.92, 12), 32);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, d);
  };

  const root = group('habit_garden');
  const terrain = buildTerrain();
  const flora = buildFlora();
  const decor = buildDecor();
  const fauna = buildFauna();
  const fx = buildWeatherFX();
  root.add(terrain.root, flora.root, decor.root, fauna.root, fx.root);
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(root);

  const key = new THREE.DirectionalLight(0xfff3dd, 0.55);
  key.position.set(6, 11, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -9;
  key.shadow.camera.right = key.shadow.camera.top = 9;
  scene.add(key);

  /* ── sun & moon riding an arc behind the island ─────────────────────────── */
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffd27a });
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), sunMat);
  const sunHalo = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.25, depthWrite: false }));
  sun.add(sunHalo);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xe8ecf4 }));
  const moonShadow = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0x2c3654, transparent: true, opacity: 0.85, depthWrite: false }));
  moonShadow.position.set(-0.14, 0.1, -0.05);   // crescent bite
  moon.add(moonShadow);
  sun.visible = moon.visible = false;
  scene.add(sun, moon);

  let hourOverride = null;
  const hourNow = () => hourOverride ?? (() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60 })();
  // altitude 0..1 across the arc, or -1 when below the horizon
  const arcT = (h, start, span) => {
    const p = ((h - start + 24) % 24) / span;
    return p >= 0 && p <= 1 ? p : -1;
  };
  const placeOnArc = (obj, p) => {
    const a = p * Math.PI;
    obj.position.set(-Math.cos(a) * 12, Math.sin(a) * 6.5 + 0.5, -8);
  };

  const applyTimeOfDay = () => {
    const h = hourNow();
    const sunP = arcT(h, DAY_START, DAY_END - DAY_START);
    const moonP = arcT(h, MOON_START, MOON_HOURS);
    const isDay = sunP >= 0;
    sun.visible = isDay && Math.sin(sunP * Math.PI) > 0.04;
    moon.visible = !isDay && moonP >= 0 && Math.sin(moonP * Math.PI) > 0.04;
    if (sun.visible) placeOnArc(sun, sunP);
    if (moon.visible) placeOnArc(moon, moonP);

    // key light tracks whichever body is up; warm at the horizon, cool at night
    if (isDay) {
      const alt = Math.sin(sunP * Math.PI);            // 0 horizon → 1 noon
      key.position.copy(sun.position).setLength(14);
      key.color.setHex(0xffe9c9).lerp(new THREE.Color(0xff9a5a), 1 - Math.min(1, alt * 1.8));
      key.intensity = 0.32 + alt * 0.35;
    } else {
      key.position.set(moon.visible ? moon.position.x : -6, 9, -6).setLength(14);
      key.color.setHex(0x8fa5cf);
      key.intensity = 0.16;
    }
    return isDay;
  };

  /* click-to-select a habit plant (with a little bounce), long-press = labels */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const byIndex = new Map(flora.plantings.map(p => [p.holder, p]));
  const pulses = [];
  let labelsOn = false, longPressFired = false, longPressTimer = 0;

  const onPointerUp = e => {
    clearTimeout(longPressTimer);
    if (!opts.onPlantClick || dragged || longPressFired) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const hit of ray.intersectObject(flora.root, true)) {
      let o = hit.object;
      while (o && !byIndex.has(o)) o = o.parent;
      if (o) {
        const rec = byIndex.get(o);
        pulses.push({ holder: rec.holder, t0: t });
        opts.onPlantClick(rec.habitId ?? rec.label);
        return;
      }
    }
  };
  let dragged = false, downAt = 0;
  renderer.domElement.addEventListener('pointerdown', () => {
    dragged = false; longPressFired = false; downAt = performance.now();
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (!dragged) { labelsOn = !labelsOn; longPressFired = true; syncLabels(); }
    }, 550);
  });
  controls.addEventListener('start', () => { if (performance.now() - downAt > 120) dragged = true; });
  controls.addEventListener('change', () => { if (performance.now() - downAt > 160) dragged = true; });
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  /* ── floating habit labels (HTML overlay, projected each frame) ─────────── */
  const labelLayer = document.createElement('div');
  Object.assign(labelLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '15' });
  host.appendChild(labelLayer);
  const labelEls = [];
  const labelStyle = el => Object.assign(el.style, {
    position: 'absolute', transform: 'translate(-50%,-100%)', whiteSpace: 'nowrap',
    background: 'rgba(22,26,22,0.85)', border: '1px solid rgba(255,233,176,0.35)',
    color: '#f2efe4', font: '600 10px system-ui, sans-serif', padding: '2px 7px',
    borderRadius: '8px', display: 'none',
  });
  const syncLabels = () => {
    while (labelEls.length < flora.plantings.length) {
      const el = document.createElement('div');
      labelStyle(el);
      labelLayer.appendChild(el);
      labelEls.push(el);
    }
    flora.plantings.forEach((rec, i) => {
      const el = labelEls[i];
      const show = labelsOn && rec.holder.visible && rec.habitId;
      el.style.display = show ? 'block' : 'none';
      if (show) el.textContent = rec.streakLabel ?? rec.label;
    });
  };
  const projectLabels = () => {
    if (!labelsOn) return;
    const w = host.clientWidth, h = host.clientHeight;
    const v = new THREE.Vector3();
    flora.plantings.forEach((rec, i) => {
      const el = labelEls[i];
      if (!el || el.style.display === 'none') return;
      v.copy(rec.holder.position); v.y += 1.3;
      v.project(camera);
      if (v.z > 1) { el.style.opacity = '0'; return; }
      el.style.opacity = '1';
      el.style.left = `${(v.x + 1) / 2 * w}px`;
      el.style.top = `${(1 - v.y) / 2 * h}px`;
    });
  };

  /* ── streak halos: gold motes over blooming (stage 5) plants ────────────── */
  const halos = new Map();
  const ensureHalo = rec => {
    const want = rec.stage === 5 && !rec.wilted && rec.holder.visible;
    const have = halos.get(rec.index);
    if (want && !have) {
      const n = 10, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        pos[i * 3] = Math.cos(a) * 0.34;
        pos[i * 3 + 1] = 0.55 + (i % 3) * 0.22;
        pos[i * 3 + 2] = Math.sin(a) * 0.34;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const halo = new THREE.Points(geo, new THREE.PointsMaterial({
        color: 0xffdf8e, size: 0.07, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      halo.name = `halo_${rec.index}`;
      rec.holder.add(halo);
      halos.set(rec.index, halo);
    } else if (!want && have) {
      have.removeFromParent(); have.geometry.dispose(); have.material.dispose();
      halos.delete(rec.index);
    }
  };

  /* ── watering-can flight + droplets (sparkle sequence) ──────────────────── */
  const can = decor.root.getObjectByName('watering_can');
  const canHome = can ? { pos: can.position.clone(), rot: can.rotation.clone() } : null;
  const DROPS = 90;
  const dropPos = new Float32Array(DROPS * 3), dropVel = new Float32Array(DROPS * 3), dropAge = new Float32Array(DROPS).fill(9);
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute('position', new THREE.BufferAttribute(dropPos, 3));
  const drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({
    color: 0x9fd4ec, size: 0.07, transparent: true, opacity: 0.9, depthWrite: false,
  }));
  drops.visible = false;
  scene.add(drops);
  let waterT = -1;                    // animation clock, -1 = idle
  const WATER_DUR = 2.8;

  /* gold sparkles for the watering feedback */
  const sparkGeo = new THREE.BufferGeometry();
  const SP = 160, spPos = new Float32Array(SP * 3), spVel = new Float32Array(SP * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffe6a8, size: 0.09, transparent: true, opacity: 0 }));
  sparks.name = 'sparkles';
  scene.add(sparks);
  let sparkT = 0;

  const burstSparks = () => {
    sparkT = 1.4;
    const pos = sparks.geometry.attributes.position;
    for (let i = 0; i < SP; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 4;
      pos.setXYZ(i, Math.cos(a) * r, 0.3 + Math.random() * 0.6, Math.sin(a) * r);
      spVel[i * 3] = (Math.random() - 0.5) * 0.5;
      spVel[i * 3 + 1] = 0.8 + Math.random() * 1.2;
      spVel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    }
    pos.needsUpdate = true;
  };

  /* level-gated scenery */
  let levelObjects = null;
  const collectLevelObjects = () => {
    levelObjects = LEVEL_GROUPS.map(([lvl, names]) => {
      const objs = [];
      for (const n of names) {
        if (typeof n === 'string') {
          const o = root.getObjectByName(n);
          if (o) objs.push(o);
        } else {
          root.traverse(o => { if (n.test(o.name)) objs.push(o) });
        }
      }
      return [lvl, objs];
    });
  };

  /* state */
  let weather = { kind: 'clear', isDay: true, windKph: 6 };
  fx.setWeather(weather);
  applyTimeOfDay();

  const swayables = [
    ...terrain.tufts.map(o => ({ o, amp: 0.13, base: o.rotation.z })),
    ...flora.canopies.map(o => ({ o, amp: 0.05, base: o.rotation.z })),
    ...flora.plantings.map(p => ({ o: p.holder, amp: 0.035, base: 0 })),
  ];

  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  fitCamera();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  let raf = 0, last = performance.now(), t = 0, running = true, todTimer = 0;
  const frame = now => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05); last = now; t += dt;
    todTimer += dt;
    if (todTimer > 30) {              // re-check the clock every 30s
      todTimer = 0;
      const isDay = applyTimeOfDay();
      if (isDay !== weather.isDay) { weather = { ...weather, isDay }; fx.setWeather(weather); }
    }

    const wind = 0.35 + Math.min(weather.windKph, 45) / 45;
    swayables.forEach((s, i) => {
      s.o.rotation.z = s.base + Math.sin(t * (1.1 + (i % 5) * 0.13) * wind + i) * s.amp * wind;
    });
    fauna.update(t);
    fx.update(dt);
    terrain.bloomCore.scale.setScalar(1 + Math.sin(t * 1.6) * 0.06);

    // tap bounce
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], age = t - p.t0;
      if (age > 0.55) { p.holder.scale.setScalar(1); pulses.splice(i, 1); continue }
      p.holder.scale.setScalar(1 + Math.sin((age / 0.55) * Math.PI) * 0.17);
    }

    // halos spin
    halos.forEach(halo => { halo.rotation.y = t * 0.7 });

    // watering-can flight: out → tilt & pour → home
    if (waterT >= 0) {
      waterT += dt;
      const p = waterT / WATER_DUR;
      if (can && canHome && p <= 1) {
        const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
        const target = { x: 0, y: 2.3, z: 0.5 };
        if (p < 0.25) {
          const k = ease(p / 0.25);
          can.position.lerpVectors(canHome.pos, target, k);
        } else if (p < 0.75) {
          can.position.set(target.x + Math.sin(waterT * 2.2) * 1.4, target.y, target.z + Math.cos(waterT * 1.7) * 1.2);
          can.rotation.z = canHome.rot.z - 0.85;
          // emit droplets from the spout
          for (let e = 0; e < 3; e++) {
            const i = (Math.random() * DROPS) | 0;
            if (dropAge[i] > 0.8) {
              dropAge[i] = 0;
              dropPos[i * 3] = can.position.x + 0.4;
              dropPos[i * 3 + 1] = can.position.y + 0.1;
              dropPos[i * 3 + 2] = can.position.z;
              dropVel[i * 3] = (Math.random() - 0.5) * 0.5;
              dropVel[i * 3 + 1] = -0.4;
              dropVel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
            }
          }
        } else {
          const k = ease((p - 0.75) / 0.25);
          can.rotation.z = canHome.rot.z - 0.85 * (1 - k);
          can.position.lerpVectors(can.position, canHome.pos, k * 0.35);
        }
      }
      if (p >= 1) {
        waterT = -1;
        drops.visible = false;
        if (can && canHome) { can.position.copy(canHome.pos); can.rotation.copy(canHome.rot) }
      }
    }
    if (drops.visible) {
      let anyAlive = false;
      for (let i = 0; i < DROPS; i++) {
        if (dropAge[i] > 2) continue;
        dropAge[i] += dt;
        dropVel[i * 3 + 1] -= 3.5 * dt;
        dropPos[i * 3] += dropVel[i * 3] * dt;
        dropPos[i * 3 + 1] += dropVel[i * 3 + 1] * dt;
        dropPos[i * 3 + 2] += dropVel[i * 3 + 2] * dt;
        if (dropPos[i * 3 + 1] < 0.1) { dropAge[i] = 9; dropPos[i * 3 + 1] = -50 }
        else anyAlive = true;
      }
      dropGeo.attributes.position.needsUpdate = true;
      if (!anyAlive && waterT < 0) drops.visible = false;
    }

    if (sparkT > 0) {
      sparkT -= dt;
      sparks.material.opacity = Math.max(0, sparkT / 1.4);
      const pos = sparks.geometry.attributes.position;
      for (let i = 0; i < SP; i++) {
        pos.setX(i, pos.getX(i) + spVel[i * 3] * dt);
        pos.setY(i, pos.getY(i) + spVel[i * 3 + 1] * dt);
        pos.setZ(i, pos.getZ(i) + spVel[i * 3 + 2] * dt);
        spVel[i * 3 + 1] -= 1.6 * dt;
      }
      pos.needsUpdate = true;
    }

    projectLabels();
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  const vis = () => {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', vis);

  return {
    /** data: { habits?: [{id, stage, kind?, petal?, wilted?, streak?}], decorations?, level?, weatherCode?, windKph?, hour? } */
    update(data = {}) {
      if (data.hour !== undefined) hourOverride = data.hour;
      if (Array.isArray(data.habits)) {
        data.habits.slice(0, flora.plantings.length).forEach((h, i) => {
          const rec = flora.plantings[i];
          rec.habitId = h.id ?? rec.habitId;
          if (h.label) rec.label = h.label;
          rec.streakLabel = h.streak > 0 ? `${h.label ?? rec.label} · ${h.streak}🔥` : (h.label ?? rec.label);
          const s = h.stage != null ? h.stage : stageForProgress(h.progress);
          const k = h.kind ?? rec.kind;
          const petal = h.petal !== undefined ? h.petal : rec.petal;
          const wilted = !!h.wilted;
          if (s !== rec.stage || k !== rec.kind || petal !== rec.petal || wilted !== rec.wilted) rec.set(s, k, petal, wilted);
        });
        // pots without a habit behind them stay out of the scene
        flora.plantings.forEach((rec, i) => { rec.holder.visible = i < data.habits.length });
        flora.plantings.forEach(rec => ensureHalo(rec));
        syncLabels();
      }
      if (Array.isArray(data.decorations)) {
        const on = id => data.decorations.includes(id);
        const show = (name, v) => { const o = root.getObjectByName(name); if (o) o.visible = v };
        show('gnome', on('gnome'));
        show('robin', on('bird'));
        ;['butterfly_a', 'butterfly_b', 'butterfly_c'].forEach(n => show(n, on('butterfly')));
        ;['bee_0', 'bee_1', 'bee_2'].forEach(n => show(n, on('bee')));
      }
      if (typeof data.level === 'number') {
        if (!levelObjects) collectLevelObjects();
        for (const [lvl, objs] of levelObjects) {
          for (const o of objs) o.visible = data.level >= lvl;
        }
      }
      weather = {
        kind: data.weatherCode !== undefined ? kindForCode(data.weatherCode) : weather.kind,
        isDay: applyTimeOfDay(),
        windKph: data.windKph ?? weather.windKph,
      };
      fx.setWeather(weather);
    },
    setFaunaVisible(v) { fauna.root.visible = v; },
    sparkle() {
      if (can && can.visible && waterT < 0) {
        waterT = 0;
        drops.visible = true;
        dropAge.fill(9);
        for (let i = 0; i < DROPS; i++) dropPos[i * 3 + 1] = -50;
        dropGeo.attributes.position.needsUpdate = true;
        setTimeout(() => { if (running) burstSparks() }, 1100);
      } else {
        burstSparks();
      }
    },
    resize,
    habits: HABITS,
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      clearTimeout(longPressTimer);
      ro.disconnect();
      document.removeEventListener('visibilitychange', vis);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      labelLayer.remove();
      controls.dispose();
      scene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
