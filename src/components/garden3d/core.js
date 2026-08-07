// Shared palette, grid definition and mesh helpers for the Habit Garden.
import * as THREE from 'three';

export const M = {};
const mat = (name, color, rough = 0.9, metal = 0) =>
  (M[name] = Object.assign(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), { name }));

mat('grass', 0x6ea63f, 0.95);
mat('grassAlt', 0x81b94a, 0.95);
mat('grassDeep', 0x578c34, 0.95);
mat('soil', 0x5b3a22, 1.0);
mat('soilDark', 0x3d2616, 1.0);
mat('stone', 0xd7ccb8, 0.85);
mat('stoneWarm', 0xc3b49b, 0.9);
mat('stoneDark', 0x9d8e77, 0.9);
mat('water', 0x4fa8c4, 0.2);
mat('wood', 0xa9723f, 0.85);
mat('woodDark', 0x6e4a28, 0.9);
mat('terracotta', 0xc06744, 0.85);
mat('leaf', 0x4c8a37, 0.9);
mat('leafLight', 0x74ae4b, 0.9);
mat('leafDeep', 0x36692e, 0.92);
mat('pine', 0x3a6a38, 0.95);
mat('brass', 0xcaa04c, 0.45, 0.25);
mat('cream', 0xf2e7cd, 0.85);
mat('pink', 0xd4536f, 0.8);
mat('lavender', 0x9a7bc8, 0.8);
mat('yellow', 0xe8c455, 0.8);
mat('red', 0xb63a33, 0.85);
mat('glow', 0xffdb92, 0.35);
mat('jade', 0x628f6d, 0.7);
mat('iron', 0x3b3833, 0.55, 0.2);
mat('snow', 0xf2f4f6, 0.8);
mat('fur', 0xd8a05a, 0.85);
mat('furDark', 0x8a5a2c, 0.85);
mat('wing', 0xe98fb0, 0.6);
mat('feather', 0x5c7fb5, 0.8);
mat('koi', 0xe2743c, 0.55);
mat('wiltStem', 0x8a6a44, 0.95);
mat('wiltLeaf', 0x7a7d5a, 0.95);
mat('wiltPetal', 0xb08a8a, 0.9);

export const COLS = 11, ROWS = 11;
export const G = Array.from({ length: ROWS }, () => Array(COLS).fill('grass'));
for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) G[y][x] = 'stone';
for (let y = 3; y <= 7; y++) for (let x = 8; x <= 9; x++) G[y][x] = 'wood';
G[8][8] = G[8][9] = G[9][8] = 'wood';
[[0, 6], [1, 6], [0, 7], [1, 7], [2, 7]].forEach(([x, y]) => (G[y][x] = 'water'));
[[4, 9], [5, 9], [6, 9], [5, 8]].forEach(([x, y]) => (G[y][x] = 'water'));

export const wx = c => c - (COLS - 1) / 2;
export const wz = r => r - (ROWS - 1) / 2;
export const lift = (x, y) =>
  G[y][x] !== 'grass' ? 0 : (y <= 2 || x <= 1 ? 0.3 : 0) + ((x * 7 + y * 5) % 3) * 0.03;
export const topY = (x, y) => (G[y][x] === 'water' ? -0.22 : lift(x, y));
export const hash = i => Math.abs((Math.sin(i * 127.1) * 43758.5453) % 1);

export const mk = (name, geo, m, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(geo, m);
  o.name = name;
  o.position.set(x, y, z);
  return o;
};
export const group = (name, x = 0, y = 0, z = 0) => {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
};
export { THREE };
