// Built structures and props: pergola, potting bench, shelf, balustrade, gnome, lights.
import { THREE, M, wx, wz, topY, lift, mk, group } from './core.js';
import { pot, plant } from './flora.js';

export function buildDecor() {
  const root = group('decor');
  const add = o => (root.add(o), o);
  const lamps = [];

  /* pergola dome */
  const pg = group('pergola', wx(8.5), topY(8, 1), wz(1.4));
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    pg.add(mk(`pergola_post_${i}`, new THREE.CylinderGeometry(0.07, 0.08, 1.55, 8), M.wood, Math.cos(a) * 0.85, 0.775, Math.sin(a) * 0.85));
    const arc = mk(`pergola_arc_${i}`, new THREE.TorusGeometry(0.85, 0.055, 8, 26, Math.PI), M.wood, 0, 1.55, 0);
    arc.rotation.set(0, i * Math.PI / 4 + Math.PI / 4, 0); pg.add(arc);
  }
  const pRing = mk('pergola_ring', new THREE.TorusGeometry(0.68, 0.045, 8, 28), M.wood, 0, 1.2, 0);
  pRing.rotation.x = Math.PI / 2; pg.add(pRing);
  pg.add(mk('pergola_finial', new THREE.SphereGeometry(0.11, 12, 10), M.wood, 0, 1.66, 0));
  for (let i = 0; i < 6; i++) {
    const a = i * 1.047;
    const v = mk(`pergola_vine_${i}`, new THREE.IcosahedronGeometry(0.2, 1), i % 2 ? M.leaf : M.leafDeep, Math.cos(a) * 0.78, 1.38 - (i % 3) * 0.2, Math.sin(a) * 0.78);
    v.scale.set(1, 0.75, 1); pg.add(v);
    pg.add(mk(`pergola_lantern_cord_${i}`, new THREE.CylinderGeometry(0.012, 0.012, 0.3, 5), M.iron, Math.cos(a) * 0.6, 1.15 - (i % 3) * 0.09, Math.sin(a) * 0.6));
    lamps.push(pg.add(mk(`pergola_lantern_${i}`, new THREE.SphereGeometry(0.09, 12, 10), M.glow, Math.cos(a) * 0.6, 0.96 - (i % 3) * 0.09, Math.sin(a) * 0.6)) || pg.children[pg.children.length - 1]);
  }
  pg.add(mk('pergola_hanger_cord', new THREE.CylinderGeometry(0.012, 0.012, 0.5, 5), M.iron, 0, 0.95, 0));
  const hangPot = pot('pergola_hanging_pot', 0.22, 0.24, M.stoneWarm); hangPot.position.y = 0.58; pg.add(hangPot);
  const hangPlant = plant('pergola_hanging_plant', 'bush', 4); hangPlant.position.y = 0.82; hangPlant.scale.setScalar(0.8); pg.add(hangPlant);
  add(pg);

  /* potting bench + props */
  const bench = group('potting_bench', wx(9), 0.08, wz(4.6));
  bench.add(mk('bench_top', new THREE.BoxGeometry(0.85, 0.09, 2.1), M.wood, 0, 0.74, 0));
  bench.add(mk('bench_shelf', new THREE.BoxGeometry(0.72, 0.06, 1.9), M.woodDark, 0, 0.34, 0));
  [[-0.32, -0.9], [0.32, -0.9], [-0.32, 0.9], [0.32, 0.9]].forEach(([bx, bz], i) =>
    bench.add(mk(`bench_leg_${i}`, new THREE.BoxGeometry(0.1, 0.74, 0.1), M.woodDark, bx, 0.37, bz)));
  bench.add(mk('bench_backboard', new THREE.BoxGeometry(0.07, 0.55, 2.0), M.woodDark, -0.39, 1.06, 0));
  add(bench);

  const can = group('watering_can', wx(9), 0.87, wz(4.1));
  can.add(mk('can_body', new THREE.CylinderGeometry(0.19, 0.21, 0.28, 16), M.jade, 0, 0.14, 0));
  can.add(mk('can_top', new THREE.CylinderGeometry(0.13, 0.19, 0.07, 16), M.jade, 0, 0.31, 0));
  const spout = mk('can_spout', new THREE.CylinderGeometry(0.035, 0.06, 0.42, 8), M.jade, 0.25, 0.24, 0);
  spout.rotation.z = -1.0; can.add(spout);
  can.add(mk('can_rose', new THREE.CylinderGeometry(0.07, 0.05, 0.05, 10), M.jade, 0.4, 0.36, 0));
  const cHandle = mk('can_handle', new THREE.TorusGeometry(0.12, 0.025, 8, 16, Math.PI), M.jade, -0.1, 0.32, 0);
  cHandle.rotation.set(0, Math.PI / 2, -0.5); can.add(cHandle);
  add(can);

  const crock = group('crock_jar', wx(8.6), 0.83, wz(5.4));
  crock.add(mk('crock_body', new THREE.SphereGeometry(0.2, 16, 14), M.jade, 0, 0.19, 0));
  crock.add(mk('crock_neck', new THREE.CylinderGeometry(0.1, 0.13, 0.1, 12), M.jade, 0, 0.34, 0));
  crock.add(mk('crock_lid', new THREE.CylinderGeometry(0.12, 0.12, 0.05, 12), M.woodDark, 0, 0.41, 0));
  add(crock);

  const candle = group('candle_jar', wx(9.35), 0.83, wz(3.6));
  lamps.push(candle.add(mk('candle_glass', new THREE.CylinderGeometry(0.11, 0.11, 0.2, 14), M.glow, 0, 0.1, 0)) && candle.children[0]);
  candle.add(mk('candle_flame', new THREE.ConeGeometry(0.045, 0.11, 8), M.yellow, 0, 0.25, 0));
  add(candle);

  const benchPot = pot('bench_pot', 0.2, 0.24); benchPot.position.set(wx(8.75), 0.83, wz(3.5));
  const benchPlant = plant('bench_plant', 'herb', 4); benchPlant.position.y = 0.26; benchPlant.scale.setScalar(0.85); benchPot.add(benchPlant);
  add(benchPot);
  const s0 = pot('stacked_pot_a', 0.19, 0.22); s0.position.set(wx(9.1), 0.42, wz(5.3)); add(s0);
  const s1 = pot('stacked_pot_b', 0.16, 0.19); s1.position.set(wx(9.1), 0.62, wz(5.3)); add(s1);

  const stool = group('stool', wx(8.2), 0.08, wz(6.2));
  stool.add(mk('stool_seat', new THREE.CylinderGeometry(0.24, 0.24, 0.08, 14), M.wood, 0, 0.42, 0));
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094;
    const l = mk(`stool_leg_${i}`, new THREE.CylinderGeometry(0.03, 0.04, 0.42, 6), M.woodDark, Math.cos(a) * 0.16, 0.21, Math.sin(a) * 0.16);
    l.rotation.set(Math.sin(a) * 0.14, 0, -Math.cos(a) * 0.14); stool.add(l);
  }
  add(stool);

  const cushion = group('cushion', wx(8.4), 0.09, wz(7.4));
  cushion.add(mk('cushion_stone', new THREE.BoxGeometry(1.0, 0.16, 0.75), M.stoneDark, 0, 0.08, 0));
  cushion.add(mk('cushion_pad', new THREE.BoxGeometry(0.9, 0.2, 0.66), M.yellow, 0, 0.26, 0));
  add(cushion);

  const basket = group('basket', wx(6), topY(6, 7), wz(7));
  basket.add(mk('basket_body', new THREE.CylinderGeometry(0.25, 0.19, 0.28, 14), M.wood, 0, 0.14, 0));
  const bRim = mk('basket_rim', new THREE.TorusGeometry(0.25, 0.03, 8, 18), M.woodDark, 0, 0.28, 0); bRim.rotation.x = Math.PI / 2; basket.add(bRim);
  const bH = mk('basket_handle', new THREE.TorusGeometry(0.23, 0.022, 8, 16, Math.PI), M.woodDark, 0, 0.28, 0); bH.rotation.y = Math.PI / 2; basket.add(bH);
  add(basket);

  /* plant shelf */
  const shelf = group('plant_shelf', wx(2.4), topY(2, 1), wz(1));
  [0.46, 0.92, 1.36].forEach((sy, i) => shelf.add(mk(`shelf_board_${i}`, new THREE.BoxGeometry(1.5, 0.07, 0.5), M.wood, 0, sy, 0)));
  [[-0.68, -0.19], [0.68, -0.19], [-0.68, 0.19], [0.68, 0.19]].forEach(([sx, sz], i) =>
    shelf.add(mk(`shelf_leg_${i}`, new THREE.BoxGeometry(0.09, 1.4, 0.09), M.woodDark, sx, 0.7, sz)));
  [[-0.45, 0.49, 'herb'], [0.42, 0.49, 'bush'], [-0.2, 0.95, 'rose'], [0.5, 0.95, 'herb'], [0, 1.39, 'bush']].forEach(([sx, sy, kind], i) => {
    const p = pot(`shelf_pot_${i}`, 0.17, 0.2, i % 2 ? M.stoneWarm : M.terracotta);
    p.position.set(sx, sy, i % 2 ? 0.05 : -0.04);
    const pl = plant(`shelf_plant_${i}`, kind, 3); pl.position.y = 0.22; pl.scale.setScalar(0.8); p.add(pl);
    shelf.add(p);
  });
  add(shelf);

  /* stone balustrade */
  const bal = group('balustrade', wx(3.4), 0.03, wz(6.2));
  bal.add(mk('balustrade_rail', new THREE.BoxGeometry(3.2, 0.12, 0.2), M.stone, 0, 0.68, 0));
  bal.add(mk('balustrade_base', new THREE.BoxGeometry(3.2, 0.1, 0.26), M.stoneWarm, 0, 0.05, 0));
  for (let i = 0; i < 7; i++)
    bal.add(mk(`baluster_${i}`, new THREE.CylinderGeometry(0.06, 0.085, 0.58, 10), M.stone, -1.35 + i * 0.45, 0.33, 0));
  [-1.45, 1.45].forEach((px, i) => {
    bal.add(mk(`balustrade_pillar_${i}`, new THREE.BoxGeometry(0.3, 0.85, 0.3), M.stone, px, 0.42, 0));
    bal.add(mk(`balustrade_pillar_cap_${i}`, new THREE.BoxGeometry(0.38, 0.09, 0.38), M.stoneWarm, px, 0.89, 0));
  });
  add(bal);

  /* gnome */
  const gnome = group('gnome', wx(4), topY(4, 7), wz(7.2));
  gnome.add(mk('gnome_body', new THREE.ConeGeometry(0.2, 0.34, 12), M.jade, 0, 0.17, 0));
  gnome.add(mk('gnome_head', new THREE.SphereGeometry(0.14, 14, 12), M.cream, 0, 0.42, 0));
  gnome.add(mk('gnome_beard', new THREE.ConeGeometry(0.12, 0.22, 10), M.cream, 0, 0.32, 0.06));
  gnome.add(mk('gnome_hat', new THREE.ConeGeometry(0.16, 0.36, 12), M.red, 0, 0.66, 0));
  [-0.06, 0.06].forEach((ex, i) => gnome.add(mk(`gnome_eye_${i}`, new THREE.SphereGeometry(0.022, 8, 6), M.iron, ex, 0.46, 0.12)));
  add(gnome);

  /* lanterns */
  const lantern = (name, x, y, z, s = 1) => {
    const g = group(name, x, y, z); g.scale.setScalar(s);
    g.add(mk(`${name}_post`, new THREE.CylinderGeometry(0.035, 0.045, 0.5, 8), M.iron, 0, 0.25, 0));
    const body = mk(`${name}_body`, new THREE.BoxGeometry(0.2, 0.26, 0.2), M.glow, 0, 0.63, 0);
    g.add(body); lamps.push(body);
    g.add(mk(`${name}_cap`, new THREE.ConeGeometry(0.17, 0.14, 4), M.iron, 0, 0.83, 0));
    g.add(mk(`${name}_foot`, new THREE.CylinderGeometry(0.11, 0.13, 0.05, 8), M.iron, 0, 0.025, 0));
    return add(g);
  };
  lantern('lantern_plaza_a', wx(3) + 0.35, lift(3, 6) + 0.02, wz(6) - 0.15, 1);
  lantern('lantern_plaza_b', wx(7) - 0.3, lift(7, 4) + 0.02, wz(4), 0.9);
  lantern('lantern_path', wx(1) + 0.2, lift(1, 3) + 0.02, wz(3) + 0.2, 0.85);

  /* string lights */
  const lights = group('string_lights');
  const poles = [[wx(2.4), 2.3, wz(0.6)], [wx(5.5), 2.5, wz(0.4)], [wx(8.4), 2.4, wz(0.9)]];
  poles.forEach(([px, py, pz], i) => lights.add(mk(`light_pole_${i}`, new THREE.CylinderGeometry(0.05, 0.06, py, 8), M.woodDark, px, py / 2, pz)));
  for (let s = 0; s < 2; s++) {
    const [x0, , z0] = poles[s], [x1, , z1] = poles[s + 1];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6, sag = Math.sin(t * Math.PI) * 0.3;
      const b = mk(`string_bulb_${s}_${i}`, new THREE.SphereGeometry(0.07, 10, 8), M.glow, x0 + (x1 - x0) * t, 2.35 - sag, z0 + (z1 - z0) * t);
      lights.add(b); lamps.push(b);
    }
  }
  add(lights);

  [[7.4, 5.5], [7.5, 6.4], [8.0, 7.1]].forEach(([sx, sz], i) => {
    const s = mk(`stepping_stone_${i}`, new THREE.CylinderGeometry(0.3, 0.28, 0.1, 8), M.stone, wx(sx), lift(Math.round(sx), Math.round(sz)) + 0.05, wz(sz));
    s.rotation.y = i * 0.7; add(s);
  });

  return { root, lamps: lamps.filter(Boolean) };
}
