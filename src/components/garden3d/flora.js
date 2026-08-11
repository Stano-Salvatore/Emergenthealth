// Pots, plants with growth stages, and trees.
import { THREE, M, wx, wz, topY, mk, group } from './core.js';

export const STAGE_NAMES = ['Seed', 'Sprout', 'Seedling', 'Growing', 'Budding', 'Blooming'];

export function pot(name, r = 0.26, h = 0.3, m = M.terracotta) {
  const g = group(name);
  g.add(mk(`${name}_body`, new THREE.CylinderGeometry(r, r * 0.74, h, 18), m, 0, h / 2, 0));
  g.add(mk(`${name}_rim`, new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.07, 18), m, 0, h - 0.01, 0));
  g.add(mk(`${name}_soil`, new THREE.CylinderGeometry(r * 0.96, r * 0.96, 0.05, 16), M.soil, 0, h + 0.015, 0));
  return g;
}

/** kind: bush | herb | lavender | rose | tulip — stage: 0…5.
 *  petalName (optional) overrides the bloom material, e.g. 'yellow' for a
 *  sunflower rendered on the tulip archetype.
 *  wilted renders the missed-too-many-days look instead of the seed mound. */
export function plant(name, kind, stage = 4, petalName, wilted = false) {
  const g = group(name);
  g.userData = { kind, stage, wilted };
  const petalOverride = petalName ? M[petalName] : null;

  if (wilted) {
    // drooping brown stem with a hanging head, limp leaves, fallen petals
    g.add(mk(`${name}_wilt_mound`, new THREE.SphereGeometry(0.13, 12, 8), M.soil, 0, 0.02, 0)).scale.set(1, 0.4, 1);
    const stem = mk(`${name}_wilt_stem`, new THREE.CylinderGeometry(0.02, 0.028, 0.34, 6), M.wiltStem, 0.07, 0.14, 0);
    stem.rotation.z = -0.55; g.add(stem);
    const head = mk(`${name}_wilt_head`, new THREE.SphereGeometry(0.06, 8, 6), M.wiltStem, 0.21, 0.24, 0);
    head.scale.set(1, 0.75, 1); g.add(head);
    const leafA = mk(`${name}_wilt_leaf_a`, new THREE.SphereGeometry(0.11, 8, 6), M.wiltLeaf, -0.1, 0.035, 0.05);
    leafA.scale.set(1.4, 0.18, 0.7); leafA.rotation.y = 0.7; g.add(leafA);
    const leafB = mk(`${name}_wilt_leaf_b`, new THREE.SphereGeometry(0.09, 8, 6), M.wiltLeaf, 0.04, 0.03, -0.12);
    leafB.scale.set(1.3, 0.16, 0.65); leafB.rotation.y = -0.9; g.add(leafB);
    [[0.16, 0.1], [-0.05, 0.17], [0.24, -0.06]].forEach(([px, pz], i) => {
      const p = mk(`${name}_wilt_petal_${i}`, new THREE.SphereGeometry(0.035, 6, 5), M.wiltPetal, px, 0.015, pz);
      p.scale.set(1, 0.35, 0.8); p.rotation.y = i * 1.9; g.add(p);
    });
    return g;
  }
  const leafBlade = (id, x, y, z, s, rot, m = M.leaf) => {
    const l = mk(`${name}_${id}`, new THREE.SphereGeometry(0.16, 12, 10), m, x, y, z);
    l.scale.set(s * 1.3, s * 0.35, s * 0.75); l.rotation.set(0, rot, 0.4); g.add(l);
  };
  const blob = (id, x, y, z, s, m, rot = 0) => {
    const b = mk(`${name}_${id}`, new THREE.IcosahedronGeometry(0.16, 1), m, x, y, z);
    b.scale.setScalar(s); b.rotation.set(rot, rot * 1.4, 0); g.add(b);
  };

  if (stage <= 0) {
    g.add(mk(`${name}_mound`, new THREE.SphereGeometry(0.14, 12, 8), M.soil, 0, 0.02, 0)).scale.set(1, 0.45, 1);
    g.add(mk(`${name}_seed_tip`, new THREE.SphereGeometry(0.035, 8, 6), M.leafLight, 0.02, 0.07, 0));
    return g;
  }
  if (stage === 1) {
    g.add(mk(`${name}_sprout`, new THREE.CylinderGeometry(0.02, 0.03, 0.13, 6), M.leaf, 0, 0.065, 0));
    leafBlade('leaf_a', 0.07, 0.14, 0, 0.5, 0.6);
    leafBlade('leaf_b', -0.07, 0.13, 0.03, 0.45, 2.4);
    return g;
  }
  const sc = stage === 2 ? 0.6 : stage === 3 ? 0.82 : 1;

  if (kind === 'bush' || kind === 'herb') {
    const c = kind === 'herb' ? 5 : 7;
    for (let i = 0; i < c; i++) {
      const a = i * 2.399;
      blob(`clump_${i}`, Math.cos(a) * 0.16 * sc, (0.14 + (i % 3) * 0.11) * sc, Math.sin(a) * 0.16 * sc,
        (0.85 + (i % 2) * 0.3) * sc, i % 3 ? M.leaf : M.leafLight, i);
    }
    if (kind === 'bush' && stage >= 4) for (let i = 0; i < (stage === 5 ? 6 : 3); i++) {
      const a = i * 1.1;
      g.add(mk(`${name}_bud_${i}`, new THREE.SphereGeometry(stage === 5 ? 0.07 : 0.05, 10, 8),
        petalOverride ?? (i % 2 ? M.pink : M.yellow),
        Math.cos(a) * 0.2, 0.3 + (i % 2) * 0.08, Math.sin(a) * 0.2));
    }
    return g;
  }

  if (kind === 'lavender') {
    const spikes = stage === 2 ? 4 : stage === 3 ? 5 : 7;
    for (let i = 0; i < spikes; i++) {
      const a = i * 0.9, r = 0.05 + (i % 3) * 0.05, h = (0.42 + (i % 3) * 0.12) * sc;
      const st = mk(`${name}_stem_${i}`, new THREE.CylinderGeometry(0.014, 0.018, h, 6), M.leafDeep, Math.cos(a) * r, h / 2, Math.sin(a) * r);
      st.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); g.add(st);
      if (stage >= 3) g.add(mk(`${name}_spike_${i}`, new THREE.CapsuleGeometry(0.045, stage === 5 ? 0.24 : 0.16, 4, 8), M.lavender,
        Math.cos(a) * r * 1.3, h + 0.13, Math.sin(a) * r * 1.3));
    }
    for (let i = 0; i < 4; i++)
      leafBlade(`base_leaf_${i}`, Math.cos(i * 1.571) * 0.12, 0.06, Math.sin(i * 1.571) * 0.12, 0.6 * sc, -i * 1.571, M.leafDeep);
    return g;
  }

  // rose / tulip
  const stemH = 0.34 * sc, petal = petalOverride ?? (kind === 'tulip' ? M.red : M.pink);
  const stems = kind === 'tulip' ? 3 : 4;
  for (let i = 0; i < stems; i++) {
    const a = i * 1.7, r = 0.09, h = stemH + (i % 2) * 0.1;
    g.add(mk(`${name}_stem_${i}`, new THREE.CylinderGeometry(0.022, 0.028, h, 6), M.leafDeep, Math.cos(a) * r, h / 2, Math.sin(a) * r));
    const hY = h + 0.06;
    if (stage === 2) {
      g.add(mk(`${name}_tip_${i}`, new THREE.SphereGeometry(0.05, 8, 6), M.leafDeep, Math.cos(a) * r, hY, Math.sin(a) * r));
    } else if (stage === 3) {
      const bud = mk(`${name}_bud_${i}`, new THREE.SphereGeometry(0.07, 10, 8), M.leafDeep, Math.cos(a) * r, hY, Math.sin(a) * r);
      bud.scale.set(0.8, 1.3, 0.8); g.add(bud);
    } else if (kind === 'tulip') {
      const cup = mk(`${name}_bloom_${i}`, new THREE.SphereGeometry(stage === 5 ? 0.1 : 0.08, 12, 10), petal, Math.cos(a) * r, hY, Math.sin(a) * r);
      cup.scale.set(0.85, 1.25, 0.85); g.add(cup);
    } else {
      const pr = stage === 5 ? 0.055 : 0.04, ps = stage === 5 ? 0.075 : 0.058;
      for (let k = 0; k < 4; k++) {
        const pa = k * 1.571;
        const pt = mk(`${name}_bloom_${i}_${k}`, new THREE.SphereGeometry(ps, 10, 8), petal,
          Math.cos(a) * r + Math.cos(pa) * pr, hY, Math.sin(a) * r + Math.sin(pa) * pr);
        pt.scale.set(1, 0.7, 1); g.add(pt);
      }
      g.add(mk(`${name}_bloom_${i}_core`, new THREE.SphereGeometry(0.055, 10, 8), petal, Math.cos(a) * r, hY + 0.04, Math.sin(a) * r));
    }
  }
  for (let i = 0; i < 5; i++)
    leafBlade(`leaf_${i}`, Math.cos(i * 1.257) * 0.17, 0.1 + (i % 2) * 0.1, Math.sin(i * 1.257) * 0.17, 0.7 * sc, -i * 1.257);
  return g;
}

function pineTree(name, x, y, s = 1) {
  const g = group(name, wx(x), topY(x, y), wz(y));
  g.scale.setScalar(s);
  g.add(mk(`${name}_trunk`, new THREE.CylinderGeometry(0.09, 0.13, 0.5, 10), M.woodDark, 0, 0.25, 0));
  [[0.55, 0.62, 0.52], [0.44, 0.55, 0.97], [0.3, 0.46, 1.34]].forEach(([r, h, yy], i) =>
    g.add(mk(`${name}_canopy_${i}`, new THREE.ConeGeometry(r, h, 10), M.pine, 0, yy, 0)));
  return g;
}
function blossomTree(name, x, y) {
  const g = group(name, wx(x), topY(x, y), wz(y));
  g.add(mk(`${name}_trunk`, new THREE.CylinderGeometry(0.09, 0.15, 1.15, 10), M.woodDark, 0, 0.57, 0));
  [0.34, -0.3].forEach((bx, i) => {
    const br = mk(`${name}_branch_${i}`, new THREE.CylinderGeometry(0.04, 0.055, 0.5, 6), M.woodDark, bx * 0.5, 1.05 + i * 0.2, 0);
    br.rotation.z = bx > 0 ? -0.9 : 0.9; g.add(br);
  });
  [[0, 1.6, 0, 0.4], [0.4, 1.42, 0.14, 0.28], [-0.38, 1.5, -0.1, 0.26], [0.12, 1.85, -0.14, 0.24]].forEach(([cx, cy, cz, r], i) => {
    const c = mk(`${name}_canopy_${i}`, new THREE.IcosahedronGeometry(r, 1), i % 2 ? M.leaf : M.leafLight, cx, cy, cz);
    c.rotation.set(i, i * 0.8, 0); g.add(c);
    g.add(mk(`${name}_blossom_${i}`, new THREE.SphereGeometry(0.07, 10, 8), M.pink, cx + r * 0.7, cy + r * 0.4, cz + r * 0.4));
  });
  return g;
}

export const HABITS = [
  [2, 2, 'lavender', 'Meditation'], [4, 2, 'rose', 'Sleep 8h'], [6, 2, 'bush', 'Steps'], [8, 2, 'tulip', 'Water'],
  [1, 4, 'bush', 'Stretching'], [1, 5, 'herb', 'Journaling'], [2, 8, 'rose', 'Reading'], [3, 7, 'lavender', 'Breathwork'],
  [7, 8, 'bush', 'Strength'], [7, 5, 'tulip', 'No screens'], [7, 3, 'lavender', 'Sunlight'], [9, 1, 'herb', 'Cooking'],
];
const DEFAULT_STAGES = [5, 5, 4, 3, 4, 5, 4, 5, 3, 4, 4, 2];

// Grass spots for pots beyond the built-in 12 — habits used to simply vanish
// once every default pot was taken.
const EXTRA_SPOTS = [
  [3, 0], [5, 0], [7, 0], [0, 2], [9, 2], [4, 8], [6, 7], [2, 9], [7, 9], [1, 3], [8, 0], [0, 5],
];

/** Flora layer: habit pots, planter boxes, trees. Growth is re-buildable per pot. */
export function buildFlora() {
  const root = group('flora');
  const plantings = [];
  const canopies = [];

  const makePlanting = (i, x, y, kind, label) => {
    const g = group(`habit_${i}_${kind}`, wx(x) + (i % 2 ? 0.1 : -0.08), topY(x, y), wz(y) + (i % 3 ? -0.05 : 0.12));
    g.add(pot(`habit_${i}_pot`, 0.24 + (i % 3) * 0.03, 0.3, i % 4 === 0 ? M.stoneWarm : M.terracotta));
    const rec = { index: i, kind, label, stage: DEFAULT_STAGES[i] ?? 3, petal: null, wilted: false, holder: g, mesh: null };
    rec.set = (s, k = rec.kind, petal = rec.petal, wilted = rec.wilted) => {
      if (rec.mesh) { g.remove(rec.mesh); rec.mesh.traverse(o => o.geometry && o.geometry.dispose()); }
      rec.stage = Math.max(0, Math.min(5, s));
      rec.kind = k;
      rec.petal = petal;
      rec.wilted = wilted;
      const pl = plant(`habit_${i}_plant`, rec.kind, rec.stage, rec.petal, rec.wilted);
      pl.position.y = 0.32; pl.rotation.y = i * 0.8;
      pl.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(pl); rec.mesh = pl;
    };
    rec.set(rec.stage);
    plantings.push(rec);
    root.add(g);
    return rec;
  };

  HABITS.forEach(([x, y, kind, label], i) => makePlanting(i, x, y, kind, label));

  // Grow the pot pool to fit n habits; returns the newly created records so
  // the scene can wire them up for clicks, shadows and sway.
  const ensureCapacity = n => {
    const added = [];
    while (plantings.length < Math.min(n, HABITS.length + EXTRA_SPOTS.length)) {
      const i = plantings.length;
      const [x, y] = EXTRA_SPOTS[i - HABITS.length];
      added.push(makePlanting(i, x, y, ['bush', 'herb', 'tulip', 'rose', 'lavender'][i % 5], `Habit ${i + 1}`));
    }
    return added;
  };

  [[2, 3], [2, 5], [7, 6]].forEach(([x, y], i) => {
    const g = group(`planter_box_${i}`, wx(x), topY(x, y), wz(y));
    g.add(mk(`planter_box_${i}_body`, new THREE.BoxGeometry(0.9, 0.3, 0.9), M.terracotta, 0, 0.15, 0));
    g.add(mk(`planter_box_${i}_soil`, new THREE.BoxGeometry(0.78, 0.06, 0.78), M.soil, 0, 0.31, 0));
    const a = plant(`planter_box_${i}_plant_a`, i % 2 ? 'herb' : 'bush', 4); a.position.set(-0.16, 0.32, 0.1); g.add(a);
    const b = plant(`planter_box_${i}_plant_b`, i % 2 ? 'rose' : 'lavender', 4); b.position.set(0.18, 0.32, -0.12); b.scale.setScalar(0.85); g.add(b);
    root.add(g);
  });

  [blossomTree('tree_blossom', 0, 1), pineTree('tree_pine_a', 10, 0, 1),
   pineTree('tree_pine_b', 9, 0, 0.72), pineTree('tree_pine_c', 5, 0, 0.85)]
    .forEach(t => { root.add(t); t.children.forEach(c => { if (/canopy|blossom/.test(c.name)) canopies.push(c); }); });

  return { root, plantings, canopies, ensureCapacity };
}
