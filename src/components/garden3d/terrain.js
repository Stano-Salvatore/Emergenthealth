// Floating island, ground tiles, water, grass tufts and lily pads.
import { THREE, M, G, COLS, ROWS, wx, wz, lift, hash, mk, group } from './core.js';

const BASE = -0.5;

export function buildTerrain() {
  const root = group('terrain');
  const add = o => (root.add(o), o);

  add(mk('island_soil', new THREE.BoxGeometry(COLS, 0.75, ROWS), M.soil, 0, BASE - 0.375, 0));
  add(mk('island_bedrock', new THREE.BoxGeometry(COLS - 1.6, 0.7, ROWS - 1.6), M.soilDark, 0, BASE - 1.08, 0));
  add(mk('island_keel', new THREE.ConeGeometry(3.2, 1.6, 6), M.soilDark, 0, BASE - 2.15, 0));
  for (let i = 0; i < 16; i++) {
    const s = i % 4, p = -4.4 + (i % 6) * 1.6, yy = BASE - 0.3 - (i % 3) * 0.24;
    const pos = s === 0 ? [p, yy, ROWS / 2] : s === 1 ? [COLS / 2, yy, p] : s === 2 ? [p, yy, -ROWS / 2] : [-COLS / 2, yy, p];
    const r = mk(`base_rock_${i}`, new THREE.IcosahedronGeometry(0.12 + (i % 3) * 0.04, 0), M.stoneDark, ...pos);
    r.rotation.set(i, i * 1.7, i * 0.6);
    add(r);
  }

  const tGeo = new Map();
  const boxH = h => {
    const k = h.toFixed(3);
    if (!tGeo.has(k)) tGeo.set(k, new THREE.BoxGeometry(0.995, h, 0.995));
    return tGeo.get(k);
  };
  const waterTops = [];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const g = G[y][x], top = g === 'water' ? -0.26 : lift(x, y), h = top - BASE;
    const m = g === 'grass' ? ((x + y) % 2 ? M.grass : M.grassAlt)
      : g === 'stone' ? M.stoneWarm : g === 'wood' ? M.woodDark : M.soilDark;
    add(mk(`tile_${g}_${x}_${y}`, boxH(h), m, wx(x), BASE + h / 2, wz(y)));
    if (g === 'water') waterTops.push(add(mk(`water_${x}_${y}`, new THREE.BoxGeometry(0.95, 0.05, 0.95), M.water, wx(x), -0.22, wz(y))));
    if (g === 'stone') add(mk(`plaza_slab_${x}_${y}`, new THREE.BoxGeometry(0.92, 0.07, 0.92), M.stone, wx(x), 0.035, wz(y)));
    if (g === 'wood') for (let p = 0; p < 3; p++)
      add(mk(`plank_${x}_${y}_${p}`, new THREE.BoxGeometry(0.96, 0.08, 0.29), M.wood, wx(x), 0.04, wz(y) - 0.32 + p * 0.32));
  }

  const tufts = [];
  let n = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (G[y][x] === 'grass') {
      const c = (x * 3 + y * 5) % 3;
      for (let i = 0; i <= c; i++) {
        const ox = (hash(x * 31 + y * 17 + i) - 0.5) * 0.72, oz = (hash(x * 13 + y * 29 + i * 7) - 0.5) * 0.72;
        const t = mk(`grass_tuft_${n++}`, new THREE.ConeGeometry(0.08, 0.2, 4), i % 2 ? M.leafLight : M.grassDeep,
          wx(x) + ox, lift(x, y) + 0.09, wz(y) + oz);
        t.rotation.set(0.1, i * 1.3, 0.08);
        add(t); tufts.push(t);
        if ((x + y + i) % 4 === 0) {
          const f = [M.cream, M.pink, M.yellow, M.lavender][(x + y + i) % 4];
          add(mk(`flower_speck_${n}`, new THREE.SphereGeometry(0.05, 8, 6), f, wx(x) + ox + 0.11, lift(x, y) + 0.15, wz(y) + oz + 0.07));
        }
      }
    } else if (G[y][x] === 'water' && (x + y) % 2 === 0) {
      add(mk(`lily_pad_${x}_${y}`, new THREE.CylinderGeometry(0.19, 0.19, 0.03, 12), M.leafDeep, wx(x) + 0.1, -0.19, wz(y) - 0.08));
      add(mk(`lily_flower_${x}_${y}`, new THREE.SphereGeometry(0.07, 10, 8), M.cream, wx(x) + 0.1, -0.14, wz(y) - 0.08));
    }
  }

  // centre pedestal with the glowing bloom
  const ped = group('centre_pedestal', wx(4.5), 0.07, wz(4.5));
  ped.add(mk('pedestal_base', new THREE.BoxGeometry(1.3, 0.4, 1.3), M.terracotta, 0, 0.2, 0));
  ped.add(mk('pedestal_cap', new THREE.BoxGeometry(1.05, 0.12, 1.05), M.stone, 0, 0.46, 0));
  ped.add(mk('bloom_dish', new THREE.CylinderGeometry(0.36, 0.24, 0.14, 24), M.brass, 0, 0.59, 0));
  const rim = mk('bloom_dish_rim', new THREE.TorusGeometry(0.35, 0.04, 10, 28), M.brass, 0, 0.66, 0);
  rim.rotation.x = Math.PI / 2; ped.add(rim);
  const core = mk('bloom_core', new THREE.SphereGeometry(0.16, 20, 16), M.glow, 0, 0.8, 0);
  ped.add(core);
  for (let i = 0; i < 6; i++) {
    const a = i * 1.047;
    const p = mk(`bloom_petal_${i}`, new THREE.SphereGeometry(0.12, 12, 10), M.cream, Math.cos(a) * 0.17, 0.75, Math.sin(a) * 0.17);
    p.scale.set(1, 0.55, 0.75); p.rotation.set(0.35, -a, 0); ped.add(p);
  }
  add(ped);

  return { root, tufts, waterTops, bloomCore: core };
}
