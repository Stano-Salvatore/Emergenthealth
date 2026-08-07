// Framework-free 3D garden scene: owns renderer, camera, controls and the
// animation loop. Mount it into any DOM element; drive it with update(data).
//
//   const scene = await createGardenScene(hostEl, { onPlantClick })
//   scene.update({ habits, weatherCode, isDay })
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
  controls.maxDistance = 26;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.target.set(0, 0.6, 0);

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

  /* click-to-select a habit plant */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const byIndex = new Map(flora.plantings.map(p => [p.holder, p]));
  const onPointerUp = e => {
    if (!opts.onPlantClick || dragged) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    for (const hit of ray.intersectObject(flora.root, true)) {
      let o = hit.object;
      while (o && !byIndex.has(o)) o = o.parent;
      if (o) { opts.onPlantClick(byIndex.get(o).habitId ?? byIndex.get(o).label); return; }
    }
  };
  let dragged = false, downAt = 0;
  renderer.domElement.addEventListener('pointerdown', () => { dragged = false; downAt = performance.now(); });
  controls.addEventListener('start', () => { if (performance.now() - downAt > 120) dragged = true; });
  controls.addEventListener('change', () => { if (performance.now() - downAt > 160) dragged = true; });
  renderer.domElement.addEventListener('pointerup', onPointerUp);

  /* state */
  let weather = { kind: 'clear', isDay: true, windKph: 6 };
  fx.setWeather(weather);

  const swayables = [
    ...terrain.tufts.map(o => ({ o, amp: 0.13, base: o.rotation.z })),
    ...flora.canopies.map(o => ({ o, amp: 0.05, base: o.rotation.z })),
    ...flora.plantings.map(p => ({ o: p.holder, amp: 0.035, base: 0 })),
  ];

  /* sparkles for the watering feedback */
  const sparkGeo = new THREE.BufferGeometry();
  const SP = 160, spPos = new Float32Array(SP * 3), spVel = new Float32Array(SP * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffe6a8, size: 0.09, transparent: true, opacity: 0 }));
  sparks.name = 'sparkles';
  scene.add(sparks);
  let sparkT = 0;

  const resize = () => {
    const w = host.clientWidth || 1, h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  let raf = 0, last = performance.now(), t = 0, running = true;
  const frame = now => {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05); last = now; t += dt;
    const wind = 0.35 + Math.min(weather.windKph, 45) / 45;
    swayables.forEach((s, i) => {
      s.o.rotation.z = s.base + Math.sin(t * (1.1 + (i % 5) * 0.13) * wind + i) * s.amp * wind;
    });
    fauna.update(t);
    fx.update(dt);
    terrain.bloomCore.scale.setScalar(1 + Math.sin(t * 1.6) * 0.06);
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
    /** data: { habits?: [{id, stage, kind?, petal?}|{id, progress}], decorations?, weatherCode?, windKph?, isDay? } */
    update(data = {}) {
      if (Array.isArray(data.habits)) {
        data.habits.slice(0, flora.plantings.length).forEach((h, i) => {
          const rec = flora.plantings[i];
          rec.habitId = h.id ?? rec.habitId;
          if (h.label) rec.label = h.label;
          const s = h.stage != null ? h.stage : stageForProgress(h.progress);
          const k = h.kind ?? rec.kind;
          const petal = h.petal !== undefined ? h.petal : rec.petal;
          if (s !== rec.stage || k !== rec.kind || petal !== rec.petal) rec.set(s, k, petal);
        });
        // pots without a habit behind them stay out of the scene
        flora.plantings.forEach((rec, i) => { rec.holder.visible = i < data.habits.length });
      }
      if (Array.isArray(data.decorations)) {
        const on = id => data.decorations.includes(id);
        const show = (name, v) => { const o = root.getObjectByName(name); if (o) o.visible = v };
        show('gnome', on('gnome'));
        show('robin', on('bird'));
        ;['butterfly_a', 'butterfly_b', 'butterfly_c'].forEach(n => show(n, on('butterfly')));
        ;['bee_0', 'bee_1', 'bee_2'].forEach(n => show(n, on('bee')));
      }
      weather = {
        kind: data.weatherCode !== undefined ? kindForCode(data.weatherCode) : weather.kind,
        isDay: data.isDay ?? weather.isDay,
        windKph: data.windKph ?? weather.windKph,
      };
      fx.setWeather(weather);
    },
    setFaunaVisible(v) { fauna.root.visible = v; },
    sparkle() {
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
    },
    resize,
    habits: HABITS,
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', vis);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
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
