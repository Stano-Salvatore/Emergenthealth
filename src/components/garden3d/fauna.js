// Animals: butterflies, bees, a robin, a cat, koi in the pond. All animate via update(t).
import { THREE, M, wx, wz, mk, group } from './core.js';

function butterfly(name, m) {
  const g = group(name);
  g.add(mk(`${name}_body`, new THREE.CapsuleGeometry(0.022, 0.09, 4, 6), M.iron, 0, 0, 0)).rotation.x = Math.PI / 2;
  const wings = [];
  [-1, 1].forEach(s => {
    const pivot = group(`${name}_wing_pivot_${s > 0 ? 'r' : 'l'}`);
    const w = mk(`${name}_wing_${s > 0 ? 'r' : 'l'}`, new THREE.SphereGeometry(0.09, 10, 8), m, s * 0.09, 0, 0);
    w.scale.set(1, 0.12, 0.75);
    pivot.add(w); g.add(pivot); wings.push({ pivot, s });
  });
  return { g, wings };
}

function bird(name) {
  const g = group(name);
  g.add(mk(`${name}_body`, new THREE.SphereGeometry(0.11, 14, 12), M.feather, 0, 0, 0)).scale.set(1.35, 1, 1);
  g.add(mk(`${name}_head`, new THREE.SphereGeometry(0.07, 12, 10), M.feather, 0.13, 0.07, 0));
  g.add(mk(`${name}_breast`, new THREE.SphereGeometry(0.07, 12, 10), M.red, 0.08, -0.02, 0.05));
  g.add(mk(`${name}_beak`, new THREE.ConeGeometry(0.025, 0.07, 6), M.yellow, 0.21, 0.06, 0)).rotation.z = -Math.PI / 2;
  const tail = mk(`${name}_tail`, new THREE.ConeGeometry(0.06, 0.16, 6), M.feather, -0.16, 0.01, 0);
  tail.rotation.z = Math.PI / 2; g.add(tail);
  const wings = [];
  [-1, 1].forEach(s => {
    const pivot = group(`${name}_wing_pivot_${s > 0 ? 'r' : 'l'}`);
    const w = mk(`${name}_wing_${s > 0 ? 'r' : 'l'}`, new THREE.SphereGeometry(0.1, 10, 8), M.feather, 0, 0, s * 0.09);
    w.scale.set(0.9, 0.16, 1); pivot.add(w); g.add(pivot); wings.push({ pivot, s });
  });
  return { g, wings };
}

function cat(name) {
  const g = group(name);
  g.add(mk(`${name}_body`, new THREE.CapsuleGeometry(0.13, 0.24, 6, 12), M.fur, 0, 0.16, 0)).rotation.z = Math.PI / 2;
  g.add(mk(`${name}_head`, new THREE.SphereGeometry(0.1, 14, 12), M.fur, 0.22, 0.24, 0));
  [-1, 1].forEach(s => {
    const e = mk(`${name}_ear_${s > 0 ? 'r' : 'l'}`, new THREE.ConeGeometry(0.045, 0.09, 6), M.furDark, 0.21, 0.34, s * 0.05);
    g.add(e);
    g.add(mk(`${name}_eye_${s > 0 ? 'r' : 'l'}`, new THREE.SphereGeometry(0.016, 8, 6), M.iron, 0.3, 0.25, s * 0.045));
  });
  for (let i = 0; i < 4; i++) {
    const px = i < 2 ? 0.13 : -0.13, pz = i % 2 ? 0.07 : -0.07;
    g.add(mk(`${name}_leg_${i}`, new THREE.CylinderGeometry(0.032, 0.032, 0.16, 6), M.furDark, px, 0.08, pz));
  }
  const tail = group(`${name}_tail_pivot`, -0.2, 0.2, 0);
  const t = mk(`${name}_tail`, new THREE.CapsuleGeometry(0.028, 0.26, 4, 8), M.furDark, -0.06, 0.1, 0);
  t.rotation.z = 0.7; tail.add(t); g.add(tail);
  return { g, tail };
}

function koi(name) {
  const g = group(name);
  g.add(mk(`${name}_body`, new THREE.SphereGeometry(0.1, 12, 10), M.koi, 0, 0, 0)).scale.set(1.6, 0.55, 0.8);
  const tail = mk(`${name}_tail`, new THREE.ConeGeometry(0.07, 0.13, 6), M.koi, -0.17, 0, 0);
  tail.rotation.z = Math.PI / 2; g.add(tail);
  g.add(mk(`${name}_fin`, new THREE.SphereGeometry(0.05, 8, 6), M.cream, 0.02, 0.04, 0)).scale.set(1, 0.3, 1.4);
  return { g, tail };
}

export function buildFauna() {
  const root = group('fauna');
  const anims = [];

  /* ── food bowl + daily feeding ritual ──────────────────────────────────── */
  const FEED_DUR = 8;                        // seconds the critters gather for
  let feedStart = -1, pendingFeed = false;
  const bowl = group('feed_bowl', wx(6.3), 0.06, wz(7.1));
  bowl.add(mk('feed_bowl_body', new THREE.CylinderGeometry(0.2, 0.14, 0.11, 14), M.terracotta, 0, 0.055, 0));
  const bowlRim = mk('feed_bowl_rim', new THREE.TorusGeometry(0.19, 0.028, 8, 18), M.woodDark, 0, 0.11, 0);
  bowlRim.rotation.x = Math.PI / 2;
  bowl.add(bowlRim);
  const kibble = group('feed_bowl_kibble');
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9, r = 0.02 + (i % 3) * 0.045;
    kibble.add(mk(`feed_kibble_${i}`, new THREE.SphereGeometry(0.03, 6, 5), M.wood, Math.cos(a) * r, 0.1, Math.sin(a) * r));
  }
  kibble.visible = false;                    // appears once today's feeding happened
  bowl.add(kibble);
  root.add(bowl);

  // little hearts floating up from the bowl while everyone eats
  const HEARTS = 8;
  const heartPos = new Float32Array(HEARTS * 3);
  const heartGeo = new THREE.BufferGeometry();
  heartGeo.setAttribute('position', new THREE.BufferAttribute(heartPos, 3));
  const hearts = new THREE.Points(heartGeo, new THREE.PointsMaterial({
    color: 0xef7fa0, size: 0.09, transparent: true, opacity: 0, depthWrite: false,
  }));
  hearts.name = 'feed_hearts';
  hearts.position.copy(bowl.position);
  root.add(hearts);

  const ease = x => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  // 0 at rest → 1 while gathered at the bowl (with walk-in / walk-out ramps)
  const feedPhase = t => {
    if (feedStart < 0) return 0;
    const el = t - feedStart;
    if (el >= FEED_DUR) return 0;
    return ease(el < 1.6 ? el / 1.6 : el > FEED_DUR - 1.6 ? (FEED_DUR - el) / 1.6 : 1);
  };
  anims.push(t => {
    if (pendingFeed) { pendingFeed = false; feedStart = t; kibble.visible = true; }
    const p = feedPhase(t);
    hearts.position.copy(bowl.position);   // the bowl can be moved in move mode
    hearts.material.opacity = p * 0.9;
    if (p > 0) {
      for (let i = 0; i < HEARTS; i++) {
        const cyc = (t * 0.45 + i / HEARTS) % 1;
        heartPos[i * 3] = Math.cos(i * 2.4) * 0.22;
        heartPos[i * 3 + 1] = 0.25 + cyc * 0.75;
        heartPos[i * 3 + 2] = Math.sin(i * 2.4) * 0.22;
      }
      heartGeo.attributes.position.needsUpdate = true;
    }
  });

  const flutter = [
    { name: 'butterfly_a', m: M.wing, cx: wx(4.5), cz: wz(4.5), r: 2.4, h: 0.95, sp: 0.32 },
    { name: 'butterfly_b', m: M.yellow, cx: wx(2.5), cz: wz(4), r: 1.5, h: 0.75, sp: -0.44 },
    { name: 'butterfly_c', m: M.lavender, cx: wx(7), cz: wz(6.5), r: 1.8, h: 1.1, sp: 0.27 },
  ].map(cfg => ({ ...cfg, ...butterfly(cfg.name, cfg.m) }));
  flutter.forEach(b => { root.add(b.g); });
  anims.push(t => flutter.forEach((b, i) => {
    const a = t * b.sp + i * 2;
    b.g.position.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(t * 1.7 + i) * 0.22, b.cz + Math.sin(a * 1.3) * b.r);
    b.g.rotation.y = -a * (b.sp > 0 ? 1 : -1) + Math.PI / 2;
    b.wings.forEach(w => (w.pivot.rotation.z = w.s * (0.5 + Math.sin(t * 13 + i) * 0.7)));
  }));

  const bees = [0, 1, 2].map(i => {
    const b = butterfly(`bee_${i}`, M.yellow);
    b.g.scale.setScalar(0.45);
    root.add(b.g); return b;
  });
  const beeTargets = [[wx(2), wz(2)], [wx(6), wz(2)], [wx(3), wz(7)]];
  anims.push(t => bees.forEach((b, i) => {
    const a = t * 0.9 + i * 2.1, [bx, bz] = beeTargets[i];
    b.g.position.set(bx + Math.cos(a) * 0.55, 0.62 + Math.sin(a * 2.3) * 0.14, bz + Math.sin(a) * 0.55);
    b.g.rotation.y = -a + Math.PI / 2;
    b.wings.forEach(w => (w.pivot.rotation.z = w.s * (0.4 + Math.sin(t * 30 + i) * 0.8)));
  }));

  const robin = bird('robin');
  root.add(robin.g);
  anims.push(t => {
    const fp = feedPhase(t);
    if (fp > 0.02) {
      // hop over to the bowl and peck at the kibble
      const perch = { x: wx(3.4) - 1.2, y: 0.75, z: wz(6.2) };
      const spot = { x: bowl.position.x - 0.32, y: 0.1 + Math.abs(Math.sin(t * 7)) * 0.05 * fp, z: bowl.position.z + 0.22 };
      robin.g.position.set(
        perch.x + (spot.x - perch.x) * fp,
        perch.y + (spot.y - perch.y) * fp,
        perch.z + (spot.z - perch.z) * fp,
      );
      robin.g.rotation.y = 0.6 + fp * 0.5;
      robin.wings.forEach(w => (w.pivot.rotation.x = w.s * (0.1 + (1 - fp) * Math.sin(t * 11) * 0.5)));
      return;
    }
    const cyc = (t * 0.16) % 1;                       // perch → fly → perch
    const flying = cyc > 0.55;
    if (!flying) {
      robin.g.position.set(wx(3.4) - 1.2, 0.75, wz(6.2));
      robin.g.rotation.y = 0.6;
      robin.wings.forEach(w => (w.pivot.rotation.x = w.s * 0.1));
      robin.g.position.y += Math.sin(t * 3) * 0.008;
    } else {
      const p = (cyc - 0.55) / 0.45, a = p * Math.PI * 2;
      robin.g.position.set(Math.cos(a) * 3.2, 1.6 + Math.sin(p * Math.PI) * 0.9, Math.sin(a) * 3.2);
      robin.g.rotation.y = -a;
      robin.wings.forEach(w => (w.pivot.rotation.x = w.s * (0.2 + Math.sin(t * 11) * 0.9)));
    }
  });

  const kitty = cat('cat');
  const catHome = { x: wx(8.4), z: wz(7.4), rot: -2.2 };
  kitty.g.position.set(catHome.x, 0.28, catHome.z);
  kitty.g.rotation.y = catHome.rot;
  root.add(kitty.g);
  anims.push(t => {
    const fp = feedPhase(t);
    // derived each frame — the bowl can be moved in move mode
    const catSpot = { x: bowl.position.x + 0.42, z: bowl.position.z + 0.18, rot: -2.6 };
    kitty.g.position.x = catHome.x + (catSpot.x - catHome.x) * fp;
    kitty.g.position.z = catHome.z + (catSpot.z - catHome.z) * fp;
    kitty.g.rotation.y = catHome.rot + (catSpot.rot - catHome.rot) * fp;
    kitty.tail.rotation.x = Math.sin(t * (1.4 + fp * 2)) * (0.5 + fp * 0.2);
    kitty.tail.rotation.y = Math.sin(t * 0.9) * 0.3;
    // nibbling head-bob at the bowl, gentle breathing otherwise
    kitty.g.position.y = 0.28 + Math.sin(t * 1.1) * 0.012 - (fp >= 0.98 ? Math.abs(Math.sin(t * 5)) * 0.03 : 0);
  });

  const fish = [0, 1].map(i => {
    const k = koi(`koi_${i}`);
    root.add(k.g); return k;
  });
  anims.push(t => fish.forEach((k, i) => {
    const a = t * 0.5 + i * Math.PI;
    k.g.position.set(wx(5) + Math.cos(a) * 0.75, -0.26 + Math.sin(t * 2 + i) * 0.02, wz(8.7) + Math.sin(a) * 0.55);
    k.g.rotation.y = -a + Math.PI / 2;
    k.tail.rotation.y = Math.sin(t * 6 + i) * 0.6;
  }));

  return {
    root,
    bowl,
    update: t => anims.forEach(f => f(t)),
    feed: () => { pendingFeed = true; },
    setKibble: v => { kibble.visible = v; },
  };
}
