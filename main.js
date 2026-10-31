import * as THREE from 'three';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';
import { makeAnimator } from './animation.js';
import { sfx, music, unlock as unlockEngine, blip, isMuted, setMuted, setRumble, status as audioStatus } from './audio.js';
import { makeMaterials, tileUV, WUMPA_URL } from './textures.js';

// ---------- tuning ----------
const SPEED = 8, GRAVITY = 32, JUMP_V = 12.5, SPIN_TIME = 0.5, SPIN_COOLDOWN = 0.2;
const COYOTE = 0.1, JUMP_BUFFER = 0.12;
const HALF_W = 0.4, PLAYER_H = 1.8;
const MODEL_YAW = 0; // rotate model so its face points along -Z; adjust if it faces the wrong way
const MODEL_SCALE = 1.5; // visual size multiplier; collision box stays PLAYER_H tall
const START_LIVES = 3;
const INVINCIBLE_TIME = 8;
const LEVEL_END = -1150;   // z of the far end of the level; longer = more play time
const BOSS_HP = 5;                                   // Ripper Roo's lives (shown on the health bar)
const ARENA = { z: LEVEL_END - 200, w: 20, d: 26 };  // boss arena: front edge z, width, depth (the player enters at the front, Ripper Roo is at the far end)
const CHASE = { z0: 120, len: 700, R: 3.4 };           // level 2: a boulder chase that runs toward +z (toward the camera) from here
const ARENA2 = { z: 1100, w: 22, d: 26, back: 14 };    // Dr. Neo Cortex's lab: front edge z, width, depth (the player enters at the front, Cortex hovers at the far end)
const CORTEX_HP = 6;                                    // 3 hits on solid floor, then he pulls the lever (stage two), then 3 more over the pit
const WORLD_END = ARENA.z - ARENA.d - 60;            // scenery (floor, plants) extends this far

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
const DPR_MAX = Math.min(devicePixelRatio, 2);   // render at the screen's full resolution (up to 2x) for a clean HD look
let dpr = DPR_MAX;
renderer.setPixelRatio(dpr);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
renderer.domElement.addEventListener('webglcontextlost', e => e.preventDefault());   // lets the browser restore the context instead of leaving a black screen
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4f7a52);
scene.fog = new THREE.Fog(0x4f7a52, 22, 85);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 110);
function onResize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 250));   // iPad reports the new size a moment late
scene.add(new THREE.HemisphereLight(0xe6f2c8, 0x6a4a28, 1.1));
const sun = new THREE.DirectionalLight(0xffe2a8, 1.5);
sun.position.set(10, 20, 8); scene.add(sun);

const mat = c => new THREE.MeshLambertMaterial({ color: c });
const T = makeMaterials();
const M = { ...T, spike: mat(0xcfd8dc), step: T.grass, portal: new THREE.MeshBasicMaterial({ color: 0xb388ff, transparent: true, opacity: 0.7 }) };

// ---------- world state ----------
const solids = [];   // { mesh, min:Vector3, max:Vector3, vel?, crate? }
const crates = [], fruits = [], enemies = [], spikes = [], movers = [];
let finish;
const chase = { active: false, boulder: null, finish: null, endZ: 0, stun: 0, t: 0, startZ: 0 };
const cortex = { active: false, hp: CORTEX_HP, stage: 1, intro: 0, stun: 0, dead: 0, t: 0, act: null, idleT: 1, flash: 0, laugh: 0, recoil: 0, seq: null, seqPending: false,
  floorOpen: 0, wantOpen: false, padTimer: 7, sweep: 0, shootT: 1.5, rootX: 0, root: new THREE.Group(), platform: null, lever: null, floor: [], pads: [], blasts: [], model: null, anim: null, gun: null };
function makeRng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const LAYOUT = [];   // [kind, startZ, endZ] per generated section, handy for debugging

function addBox(x, y, z, w, h, d, material, extra = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (!extra.crate) tileUV(geo, w, h, d, extra.wall ? 2.5 : 2, !!extra.wall);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z); scene.add(mesh);
  const s = { mesh, min: new THREE.Vector3(), max: new THREE.Vector3(), half: new THREE.Vector3(w / 2, h / 2, d / 2), ...extra };
  syncBox(s); solids.push(s); return s;
}
function syncBox(s) {
  s.min.copy(s.mesh.position).sub(s.half); s.max.copy(s.mesh.position).add(s.half);
}
// stone tiki walls flanking a wide platform (z0 -> z1, half-width halfW)
function walls(z0, z1, halfW, h = 2.6) {
  const d = Math.abs(z1 - z0);
  for (const s of [-1, 1]) addBox(s * (halfW + 0.45), (h - 2) / 2, (z0 + z1) / 2, 0.9, h + 2, d, M.wall, { wall: true });
}
// smooth slope: surface goes from height yA at zA to yB at zB (zB < zA); collision follows the surface
function ramp(x, w, zA, yA, zB, yB) {
  const dz = zB - zA, dy = yB - yA, L = Math.hypot(dy, dz), phi = Math.atan2(dy, -dz), th = 2;
  const geo = new THREE.BoxGeometry(w, th, L); tileUV(geo, w, th, L);
  const mesh = new THREE.Mesh(geo, M.grass);
  mesh.rotation.x = phi;
  mesh.position.set(x, (yA + yB) / 2 - Math.cos(phi) * th / 2, (zA + zB) / 2 - Math.sin(phi) * th / 2);
  scene.add(mesh);
  const s = { mesh, min: new THREE.Vector3(x - w / 2, Math.min(yA, yB) - th, zB), max: new THREE.Vector3(x + w / 2, Math.max(yA, yB), zA), ramp: { zA, yA, zB, yB } };
  solids.push(s); return s;
}
function rampY(s, z) {
  const r = s.ramp, t = Math.min(1, Math.max(0, (z - r.zA) / (r.zB - r.zA)));
  return r.yA + t * (r.yB - r.yA);
}
function rampFruit(zA, yA, zB, yB, n) {
  for (let i = 0; i < n; i++) { const t = i / (n - 1); fruit(0, yA + (yB - yA) * t + 0.9, zA + (zB - zA) * t); }
}
// top surface of a platform at height `top`
function platform(x, z0, z1, w, top = 0, material = M.grass) {
  const d = Math.abs(z1 - z0), h = 2;
  return addBox(x, top - h / 2, (z0 + z1) / 2, w, h, d, material);
}
function crate(x, y, z, kind = 'normal', fruitCount = 0) {
  const material = { checkpoint: M.checkpoint, aku: M.akuCrate, life: M.lifeCrate, tnt: M.tntCrate.clone() }[kind] || M.crate;
  const s = addBox(x, y + 0.5, z, 1, 1, 1, material, { crate: true });
  s.kind = kind; s.fruitCount = kind === 'normal' ? 1 : fruitCount; crates.push(s);   // a normal crate holds exactly one Wumpa
  if (kind === 'tnt') s.armed = false;
}
function fruit(x, y, z) {
  const m = new THREE.Sprite(M.fruit); m.scale.set(0.95, 0.85, 1); m.userData.dynamic = true;   // bobs every frame
  m.position.set(x, y, z); scene.add(m); fruits.push({ mesh: m, got: false, baseY: y });
}
function fruitLine(x, y, z0, z1, n) {
  for (let i = 0; i < n; i++) fruit(x, y, z0 + (z1 - z0) * i / (n - 1));
}
function enemy(x, y, z, axis, range) {
  const g = new THREE.Sprite(M.enemy); g.scale.set(1.5, 1.25, 1); g.userData.dynamic = true;   // patrols every frame
  g.position.set(x, y + 0.45, z); scene.add(g);
  enemies.push({ mesh: g, origin: new THREE.Vector3(x, y + 0.45, z), axis, range, t: Math.random() * 6, alive: true });
}
function spike(x, y, z) {
  const g = new THREE.Group();
  for (const dx of [-0.3, 0, 0.3]) for (const dz of [-0.3, 0.3]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.7, 6), M.spike); c.position.set(dx, 0.35, dz); g.add(c);
  }
  g.position.set(x, y, z); scene.add(g); spikes.push({ pos: g.position, half: new THREE.Vector3(0.5, 0.6, 0.5) });
}

// boss arena: a walled stone courtyard far past the end of the level
// ---- level 2: the boulder-chase track (runs toward +z, so Crash runs at the camera) ----
function buildChase() {
  const rng = makeRng(31337), rr = (a, b) => a + rng() * (b - a), z0 = CHASE.z0;
  platform(0, z0 - 45, z0 + 14, 8); walls(z0 - 45, z0 + 14, 4, 3);           // start pad (the boulder waits behind you)
  let n = 0;
  const cp = zz => { if (n % 4 === 0) crate(0, 0, zz, 'checkpoint'); };
  const aku = (zz, p = 0.5) => { if (rng() < p) crate(rng() < 0.5 ? -2.6 : 2.6, 0, zz, 'aku'); };
  const life = zz => { if (rng() < 0.3) crate(0, 0, zz, 'life'); };
  const SEC = {
    straight(z) { const len = rr(36, 48); platform(0, z, z + len, 8); walls(z, z + len, 4, 2.8); cp(z + 2); crate(-2.6, 0, z + 10, 'normal'); crate(2.6, 0, z + 10, 'normal'); aku(z + 18); life(z + len - 6); fruitLine(0, 0.9, z + 4, z + len - 3, 8); return z + len; },
    hurdles(z) { const len = 40; platform(0, z, z + len, 8); walls(z, z + len, 4, 2.8); cp(z + 2); for (const d of [11, 19, 27]) { addBox(0, 0.5, z + d, 8, 1, 0.8, M.wall, { wall: true }); fruit(0, 2.6, z + d); } fruitLine(0, 0.9, z + 4, z + 8, 3); return z + len; },
    spikes(z) { const len = 38; platform(0, z, z + len, 9); walls(z, z + len, 4.5, 2.8); cp(z + 2); for (let k = 0; k < 3; k++) { const free = [-3, 0, 3][(rng() * 3) | 0], zz = z + 9 + k * 10; for (const x of [-3, 0, 3]) if (x !== free) spike(x, 0, zz); fruit(free, 1.1, zz); } return z + len; },
    gaps(z) { let zz = z; for (let k = 0; k < 3; k++) { platform(0, zz, zz + 12, 7); fruitLine(0, 0.9, zz + 2, zz + 10, 3); if (k < 2) fruit(0, 2.4, zz + 13.6); zz += 15.2; } return zz - 3.2; },
    bridge(z) { const len = 30; platform(0, z, z + len, 3, 0, M.dirt); cp(z + 2); for (const d of [9, 20]) { spike(0, 0, z + d); fruit(0, 2.4, z + d); } return z + len; },
    enemies(z) { const len = 36; platform(0, z, z + len, 9); walls(z, z + len, 4.5, 2.8); cp(z + 2); for (const d of [9, 18, 27]) enemy(0, 0, z + d, 'x', 3.5); fruitLine(0, 0.9, z + 3, z + len - 3, 7); return z + len; },
  };
  const order = Object.keys(SEC);
  let z = z0 + 17, prev = '';                                              // every section starts 3 past the previous one (a jumpable gap)
  while (z < z0 + CHASE.len) { n++; let k; do { k = order[(rng() * order.length) | 0]; } while (k === prev); prev = k; z = SEC[k](z) + 3; }
  platform(0, z, z + 26, 8); walls(z, z + 26, 4, 3); crate(0, 0, z + 2, 'checkpoint');
  chase.endZ = z + 26;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.25, 12, 32), M.portal); ring.position.set(0, 2, z + 20); scene.add(ring);
  ring.add(new THREE.Mesh(new THREE.CircleGeometry(1.45, 24), M.portal)); chase.finish = ring;
  // the boulder itself
  const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshLambertMaterial({ map: M.wall[0].map, color: 0xcdbca0, flatShading: true }));
  b.scale.setScalar(CHASE.R); b.visible = false; scene.add(b); chase.boulder = b;
}
// ---- the final boss's lab: a trap-door floor with four hidden pads, and Dr. Neo Cortex's hover platform with a lever ----
function buildArena2() {
  const z0 = ARENA2.z, d = ARENA2.d, w = ARENA2.w, back = ARENA2.back, len = back + d, zc = z0 + (back - d) / 2;
  cortex.floor = [-1, 1].map(s => { const f = addBox(s * w / 4, -1, zc, w / 2, 2, len, M.grass); f.dynamic = true; f.side = s; return f; });   // the two trap-door halves
  walls(z0 + back, z0 - d, w / 2, 5);
  addBox(0, 1.75, z0 - d - 0.6, w + 2.4, 7.5, 1.2, M.wall, { wall: true });
  addBox(0, 1.75, z0 + back + 0.6, w + 2.4, 7.5, 1.2, M.wall, { wall: true });
  addBox(0, 3, z0 + 2, w, 6, 1, M.wall, { wall: true }).mesh.visible = false;               // invisible start line (keeps the camera inside)
  const pit = new THREE.Mesh(new THREE.PlaneGeometry(w + 2, len), new THREE.MeshBasicMaterial({ color: 0x5a1a12 }));
  pit.rotation.x = -Math.PI / 2; pit.position.set(0, -11.5, zc); scene.add(pit);
  const H = 14;                                                                             // the four pads: tall pillars hidden under the floor until the lever is pulled
  cortex.pads = [[-4.2, z0 - 10], [4.2, z0 - 10], [-4.2, z0 - 17.4], [4.2, z0 - 17.4]].map(([x, z]) => {
    const s = addBox(x, -0.5 - H / 2, z, 4.2, H, 4.2, M.moving); s.dynamic = true; s.broken = false;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.1, 3.4), new THREE.MeshBasicMaterial({ color: 0x66ffee })); plate.position.y = H / 2 + 0.05; s.mesh.add(plate);
    s.pad = { x, z, top: -0.5, state: 'hidden', t: 0, H, plate };
    return s;
  });
  // Cortex's hover platform (with a lever on the left end) and the holder his model stands in
  const hp = new THREE.Group(), zp = z0 - d + 3.5; hp.position.set(0, 5.6, zp);
  const metal = new THREE.MeshLambertMaterial({ map: M.moving[0].map, color: 0x8899aa });
  hp.add(new THREE.Mesh(new THREE.BoxGeometry(7, 0.9, 4.6), metal));
  const glow = new THREE.Mesh(new THREE.CircleGeometry(2.6, 24), new THREE.MeshBasicMaterial({ color: 0x55ddff, transparent: true, opacity: 0.55 })); glow.rotation.x = Math.PI / 2; glow.position.y = -0.5; hp.add(glow);
  const lev = new THREE.Group(); lev.position.set(-2.9, 0.45, 0.4);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.5, 8), new THREE.MeshLambertMaterial({ color: 0x555555 })); post.position.y = 0.75; lev.add(post);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshLambertMaterial({ color: 0xdd2222, emissive: 0x551111 })); knob.position.y = 1.55; lev.add(knob);
  hp.add(lev); cortex.lever = lev; lev.rotation.z = -0.6;
  cortex.root.position.set(0, 0.45, 0); hp.add(cortex.root);
  scene.add(hp); cortex.platform = hp; cortex.zp = zp;
  crate(-7, 0, z0 - 3, 'aku'); crate(7, 0, z0 - 3, 'life');
}
// plants, canopy floor and bushes for the two new regions
function stageScenery() {
  const zA = CHASE.z0 - 150, zB = ARENA2.z + 80, len = zB - zA;
  const m2 = M.water.clone(); m2.map = M.water.map.clone(); m2.map.repeat.set(120, len / 2.4); m2.map.needsUpdate = true;
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(500, len), m2); plane.rotation.x = -Math.PI / 2; plane.position.set(0, -9, (zA + zB) / 2); scene.add(plane);
  const inLab = (x, z) => Math.abs(x) < ARENA2.w / 2 + 2.5 && z > ARENA2.z - ARENA2.d - 3 && z < ARENA2.z + ARENA2.back + 3;
  for (let z = CHASE.z0 - 45; z < chase.endZ + 10; z += 3.2) for (let k = 0; k < 3; k++) {   // bush canopy under the chase track
    const bs = 3.5 + Math.random() * 3, b = new THREE.Sprite(M.tree); b.scale.set(bs * 1.15, bs, 1); b.position.set((Math.random() - 0.5) * 34, -3 - Math.random() * 5, z + Math.random() * 3); scene.add(b);
  }
  for (const [za, zb] of [[CHASE.z0 - 80, chase.endZ + 60], [ARENA2.z - 60, ARENA2.z + 40]]) {
    const n = Math.round((zb - za) * 0.9);
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1, z = za + Math.random() * (zb - za), x = side * (6.5 + Math.random() * 16);
      if (inLab(x, z)) continue;
      const h = 5 + Math.random() * 6, t = new THREE.Sprite(M.tree); t.scale.set(h * 1.15, h, 1); t.position.set(x, h / 2 - 1.8, z); scene.add(t);
      if (i % 3 === 0) { const bx = side * (5.3 + Math.random() * 2.5); if (inLab(bx, z)) continue; const bs = 2 + Math.random() * 1.8, bu = new THREE.Sprite(M.tree); bu.scale.set(bs * 1.15, bs, 1); bu.position.set(bx, bs / 2 - 0.3, z); scene.add(bu);
        const f = new THREE.Sprite(Math.random() < 0.5 ? M.flowerBlue : M.flowerRed); f.scale.set(0.9, 0.9, 1); f.position.set(side * (4.9 + Math.random() * 1.2), 0.3, z + Math.random() * 3); scene.add(f); }
    }
  }
}
const inArena = (x, z) => Math.abs(x) < ARENA.w / 2 + 2.5 && z < ARENA.z + 16 && z > ARENA.z - ARENA.d - 3;   // keep scenery out of the boss courtyard
function buildArena() {
  const z0 = ARENA.z, d = ARENA.d, w = ARENA.w, back = 13;          // `back`: extra room behind the start line for the camera
  platform(0, z0 + back, z0 - d, w);
  walls(z0 + back, z0 - d, w / 2, 4.5);
  addBox(0, 1.25, z0 - d - 0.6, w + 2.4, 6.5, 1.2, M.wall, { wall: true });          // back wall behind Ripper Roo
  addBox(0, 1.25, z0 + back + 0.6, w + 2.4, 6.5, 1.2, M.wall, { wall: true });       // wall behind the camera
  addBox(0, 3, z0 + 2, w, 6, 1, M.wall, { wall: true }).mesh.visible = false;        // invisible line: you can't back up past the start (keeps the camera inside)
  for (const [x, z] of [[-8.6, z0 - 6], [8.6, z0 - 6], [-8.6, z0 - d + 6], [8.6, z0 - d + 6]]) addBox(x, 2, z, 1.6, 4, 1.6, M.wall, { wall: true });   // corner totems
  crate(-6, 0, z0 - 3, 'aku'); crate(6, 0, z0 - 3, 'life');                          // a little help at the entrance
}
function freeze(o) { o.updateMatrix(); o.matrixAutoUpdate = false; for (const c of o.children) freeze(c); }   // static object: compute its transform once
// ---------- level ----------
function buildLevel() {
  // 1. start area
  platform(0, 4, -22, 7); walls(4, -22, 3.5);
  crate(-1.5, 0, -8, 'normal', 3); crate(1.5, 0, -8, 'normal', 3); crate(0, 0, -14, 'normal', 5); crate(0, 0, -11, 'aku');
  fruitLine(0, 0.9, -3, -6, 3); fruitLine(0, 0.9, -16, -20, 4);
  // 2. first gap + patrol platform
  platform(0, -25, -42, 7); walls(-25, -42, 3.5);
  enemy(0, 0, -31, 'x', 2.5); enemy(0, 0, -37, 'x', 2.5);
  crate(-2.5, 0, -27, 'tnt'); crate(2.5, 0, -40, 'life');
  fruit(0, 3.2, -23.5); fruitLine(2, 0.9, -28, -40, 4);
  // 3. narrow bridge with spikes + checkpoint
  platform(0, -45, -64, 2.6, 0, M.dirt);
  crate(0, 0, -46.5, 'checkpoint');
  spike(0, 0, -52); spike(0, 0, -58);
  fruit(0, 2.3, -52); fruit(0, 2.3, -58); fruitLine(0, 0.9, -54, -56, 2);
  // 4. moving platform ride
  const mv = addBox(0, -1, -67, 3.4, 2, 3.4, M.moving);
  mv.mover = { axis: 'z', origin: -67, range: 2.2, speed: 1.1 }; movers.push(mv);
  fruitLine(0, 1.2, -65, -69, 3);
  // 5. hill: smooth slope up, a flat top with enemies, smooth slope back down
  platform(0, -72, -102, 8); walls(-72, -102, 4);
  ramp(0, 8, -77, 0, -83, 2.2);
  addBox(0, 1.1, -86, 8, 2.2, 6, M.grass);          // solid from the ground up, so there is no gap under the top
  ramp(0, 8, -89, 2.2, -97, 0);
  crate(-2, 2.2, -86, 'normal', 5); crate(2, 2.2, -86, 'normal', 5); crate(0, 2.2, -85, 'aku');
  enemy(0, 0, -76.5, 'x', 3); enemy(0, 2.2, -88, 'x', 3); enemy(0, 0, -99, 'x', 3);
  rampFruit(-77, 0, -83, 2.2, 3); fruitLine(0, 3.1, -84, -88, 3); rampFruit(-89, 2.2, -97, 0, 4);
  spike(0, 0, -101);
  // 6. long arena with a wave of patrolling enemies
  platform(0, -105, -128, 9); walls(-105, -128, 4.5);
  crate(0, 0, -107, 'checkpoint'); crate(-3, 0, -112, 'normal', 5); crate(3, 0, -112, 'normal', 5);
  crate(0, 0, -115, 'aku'); crate(-3, 0, -121, 'normal', 5); crate(3, 0, -121, 'normal', 5);
  enemy(0, 0, -110, 'x', 3.5); enemy(0, 0, -118, 'x', 3.5); enemy(0, 0, -122, 'x', 3.5); enemy(0, 0, -125, 'x', 3.5);
  fruitLine(0, 0.9, -108, -114, 4); fruitLine(0, 0.9, -116, -126, 6);
  // 7. chain of moving platforms with an island between
  const mv1 = addBox(0, -1, -131, 3.4, 2, 3.4, M.moving);
  mv1.mover = { axis: 'z', origin: -131, range: 2.2, speed: 1.2 }; movers.push(mv1);
  platform(0, -136, -141, 5);
  crate(0, 0, -138.5, 'normal', 5);
  const mv2 = addBox(0, -1, -144, 3.4, 2, 3.4, M.moving);
  mv2.mover = { axis: 'z', origin: -144, range: 2.2, speed: 1.0 }; movers.push(mv2);
  fruitLine(0, 1.2, -129, -133, 3); fruitLine(0, 1.2, -142, -146, 3);
  // 8. long narrow bridge: spikes and enemies that patrol along it
  platform(0, -149, -178, 2.8, 0, M.dirt);
  crate(0, 0, -150.5, 'checkpoint'); crate(0, 0, -152, 'aku');
  for (const z of [-155, -163, -171]) { spike(0, 0, z); fruit(0, 2.3, z); }
  enemy(0, 0, -159, 'z', 1.6); enemy(0, 0, -167, 'z', 1.6); enemy(0, 0, -175, 'z', 1.6);
  // 9. long hill: up a smooth slope, across a plateau, down another slope
  platform(0, -181, -185, 8);
  ramp(0, 8, -185, 0, -195, 2.4);
  platform(0, -195, -207, 8, 2.4);
  ramp(0, 8, -207, 2.4, -217, 0);
  crate(-2.5, 2.4, -199, 'normal', 8); crate(2.5, 2.4, -199, 'normal', 8); crate(0, 2.4, -201, 'aku');
  enemy(0, 2.4, -198, 'x', 3); enemy(0, 2.4, -203, 'x', 3);
  spike(-2, 2.4, -205.5); spike(2, 2.4, -205.5);
  rampFruit(-185, 0, -195, 2.4, 5); fruitLine(0, 3.4, -196, -206, 5); rampFruit(-207, 2.4, -217, 0, 5);
  // 10+. generated sections: the rest of the level is assembled from templates (seeded, so it is the same every run)
  let seed = 20241031;
  const rng = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rr = (a, b) => a + rng() * (b - a);
  let sectionNo = 0;
  const maybeCheckpoint = z => { if (sectionNo % 4 === 0) crate(0, 0, z, 'checkpoint'); };
  const maybeLife = (x, y, z, p = 0.3) => { if (rng() < p) crate(x, y, z, 'life'); };
  const maybeTnt = (x, z, p = 0.5) => { if (rng() < p) crate(x, 0, z, 'tnt'); };
  const maybeAku = (y, z, p = 0.55) => { if (rng() < p) crate(0, y, z, 'aku'); };
  const T = {
    arena(z0) {                                      // wide platform, wave of patrolling enemies, crates
      const len = rr(24, 30); platform(0, z0, z0 - len, 9); walls(z0, z0 - len, 4.5);
      maybeCheckpoint(z0 - 1.5);
      crate(-3, 0, z0 - 5, 'normal', 4); crate(3, 0, z0 - 5, 'normal', 4); maybeAku(0, z0 - 8);
      const n = 3 + (sectionNo > 8 ? 1 : 0);
      for (let i = 0; i < n; i++) enemy(0, 0, z0 - 8 - i * ((len - 12) / n), 'x', 3.5);
      crate(-3, 0, z0 - len + 4, 'normal', 5); crate(3, 0, z0 - len + 4, 'normal', 5);
      maybeTnt(rng() < 0.5 ? -2.5 : 2.5, z0 - 15); maybeLife(0, 0, z0 - len + 2);
      fruitLine(0, 0.9, z0 - 3, z0 - len + 2, 7);
      return z0 - len;
    },
    bridge(z0) {                                     // narrow bridge: spikes plus enemies patrolling along it
      const len = 26; platform(0, z0, z0 - len, 2.8, 0, M.dirt);
      maybeCheckpoint(z0 - 1.5);
      for (const d of [6, 14, 22]) { spike(0, 0, z0 - d); fruit(0, 2.3, z0 - d); }
      enemy(0, 0, z0 - 10, 'z', 1.6); enemy(0, 0, z0 - 18, 'z', 1.6);
      return z0 - len;
    },
    ride(z0) {                                       // z0 is 3 past the previous platform: ride a moving platform across
      const mv = addBox(0, -1, z0, 3.4, 2, 3.4, M.moving);
      mv.mover = { axis: 'z', origin: z0, range: 2.2, speed: rr(0.9, 1.3) }; movers.push(mv);
      fruitLine(0, 1.2, z0 + 2, z0 - 2, 3);
      platform(0, z0 - 5, z0 - 19, 6);
      crate(-1.5, 0, z0 - 8, 'normal', 4); crate(1.5, 0, z0 - 8, 'normal', 4);
      enemy(0, 0, z0 - 14, 'x', 2.2);
      return z0 - 19;
    },
    plateau(z0) {                                    // hill: smooth slope up, flat top with enemies, smooth slope down
      const H = rng() < 0.5 ? 2.4 : 3.4;
      platform(0, z0, z0 - 4, 8);
      ramp(0, 8, z0 - 4, 0, z0 - 14, H);
      platform(0, z0 - 14, z0 - 26, 8, H);
      ramp(0, 8, z0 - 26, H, z0 - 36, 0);
      maybeCheckpoint(z0 - 1.5); maybeAku(H, z0 - 18);
      crate(-2.5, H, z0 - 17, 'normal', 6); crate(2.5, H, z0 - 17, 'normal', 6); maybeLife(0, H, z0 - 23);
      enemy(0, H, z0 - 20, 'x', 3); enemy(0, H, z0 - 24, 'x', 3);
      spike(-2.2, H, z0 - 25); spike(2.2, H, z0 - 25);
      rampFruit(z0 - 4, 0, z0 - 14, H, 4); fruitLine(0, H + 0.9, z0 - 15, z0 - 25, 5); rampFruit(z0 - 26, H, z0 - 36, 0, 4);
      return z0 - 36;
    },
    stones(z0) {                                     // hop across a line of small islands
      let z = z0; const xs = [0, 1.3, -1.3, 1.0, -1.0, 0];
      xs.forEach((x, i) => {
        platform(x, z, z - 4.2, 3.6); if (i === 2) crate(x, 0, z - 2.1, 'normal', 5);
        if (i < xs.length - 1) fruit((x + xs[i + 1]) / 2, 2.3, z - 4.2 - 1.4);
        z -= i < xs.length - 1 ? 7 : 4.2;
      });
      return z;
    },
    spikes(z0) {                                     // spike rows you have to weave through
      const len = 26; platform(0, z0, z0 - len, 9); walls(z0, z0 - len, 4.5);
      maybeCheckpoint(z0 - 1.5);
      for (const [d, xs] of [[7, [-3, -1]], [13, [1, 3]], [19, [-3, -1]]]) for (const x of xs) spike(x, 0, z0 - d);
      enemy(0, 0, z0 - 10, 'x', 3); enemy(0, 0, z0 - 16, 'x', 3);
      crate(-3.2, 0, z0 - 4, 'normal', 4); crate(3.2, 0, z0 - 4, 'normal', 4); maybeAku(0, z0 - 22, 0.4); maybeTnt(3.5, z0 - 23, 0.4);
      fruitLine(0, 0.9, z0 - 3, z0 - 24, 8);
      return z0 - len;
    },
  };
  const order = ['arena', 'bridge', 'plateau', 'ride', 'spikes', 'stones'];
  let z = -220, prev = '';
  while (z > LEVEL_END + 40) {
    sectionNo++;
    let kind; do { kind = order[(rng() * order.length) | 0]; } while (kind === prev || (kind === 'ride' && prev === 'plateau'));
    prev = kind;
    // every section starts 3 past the previous platform's end; 'ride' uses that gap for its moving platform
    const startZ = z;
    z = T[kind](z) - 3;
    LAYOUT.push([kind, Math.round(startZ), Math.round(z + 3)]);
  }
  // finale
  const endZ = Math.min(LEVEL_END, z - 40);          // always leave room for the finale even if the last section ran long
  platform(0, z, endZ, 8); walls(z, endZ, 4);
  crate(0, 0, z - 1.5, 'checkpoint'); crate(-2.5, 0, z - 6, 'normal', 8); crate(2.5, 0, z - 6, 'normal', 8); crate(0, 0, z - 9, 'aku');
  enemy(0, 0, z - 12, 'x', 3); enemy(0, 0, z - 16, 'x', 3); enemy(0, 0, z - 20, 'x', 3);
  fruitLine(0, 0.9, z - 3, endZ + 5, 10);
  finish = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.25, 12, 32), M.portal);
  finish.position.set(0, 2, endZ + 6); scene.add(finish);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45, 24), M.portal); finish.add(disc);

  // scenery
  buildArena();
  buildChase(); buildArena2(); stageScenery();
  const worldLen = -WORLD_END + 300;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(500, worldLen), M.water);
  M.water.map.repeat.set(120, Math.round(worldLen / 2.4));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -9, WORLD_END / 2); scene.add(water);
  const span = -WORLD_END + 20;
  for (let z = 14; z > LEVEL_END - 24; z -= 2.2) {                 // a thick bush canopy below the path hides the drop
    for (let k = 0; k < 4; k++) {
      const x = (Math.random() - 0.5) * 34, bs = 3.5 + Math.random() * 3, y = -3 - Math.random() * 5;
      const b = new THREE.Sprite(M.tree); b.scale.set(bs * 1.15, bs, 1); b.position.set(x, y, z + Math.random() * 2); scene.add(b);
    }
  }
  for (let i = 0; i < Math.round(-WORLD_END * 0.9); i++) {          // big jungle plants either side of the trail
    const side = Math.random() < 0.5 ? -1 : 1, z = 10 - Math.random() * span, x = side * (6.5 + Math.random() * 16);
    if (inArena(x, z)) continue;
    const h = 5 + Math.random() * 6;
    const t = new THREE.Sprite(M.tree); t.scale.set(h * 1.15, h, 1); t.position.set(x, h / 2 - 1.8, z); scene.add(t);
  }
  for (let i = 0; i < Math.round(-LEVEL_END * 0.35); i++) {         // leafy bushes hugging the path edge, and flowers
    const side = Math.random() < 0.5 ? -1 : 1, z = 10 - Math.random() * span, x = side * (5.3 + Math.random() * 2.5);
    if (inArena(x, z)) continue;
    const bush = new THREE.Sprite(M.tree); const bs = 2 + Math.random() * 1.8; bush.scale.set(bs * 1.15, bs, 1); bush.position.set(x, bs / 2 - 0.3, z); scene.add(bush);
    const f = new THREE.Sprite(Math.random() < 0.5 ? M.flowerBlue : M.flowerRed); f.scale.set(0.9, 0.9, 1); f.position.set(side * (4.9 + Math.random() * 1.2), 0.3, z + Math.random() * 3); scene.add(f);
  }
}
buildLevel();
for (const s of solids) if (!movers.includes(s) && !s.dynamic) freeze(s.mesh);   // (trap-door floor halves and rising pads move, so they stay live)
for (const o of scene.children) if (o.isSprite && !o.userData.dynamic) freeze(o);

// ---------- player ----------
const player = { pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), grounded: false, ground: null,
  coyote: 0, jumpBuf: 0, spin: 0, spinCd: 0, facing: Math.PI, hurt: 0 };
const playerRoot = new THREE.Group(); scene.add(playerRoot);
const modelHolder = new THREE.Group(); playerRoot.add(modelHolder);
modelHolder.rotation.order = 'YXZ';   // turn to face first, then lean forward about the character's own side axis
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

function placeholder() {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 4, 10), mat(0xff7043)); m.position.y = PLAYER_H / 2; modelHolder.add(m);
}
let animator = null;
function crisp(root) {   // PS1-on-an-HD-emulator look: texels stay sharp up close, mipmaps stop shimmering at a distance
  root.traverse(o => { if (!o.isMesh) return; for (const mt of [].concat(o.material)) for (const k of ['map', 'emissiveMap']) { const t = mt[k]; if (t) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.anisotropy = 8; t.needsUpdate = true; } } });
}
const onModel = gltf => {
  const model = gltf.scene; crisp(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  const k = PLAYER_H * MODEL_SCALE / size.y;
  const wrap = new THREE.Group(); wrap.add(model); wrap.scale.setScalar(k);
  const c = box.getCenter(new THREE.Vector3());
  model.position.set(-c.x, -box.min.y, -c.z);
  wrap.rotation.y = MODEL_YAW;
  modelHolder.add(wrap);
  animator = makeAnimator(model);
};

function loadGlb(b64, url, onLoad, onError) {
  const loader = new GLTFLoader();
  if (b64) { // single-file build: model is embedded, no network fetch
    const bin = atob(b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    loader.parse(buf.buffer, '', onLoad, onError);
  } else loader.load(url, onLoad, undefined, onError);
}
loadGlb(window.__PLAYER_B64, './assets/player.glb', onModel, placeholder);

// ---------- Aku Aku (floating mask companion) ----------
const akuFace = new THREE.Vector3(), akuQuat = new THREE.Quaternion();
const aku = new THREE.Group(); aku.visible = false; scene.add(aku);
const akuMats = [];
loadGlb(window.__AKU_B64, './assets/aku_aku.glb', gltf => {
  const model = gltf.scene; crisp(model);
  const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  const wrap = new THREE.Group(); wrap.add(model); wrap.scale.setScalar(1.9 / size.y);
  const c = box.getCenter(new THREE.Vector3()); model.position.sub(c);
  model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; for (const mt of [].concat(o.material)) { akuMats.push(mt); mt.fog = false; } } });
  aku.add(wrap);
}, () => {});

// ---------- input ----------
const keys = {};
addEventListener('keydown', e => {
  unlockAudio();
  if (e.repeat) return;
  if (e.code === 'KeyM') toggleSound();
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' || e.code === 'KeyK') player.jumpBuf = JUMP_BUFFER;
  if (['ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyX'].includes(e.code)) trySpin();
  if (state !== 'play' && (e.code === 'Enter' || e.code === 'Space')) startOrRestart();
});
// ---- on-screen touch controls (iPad / phones) ----
if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) document.body.classList.add('touch');
const touchButtons = [...document.querySelectorAll('#touch button')];
const arrowPointers = new Map();   // pointerId -> the arrow button that finger is currently on
const setBtn = (b, on) => { b.classList.toggle('down', on); if (b.dataset.key) keys[b.dataset.key] = on; };
function arrowUnder(e) { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.dataset && el.dataset.key && el.dataset.key.startsWith('Arrow') ? el : null; }
function moveArrowPointer(e, b) {
  const old = arrowPointers.get(e.pointerId);
  if (old === b) return;
  if (old) setBtn(old, [...arrowPointers.entries()].some(([id, o]) => id !== e.pointerId && o === old));
  if (b) { arrowPointers.set(e.pointerId, b); setBtn(b, true); } else arrowPointers.delete(e.pointerId);
}
for (const b of touchButtons) {
  const isArrow = b.dataset.key && b.dataset.key.startsWith('Arrow');
  b.addEventListener('pointerdown', e => {
    e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch {}
    unlockAudio();
    if (isArrow) { moveArrowPointer(e, b); return; }
    setBtn(b, true);
    if (b.dataset.key === 'Space') player.jumpBuf = JUMP_BUFFER;
    if (b.dataset.action === 'spin') trySpin();
  });
  if (isArrow) b.addEventListener('pointermove', e => { if (arrowPointers.has(e.pointerId)) moveArrowPointer(e, arrowUnder(e)); });   // slide from one arrow to another without lifting
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, e => {
    e.preventDefault();
    if (isArrow) moveArrowPointer(e, null); else setBtn(b, false);
  });
  b.addEventListener('contextmenu', e => e.preventDefault());
}
function releaseAllInput() {   // window lost focus / tab hidden: don't leave Crash running with a stuck key
  for (const k of Object.keys(keys)) keys[k] = false;
  arrowPointers.clear(); for (const b of touchButtons) b.classList.remove('down');
}
addEventListener('blur', releaseAllInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllInput(); });
addEventListener('keyup', e => { keys[e.code] = false; });

// ---------- sound ----------
const beep = blip;   // small one-off blips go through the shared audio engine too

// ---------- game state ----------
let masks = 0, invincible = 0; // masks = Aku Aku power level 0..2 (hits he can absorb); invincible = seconds of golden Aku Aku
let state = 'title', lives = START_LIVES, fruitCount = 0, cratesBroken = 0, totalCrates = crates.length;
let checkpoint = new THREE.Vector3(0, 0, 0), time = 0;
const hud = { lives: document.getElementById('lives'), fruit: document.getElementById('fruit'), crates: document.getElementById('crates'), aku: document.getElementById('aku') };
const msg = document.getElementById('msg'), msgbody = document.getElementById('msgbody'), startBtn = document.getElementById('startBtn');
startBtn.addEventListener('click', startOrRestart);
msg.addEventListener('pointerdown', e => { if (state !== 'play' && e.target !== startBtn) startOrRestart(); });
hud.fruit.innerHTML = `<img src="${WUMPA_URL}" height="26" style="image-rendering:pixelated;vertical-align:middle"> <span></span>`;
const fruitNum = hud.fruit.querySelector('span');
function updateHud() {
  hud.lives.textContent = `♥ x${lives}`; fruitNum.textContent = fruitCount;
  hud.aku.textContent = invincible > 0 ? `GOLDEN AKU AKU ${Math.ceil(invincible)}s` : masks > 0 ? `AKU AKU LV ${masks}/3` : '';
  hud.crates.textContent = `📦 ${cratesBroken}/${totalCrates}`;
}
const GAME_TITLE = 'CRASH BANDICOOT ADVENTURE';
function showMsg(title, body, label = 'PLAY') {
  startBtn.textContent = label;
  const h1 = msg.querySelector('h1'); h1.textContent = title; h1.hidden = title === GAME_TITLE;   // the logo stands in for the title text
  msgbody.innerHTML = body; msg.classList.remove('hidden');
}
showMsg(GAME_TITLE, `<kbd>WASD</kbd>/<kbd>Arrows</kbd> move &nbsp; <kbd>Space</kbd> jump &nbsp; <kbd>Shift</kbd>/<kbd>J</kbd> spin<br>Spin or stomp crates and enemies, collect fruit, reach the portal.<br><br>Break an Aku Aku crate to summon Aku Aku, who blocks hits. Break two more to turn him golden and become invincible (but you can still fall).<br>Reach the portal to face <b>Ripper Roo</b>. Beat him, outrun the boulder in level 2, then take on Dr. Neo Cortex: dodge his green zaps and spin his golden ones back at him!<br><br>Press <kbd>Enter</kbd> or tap to start<br>On iPad: use the on-screen arrows, JUMP and SPIN buttons<br><small>Aku Aku model by anttipantti, Ripper Roo model by Mechatorrs, Dr. Neo Cortex model by SG_Gaming786 (CC BY 4.0)</small>`);
let uiLockUntil = 0;   // ignore taps for a moment after Game Over / Level Complete so a mashed button can't restart instantly
// if the browser still has audio blocked a moment after the first tap, tell the player how to turn it on
function checkSound() { const s = audioStatus(); if (!s.muted && s.state !== 'running') toast('TAP THE SPEAKER BUTTON FOR SOUND'); }
const muteBtn = document.getElementById('muteBtn');
function toggleSound() { unlockEngine(); setMuted(!isMuted()); muteBtn.textContent = isMuted() ? '\uD83D\uDD07' : '\uD83D\uDD0A'; }
muteBtn.textContent = isMuted() ? '\uD83D\uDD07' : '\uD83D\uDD0A';
muteBtn.addEventListener('click', toggleSound);
function unlockAudio() {
  unlockEngine();   // iPad Safari keeps audio suspended until a tap
}
function startOrRestart() {
  unlockAudio();
  if (performance.now() < uiLockUntil) return;
  if (state === 'title') { state = 'play'; msg.classList.add('hidden'); updateHud(); music('level'); setTimeout(checkSound, 900); }
  else if (state === 'over' || state === 'won') resetGame();
}
// full in-place reset (no page reload): everything goes back to how it was at the start
function resetGame() {
  removeQueue.length = 0; bossReset(); stagesReset();
  lives = START_LIVES; fruitCount = 0; cratesBroken = 0; masks = 0; invincible = 0; checkpoint.set(0, 0, 0);
  for (const c of crates) {
    c.broken = false; c.mesh.visible = true; c.armed = false;
    if (c.label) { scene.remove(c.label); c.label = null; }
    if (c.kind === 'tnt') c.mesh.material.emissive.setHex(0x000000);
    if (!solids.includes(c)) solids.push(c);
  }
  for (const f of fruits) { f.got = false; f.mesh.visible = true; }
  for (const e of enemies) { e.alive = true; e.mesh.visible = true; e.t = Math.random() * 6; }
  for (const list of [debris, pops, booms]) { for (const o of list) scene.remove(o); list.length = 0; }
  player.pos.set(0, 0, 0); respawn(); player.hurt = 0;
  state = 'play'; msg.classList.add('hidden'); updateHud(); music('level');
}
let camSnap = true;   // jump the camera straight to the player (respawn / restart) instead of gliding across the level
function respawn() {
  if (cortex.active && cortex.wantOpen) {                 // the floor is gone: come back on a pad that is still standing
    const s = cortex.pads.find(q => q.pad.state === 'up') || cortex.pads[0]; if (s.pad.state !== 'up') { s.pad.state = 'up'; s.pad.top = 0.9; s.broken = false; s.mesh.visible = true; }
    checkpoint.set(s.pad.x, 0.9, s.pad.z);
  }
  player.pos.copy(checkpoint); player.vel.set(0, 0, 0); player.spin = 0; player.spinCd = 0; player.hurt = 1;
  player.grounded = false; player.ground = null; player.coyote = 0; player.jumpBuf = 0;   // an old moving platform must not keep carrying us
  camSnap = true; aku.userData.init = false;
  if (chase.active) { player.facing = 0; modelHolder.userData.yaw = 0; chase.boulder.position.set(0, CHASE.R, checkpoint.z - 17); chase.stun = 0; }   // runs toward the camera; the boulder starts behind
  if (cortex.active && cortex.dead === 0) { clearBlasts(); cortex.act = null; cortex.shootT = Math.max(cortex.shootT, 1.5); cortex.intro = Math.max(cortex.intro, 1.2); }
  if (boss.active && boss.dead === 0) { clearRocks(); boss.act = null; boss.want = null; boss.intro = Math.max(boss.intro, 1.5); boss.bigT = Math.max(boss.bigT, 6); }   // fresh start in the arena
}
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(text) {
  toastEl.textContent = text; toastEl.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1400);
}
function hit() {
  if (player.hurt > 0.5 || invincible > 0) return;
  if (masks <= 0) return die();
  masks--; player.hurt = 1; player.vel.y = JUMP_V * 0.6; player.grounded = false;
  sfx('hurt'); updateHud(); toast(masks > 0 ? 'AKU AKU PROTECTED YOU!' : 'AKU AKU IS GONE!');
}
function die() {
  if (player.hurt > 0.5) return;
  masks = 0; invincible = 0;
  lives--; sfx('die'); updateHud();
  if (lives <= 0) { state = 'over'; uiLockUntil = performance.now() + 900; music(null); sfx('gameover'); showMsg('GAME OVER', `Fruit: ${fruitCount} &nbsp; Crates: ${cratesBroken}/${totalCrates}<br>Press <kbd>Enter</kbd> or tap the button to retry`, 'TRY AGAIN'); return; }
  respawn();
}
function addFruit(n) { fruitCount += n; while (fruitCount >= 100) { fruitCount -= 100; lives++; sfx('oneup'); } updateHud(); }
function trySpin() {
  if (state !== 'play' || player.spin > 0 || player.spinCd > 0) return;
  player.spin = SPIN_TIME; sfx('spin');
}
const debris = [], debrisGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22), debrisMats = [mat(0xc98a3c), mat(0x6b4210), mat(0xa06a24)];
function spawnDebris(pos) {
  for (let i = 0; i < 10; i++) {
    const d = new THREE.Mesh(debrisGeo, debrisMats[i % 3]); d.position.copy(pos);
    d.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6), life: 0.9 };
    scene.add(d); debris.push(d);
  }
}
// Wumpa that pop out of a smashed crate (the count itself is credited immediately)
const pops = [];
function popFruit(pos, n) {
  for (let i = 0; i < Math.min(n, 5); i++) {
    const s = new THREE.Sprite(M.fruit); s.scale.set(0.8, 0.72, 1); s.position.copy(pos);
    s.userData = { v: new THREE.Vector3((Math.random() - 0.5) * 2.5, 5 + Math.random() * 2, (Math.random() - 0.5) * 2.5), life: 0.7 };
    scene.add(s); pops.push(s);
  }
}
const countdownTex = [1, 2, 3].map(n => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.font = 'bold 56px "Trebuchet MS", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = '#7a1000'; g.strokeText(n, 32, 34); g.fillStyle = '#ffeb3b'; g.fillText(n, 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
});
const booms = [];
function armTnt(c, fromStomp) {
  if (c.broken) return;
  if (fromStomp) { player.vel.y = JUMP_V * 0.8; player.grounded = false; }
  if (c.armed) { if (!fromStomp) c.timer = Math.min(c.timer, 0.15); return; }   // spinning an armed crate sets it off at once
  c.armed = true; c.timer = fromStomp ? 3 : 0.15; c.tick = 99; sfx('tick');
  c.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: countdownTex[2], transparent: true, depthTest: false }));
  c.label.scale.set(1.1, 1.1, 1); c.label.position.copy(c.mesh.position).add(new THREE.Vector3(0, 1.4, 0)); scene.add(c.label);
}
function explodeTnt(c) {
  if (c.broken) return;
  const p = c.mesh.position.clone();
  c.broken = true; c.mesh.visible = false; cratesBroken++; scene.remove(c.label); removeQueue.push(c);
  spawnDebris(p); spawnDebris(p);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff8a00, transparent: true, opacity: 0.85 }));
  ball.position.copy(p); ball.userData = { life: 0.5 }; scene.add(ball); booms.push(ball);
  sfx('boom');
  const R = 3.3;
  if (Math.hypot(player.pos.x - p.x, player.pos.z - p.z) < R && Math.abs(player.pos.y + 0.9 - p.y) < 2.5) hit();
  for (const e of enemies) if (e.alive && e.mesh.position.distanceTo(p) < R + 0.5) { e.alive = false; e.mesh.visible = false; }
  for (const o of crates.slice()) if (!o.broken && o !== c && o.mesh.position.distanceTo(p) < R) { if (o.kind === 'tnt') { armTnt(o, false); } else breakCrate(o, false); }
  updateHud();
}
function breakCrate(c, bounce) {
  if (c.broken) return;
  if (c.kind === 'tnt') return armTnt(c, bounce);
  spawnDebris(c.mesh.position);
  c.broken = true; c.mesh.visible = false; cratesBroken++; removeQueue.push(c);
  if (c.kind === 'checkpoint') { checkpoint.set(c.mesh.position.x, c.mesh.position.y - 0.5, c.mesh.position.z); sfx('checkpoint'); toast('CHECKPOINT!'); }
  else sfx('crate');
  if (c.kind === 'life') { lives++; sfx('oneup'); toast('1UP!'); }
  if (c.kind === 'aku') {
    sfx('aku');
    if (invincible > 0) invincible = INVINCIBLE_TIME;
    else if (masks === 0) { masks = 1; toast('AKU AKU IS WITH YOU!'); }
    else if (masks === 1) { masks = 2; toast('AKU AKU POWER UP!'); }
    else { masks = 0; invincible = INVINCIBLE_TIME; toast('GOLDEN AKU AKU! INVINCIBLE!'); }
  }
  popFruit(c.mesh.position, c.fruitCount || 0);
  addFruit(c.fruitCount || 0);
  if (bounce) { player.vel.y = JUMP_V * 0.8; player.grounded = false; }
  updateHud();
}

// ---------- boss fight: Ripper Roo ----------
// Small rocks roll at you (jump or dodge them). A big rock now and then: SPIN into it to knock it back at Ripper Roo.
// Every big rock that lands costs him one life on the health bar.
const bossUI = { bar: document.getElementById('bossbar'), hp: document.getElementById('bosshp'), fade: document.getElementById('fade') };
bossUI.hp.innerHTML = '<i></i>'.repeat(BOSS_HP);
const boss = { root: new THREE.Group(), model: null, anim: null, baseScale: 1, hp: BOSS_HP, active: false, intro: 0, stun: 0, dead: 0, t: 0, act: null, idleT: 0.6, want: null, flash: 0, smallT: 1, bigT: 7, rocks: [] };
boss.root.rotation.order = 'YXZ';   // turn to face first, then pitch/roll about his own axes
const bossShadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
bossShadow.rotation.x = -Math.PI / 2; bossShadow.visible = false; scene.add(bossShadow);
boss.root.visible = false; boss.root.position.set(0, 0, ARENA.z - ARENA.d + 3); scene.add(boss.root);
const bossZ = () => boss.root.position.z;
const rockGeo = new THREE.IcosahedronGeometry(1, 1);
const rockMat = new THREE.MeshLambertMaterial({ map: M.wall[0].map, color: 0xd8c8b0, flatShading: true });
const bigRockMat = new THREE.MeshLambertMaterial({ map: M.wall[0].map, color: 0xffd9a0, emissive: 0x883300, flatShading: true });

// the model file stores its colours in an old "specular-glossiness" material that the loader skips, so rebuild the materials from the diffuse textures
async function onRipper(gltf) {
  const json = gltf.parser.json, meshes = [];
  gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  let colourImage = null;
  for (const o of meshes) {
    const def = json.materials.find(mt => mt.name === o.material.name), ext = def && def.extensions && def.extensions.KHR_materials_pbrSpecularGlossiness;
    const tex = ext ? await gltf.parser.getDependency('texture', ext.diffuseTexture.index) : o.material.map;
    if (tex) { tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestMipmapLinearFilter; tex.anisotropy = 8; }
    const eyes = o.material.name === 'TexOjos';
    if (!eyes && tex) colourImage = tex.image;
    o.material = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0x222222, alphaTest: eyes ? 0.5 : 0 });
    o.frustumCulled = false;
  }
  // the file holds four poses side by side: keep just the neutral one
  for (const n of ['RipperRoo001', 'RipperRoo', 'RipperRoo003']) { const o = gltf.scene.getObjectByName(n); if (o) o.removeFromParent(); }
  gltf.scene.updateMatrixWorld(true);
  // bake each mesh's transform into its vertices so every part shares one coordinate frame, then animate the parts (legs, head, tongue) per vertex
  const inner = new THREE.Group(), parts = [];
  gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
  for (const o of parts) { o.geometry.applyMatrix4(o.matrixWorld); o.removeFromParent(); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); inner.add(o); }
  const box = new THREE.Box3().setFromObject(inner), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  const wrap = new THREE.Group(); wrap.add(inner);
  boss.baseScale = 6 / size.y; wrap.scale.setScalar(boss.baseScale);   // front of the model faces +Z, toward the player; feet sit at the origin
  boss.model = wrap; boss.anim = makeRooAnimator(parts, colourImage, c.x); boss.root.add(wrap);
}
// Ripper Roo is one rigid mesh. Weight each vertex by where it is (legs low, head high, tongue = the pink texels) and bend those parts each frame.
function makeRooAnimator(parts, image, cx) {
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let px = null;
  if (image) { const cv = document.createElement('canvas'); cv.width = image.width; cv.height = image.height; const g = cv.getContext('2d'); g.drawImage(image, 0, 0); px = { g, w: image.width, h: image.height }; }
  const data = parts.map(o => {
    const pos = o.geometry.attributes.position, uv = o.geometry.attributes.uv, n = pos.count, rest = Float32Array.from(pos.array);
    const leg = new Float32Array(n), head = new Float32Array(n), tongue = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const y = rest[i * 3 + 1];
      leg[i] = 1 - sstep(6.5, 9.5, y); head[i] = sstep(15, 17.5, y);
      if (px && uv && o.material.map && o.material.name === 'Colores') {
        const d = px.g.getImageData(Math.min(px.w - 1, Math.floor(uv.getX(i) * px.w)), Math.min(px.h - 1, Math.floor(uv.getY(i) * px.h)), 1, 1).data;
        if (d[0] > 200 && d[1] < 150 && d[2] < 160 && y > 9 && y < 18.5) tongue[i] = 1;   // the pink tongue hanging down his front
      }
    }
    return { pos, rest, leg, head, tongue, n };
  });
  const HIP = { y: 8.5, z: -3 }, NECK = { y: 16, z: -1 };
  function rot(arr, i, piv, th, w) {   // rotate vertex i about the x axis through `piv`; th>0 pitches the front down
    if (!w || !th) return;
    const a = th * w, c = Math.cos(a), s = Math.sin(a), dy = arr[i * 3 + 1] - piv.y, dz = arr[i * 3 + 2] - piv.z;
    arr[i * 3 + 1] = piv.y + dy * c - dz * s; arr[i * 3 + 2] = piv.z + dy * s + dz * c;
  }
  return { update(P, t) {
    for (const d of data) {
      const arr = d.pos.array;
      for (let i = 0; i < d.n; i++) {
        arr[i * 3] = d.rest[i * 3]; arr[i * 3 + 1] = d.rest[i * 3 + 1]; arr[i * 3 + 2] = d.rest[i * 3 + 2];
        rot(arr, i, HIP, -P.tuck, d.leg[i]);          // legs fold forward and up under him in the air
        rot(arr, i, NECK, P.nod, d.head[i]);          // head nods
        if (d.tongue[i]) {                            // tongue swings; the lower it hangs the more it swings, and it streams upward when he rises
          const k = Math.max(0, Math.min(1.2, (17.5 - arr[i * 3 + 1]) / 7));
          arr[i * 3] += Math.sin(t * 9 + arr[i * 3 + 1] * 0.8) * P.tongue * k;
          arr[i * 3 + 2] += Math.cos(t * 7 + arr[i * 3 + 1] * 0.6) * P.tongue * 0.5 * k - P.flutter * k * 2;
          arr[i * 3 + 1] += P.flutter * k * 3;
        }
      }
      d.pos.needsUpdate = true;
    }
  } };
}
loadGlb(window.__RIPPER_B64, './assets/ripper_roo.glb', onRipper, () => {});

function setBossBar(name, max, hp) {     // one health bar shared by both bosses
  document.getElementById('bossname').textContent = name;
  if (bossUI.hp.children.length !== max) bossUI.hp.innerHTML = '<i></i>'.repeat(max);
  [...bossUI.hp.children].forEach((el, i) => el.classList.toggle('lost', i >= hp));
}
function updateBossBar() { setBossBar('RIPPER ROO', BOSS_HP, boss.hp); }
function clearRocks() { for (const r of boss.rocks) scene.remove(r.mesh); boss.rocks.length = 0; }
function spawnBoom(p, size = 1) {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff8a00, transparent: true, opacity: 0.85 }));
  ball.position.copy(p); ball.scale.setScalar(size); ball.userData = { life: 0.5 }; scene.add(ball); booms.push(ball);
}
function startBoss() {                       // reached the portal: fade out, drop into the arena
  state = 'transition'; uiLockUntil = performance.now() + 900;
  toast('LEVEL COMPLETE!'); sfx('portal'); music(null);
  bossUI.fade.classList.add('on');
  setTimeout(() => {
    clearRocks(); Object.assign(boss, { active: true, hp: BOSS_HP, intro: 3.5, stun: 0, dead: 0, t: 0, act: null, idleT: 0.6, want: null, flash: 0, smallT: 1.5, bigT: 8 });
    boss.root.position.set(0, 0, ARENA.z - ARENA.d + 3); boss.root.visible = true; boss.root.scale.setScalar(1);
    checkpoint.set(0, 0, ARENA.z - 3); player.pos.set(0, 0, ARENA.z - 3); respawn(); player.hurt = 0;
    bossUI.bar.hidden = false; updateBossBar();
    state = 'play'; bossUI.fade.classList.remove('on'); toast('RIPPER ROO!'); sfx('intro'); music('boss');
  }, 1300);
}
function bossReset() {                       // back to the very start of the game
  clearRocks(); boss.active = false; boss.root.visible = false; bossShadow.visible = false; boss.hp = BOSS_HP; boss.dead = 0; boss.act = null; boss.want = null;
  bossUI.bar.hidden = true; bossUI.fade.classList.remove('on'); updateBossBar();
}
function spawnRock(kind) {
  const big = kind === 'big', r = big ? 1.3 : 0.5 + Math.random() * 0.15, lim = ARENA.w / 2 - 2.2, clamp = v => Math.max(-lim, Math.min(lim, v));
  const startX = clamp(boss.root.position.x);                    // rocks leave from where Ripper Roo is standing
  let tx = big ? clamp(player.pos.x + (Math.random() - 0.5) * 4) : clamp(startX + (Math.random() - 0.5) * 3);
  const bigRock = boss.rocks.find(k => k.kind === 'big');
  if (!big && bigRock && Math.abs(bigRock.tx - tx) < 3.2) tx = clamp(bigRock.tx + (tx < bigRock.tx ? -3.4 : 3.4));
  const mesh = new THREE.Mesh(rockGeo, big ? bigRockMat : rockMat);
  mesh.scale.setScalar(r); mesh.position.set(startX, r, bossZ() + 2.2); mesh.rotation.set(Math.random() * 6, Math.random() * 6, 0);
  scene.add(mesh);
  const phase = BOSS_HP - boss.hp;
  boss.rocks.push({ mesh, kind, r, tx, speed: big ? 5.5 + phase * 0.5 : 7 + phase * 0.9 });   // tx: the lane it rolls toward
  sfx(kind === 'big' ? 'throwBig' : 'throw');
  if (big) toast('BIG ROCK! SPIN INTO IT!');
}
function hitBoss() {
  boss.hp--; boss.stun = 1.8; boss.flash = 1.4; boss.bigT = 6; boss.want = null; boss.act = null;
  updateBossBar(); sfx('bossHit');
  const p = boss.root.position.clone(); p.y += 2; spawnBoom(p, 1.6); spawnDebris(p);
  if (boss.hp <= 0) { boss.dead = 0.001; clearRocks(); toast('RIPPER ROO DEFEATED!'); }
  else toast(`RIPPER ROO LOSES A LIFE! ${boss.hp} LEFT`);
}
function updateBoss(dt) {
  boss.t += dt;
  const bp = boss.root.position, fighting = boss.intro <= 0 && boss.dead === 0, lim = ARENA.w / 2 - 2.5, phase = BOSS_HP - boss.hp;
  if (boss.intro > 0) boss.intro -= dt;
  if (boss.dead > 0) {                           // defeated: spins up, blows up, then the game is won
    boss.dead += dt; boss.root.rotation.y += dt * 14; boss.root.position.y = Math.min(boss.dead * 2.2, 4);
    boss.root.scale.setScalar(Math.max(0.01, 1 - Math.max(0, boss.dead - 1.8) * 1.2)); bossShadow.visible = false;
    if (Math.random() < dt * 14) { const p = bp.clone(); p.x += (Math.random() - 0.5) * 3; p.y += 1 + Math.random() * 3; spawnBoom(p, 0.8 + Math.random()); }
    if (boss.dead > 2.6 && state === 'play') { boss.root.visible = false; bossUI.bar.hidden = true; startChase(); }   // on to level 2
    return;
  }
  boss.flash = Math.max(0, boss.flash - dt);

  // what does he want to do? (rocks are thrown from a jump, so the timers only *request* a throw)
  if (fighting) {
    boss.smallT -= dt; if (boss.smallT <= 0 && !boss.want) boss.want = 'small';
    const bigBusy = boss.rocks.some(r => r.kind === 'big') || (boss.act && boss.act.rock === 'big');
    if (!bigBusy) { boss.bigT -= dt; if (boss.bigT <= 0) boss.want = 'big'; }
  }
  // behaviour: idle -> hop to a new spot / jump-and-throw -> idle ... (stun interrupts)
  let a = boss.act;
  if (boss.stun > 0) { boss.stun -= dt; if (!a || a.kind !== 'stun') a = boss.act = { kind: 'stun', t: 0 }; }
  else if (a && a.kind === 'stun') a = boss.act = null;
  if (!a) {
    boss.idleT -= dt;
    if (boss.idleT <= 0) {
      if (fighting && boss.want) {
        const big = boss.want === 'big';
        a = boss.act = { kind: 'throw', rock: boss.want, t: 0, dur: big ? 1.45 : 1.05, rel: big ? 0.6 : 0.55, h: big ? 3.3 : 2, released: false };
        if (big) boss.bigT = 8; else boss.smallT = Math.max(0.3, 1.0 - phase * 0.16);
        boss.want = null;
      } else {
        const x1 = (Math.random() * 2 - 1) * lim;
        a = boss.act = { kind: 'hop', t: 0, dur: 0.72 + Math.min(0.35, Math.abs(x1 - bp.x) * 0.04), x0: bp.x, x1, h: 1.5 };
      }
    }
  }
  // pose for this frame: squash/stretch (sy), jump height (lift), lean (pitch), roll (tilt), legs folded (tuck), head nod, tongue swing/flutter
  const P = { lift: 0, sy: 1 + Math.sin(boss.t * 3) * 0.02, lean: 0, tilt: 0, tuck: 0, nod: Math.sin(boss.t * 2) * 0.06, tongue: 0.7, flutter: 0 };
  let yaw = Math.atan2(player.pos.x - bp.x, player.pos.z - bp.z) * 0.7;
  if (a) {
    a.t += dt;
    const p = a.dur ? Math.min(1, a.t / a.dur) : 0;
    if (a.kind === 'hop') {
      if (p < 0.18) { const k = p / 0.18; P.sy = 1 - 0.22 * Math.sin(k * Math.PI / 2); P.tuck = 0.25 * k; P.lean = 0.12 * k; }                              // crouch
      else if (p < 0.82) {                                                                                                                               // airborne
        const k = (p - 0.18) / 0.64;
        bp.x = a.x0 + (a.x1 - a.x0) * (k * k * (3 - 2 * k)); P.lift = a.h * 4 * k * (1 - k);
        P.sy = 1.13 - 0.13 * Math.min(1, k * 2); P.tuck = 0.95 * Math.sin(Math.min(1, k * 1.6) * Math.PI / 2) * (1 - 0.4 * k); P.lean = 0.2 - 0.3 * k;
        P.tilt = -(a.x1 - a.x0) * 0.025 * Math.sin(k * Math.PI); P.flutter = k < 0.5 ? -0.25 : 0.3; P.nod = -0.2 * (1 - k);
      } else { if (!a.landed) { a.landed = true; sfx('bossLand'); } const k = (p - 0.82) / 0.18; bp.x = a.x1; P.sy = 1 - 0.24 * Math.sin(k * Math.PI); P.tuck = 0.3 * (1 - k); P.lean = 0.15 * (1 - k); P.nod = 0.25 * Math.sin(k * Math.PI); } // landing squash
    } else if (a.kind === 'throw') {
      if (p < 0.22) { const k = p / 0.22; P.sy = 1 - 0.26 * Math.sin(k * Math.PI / 2); P.lean = -0.5 * k; P.tuck = 0.3 * k; P.nod = -0.3 * k; P.tongue = 1.2; }   // crouch and wind up, leaning back
      else if (p < 0.88) {
        const rise = Math.min(1, (p - 0.22) / (a.rel - 0.22)), fall = p > a.rel ? (p - a.rel) / (0.88 - a.rel) : 0;
        P.lift = a.h * (p <= a.rel ? Math.sin(rise * Math.PI / 2) : Math.cos(fall * Math.PI / 2));
        P.sy = 1.15 - 0.12 * fall; P.tuck = 0.5 + 0.5 * Math.sin(rise * Math.PI / 2) - 0.5 * fall;
        P.lean = p <= a.rel ? -0.5 + 1.0 * rise : 0.5 * (1 - fall); P.nod = p <= a.rel ? -0.3 + 0.7 * rise : 0.4 * (1 - fall);
        P.flutter = p <= a.rel ? -0.3 : 0.4; P.tongue = 1.4;
        if (p >= a.rel && !a.released) { a.released = true; spawnRock(a.rock); }                                                                            // the rock leaves his hands at the top of the jump
      } else { if (!a.landed) { a.landed = true; sfx('bossLand'); } const k = (p - 0.88) / 0.12; P.sy = 1 - 0.3 * Math.sin(k * Math.PI); P.tuck = 0.3 * (1 - k); P.nod = 0.3 * Math.sin(k * Math.PI); }                // heavy landing
    } else if (a.kind === 'stun') {
      yaw = boss.t * 9; P.sy = 1 + Math.sin(a.t * 18) * 0.08; P.lean = Math.sin(a.t * 12) * 0.2; P.lift = Math.abs(Math.sin(a.t * 6)) * 0.35; P.nod = Math.sin(a.t * 10) * 0.3; P.tongue = 1.6; P.flutter = 0.3;
    }
    if (a.dur && a.t >= a.dur) { boss.act = null; boss.idleT = 0.12 + Math.random() * 0.35; }
  }
  bp.y = P.lift;
  boss.root.rotation.set(P.lean, yaw, P.tilt);
  if (boss.model) { const sxz = 1 / Math.sqrt(P.sy); boss.model.scale.set(boss.baseScale * sxz, boss.baseScale * P.sy, boss.baseScale * sxz); }
  if (boss.anim) boss.anim.update(P, boss.t);
  boss.root.visible = boss.flash > 0 ? Math.floor(boss.t * 20) % 2 === 0 : true;
  bossShadow.visible = true; bossShadow.position.set(bp.x, 0.03, bp.z); bossShadow.scale.setScalar(Math.max(0.5, 1 - P.lift * 0.14) * 1.6);   // shadow shrinks as he jumps

  // rocks
  bigRockMat.emissive.setHex(Math.floor(boss.t * 6) % 2 ? 0xcc5500 : 0x662200);
  for (let i = boss.rocks.length - 1; i >= 0; i--) {
    const rk = boss.rocks[i];
    if (!rk) continue;                       // the final blow clears the whole list mid-loop
    const mp = rk.mesh.position;
    let gone = false;
    if (rk.kind === 'returning') {                 // a big rock you knocked back: homes in on Ripper Roo
      mp.z -= 26 * dt; mp.x += (bp.x - mp.x) * Math.min(1, 7 * dt); rk.mesh.rotation.x -= dt * 14;
      if (mp.z <= bp.z + 2.2) { hitBoss(); gone = true; }
    } else {
      mp.z += rk.speed * dt; mp.x += (rk.tx - mp.x) * Math.min(1, 2.2 * dt); rk.mesh.rotation.x += rk.speed * dt / rk.r;
      if (mp.z > ARENA.z + 2) gone = true;
      const dx = mp.x - player.pos.x, dz = mp.z - player.pos.z, dist = Math.hypot(dx, dz), low = player.pos.y < rk.r * 2;
      const powered = player.spin > 0 || invincible > 0;
      if (rk.kind === 'big') {
        if (low && dist < rk.r + (powered ? 1.9 : 0.5)) {
          if (powered) { rk.kind = 'returning'; sfx('deflect'); toast('NICE HIT!'); }
          else { hit(); spawnDebris(mp); spawnBoom(mp, 1.2); gone = true; boss.bigT = 5; }
        }
      } else if (low && dist < rk.r + 0.5) {
        if (powered) sfx('rockSmash'); else hit();
        spawnDebris(mp); gone = true;
      }
    }
    if (gone) { scene.remove(rk.mesh); const at = boss.rocks.indexOf(rk); if (at >= 0) boss.rocks.splice(at, 1); }
  }
  // touching Ripper Roo hurts too (not while he is dizzy)
  if (fighting && boss.stun <= 0 && Math.hypot(bp.x - player.pos.x, bp.z - player.pos.z) < 1.7 && player.pos.y < 3.5 && bp.y < 1.2) hit();
}

// ---------- level 2: boulder chase ----------
const dangerEl = document.getElementById('danger');
function fadeThen(cb, ms = 1300) {          // fade to black, run cb (teleport etc.), fade back in
  state = 'transition'; uiLockUntil = performance.now() + 900; bossUI.fade.classList.add('on');
  setTimeout(() => { cb(); if (state === 'transition') state = 'play'; bossUI.fade.classList.remove('on'); }, ms);
}
function startChase() {
  toast('RIPPER ROO DEFEATED!'); sfx('victory'); music(null);
  fadeThen(() => {
    boss.active = false; boss.root.visible = false; bossShadow.visible = false; clearRocks(); bossUI.bar.hidden = true;
    chase.active = true; chase.stun = 0; chase.t = 0; chase.boulder.visible = true;
    checkpoint.set(0, 0, CHASE.z0 + 6); player.pos.set(0, 0, CHASE.z0 + 6); respawn(); player.hurt = 0;
    music('chase'); sfx('intro'); toast('LEVEL 2: RUN!');
  }, 2200);
}
function updateChase(dt) {
  const b = chase.boulder, R = CHASE.R, bp = b.position;
  chase.t += dt;
  const lead = player.pos.z - bp.z, progress = Math.min(1, Math.max(0, (player.pos.z - CHASE.z0) / CHASE.len));
  let v = 7.3 + progress * 0.9;                                  // a touch slower than Crash, and faster later on
  if (lead > 24) v += 2.5; else if (lead < 9) v -= 0.5;         // rubber band: never hopelessly far, never unfairly close
  if (chase.stun > 0) { chase.stun -= dt; v *= 0.15; }
  bp.z += v * dt; bp.y = R + Math.abs(Math.sin(chase.t * 6)) * 0.06; b.rotation.x += v * dt / R;
  if (invincible > 0 && lead < R) bp.z = player.pos.z - R;       // golden Aku Aku: the boulder can't touch you
  const danger = Math.max(0, Math.min(1, 1 - (lead - R) / 14));
  dangerEl.style.opacity = (danger * (0.6 + 0.4 * Math.sin(chase.t * 14))).toFixed(2);   // red edges pulse as it closes in
  setRumble(Math.max(0.15, danger));
  if (lead < R + 0.3 && player.pos.y < R * 1.7 && invincible <= 0 && player.hurt <= 0.5) {   // crushed
    const hadMask = masks > 0;
    sfx('boulderHit'); hit();
    if (hadMask && state === 'play') { bp.z = player.pos.z - R - 8; chase.stun = 1; }          // Aku Aku takes the hit and shoves the boulder back
  }
  if (chase.finish.position.distanceTo(tmp.set(player.pos.x, player.pos.y + 1, player.pos.z)) < 2) startCortex();
}

// ---------- the final boss: Dr. Neo Cortex ----------
function resetPads() {
  cortex.wantOpen = false; cortex.floorOpen = 0;
  for (const s of cortex.pads) { const p = s.pad; p.state = 'hidden'; p.top = -0.5; s.broken = false; s.mesh.visible = true; p.plate.material.color.setHex(0x66ffee); }
  updateTrapdoor(0);
}
function startCortex() {
  toast('LEVEL COMPLETE!'); sfx('portal'); music(null); setRumble(0);
  fadeThen(() => {
    chase.active = false; chase.boulder.visible = false; dangerEl.style.opacity = 0;
    Object.assign(cortex, { active: true, hp: CORTEX_HP, stage: 1, intro: 3.5, stun: 0, dead: 0, t: 0, act: null, idleT: 1, flash: 0, laugh: 0, recoil: 0, seq: null, seqPending: false, padTimer: 7, shootT: 1.5, rootX: 0, sweep: 0 });
    resetPads(); clearBlasts();
    cortex.platform.visible = true; cortex.platform.rotation.set(0, 0, 0); cortex.platform.position.set(0, 5.6, cortex.zp); cortex.root.visible = true; cortex.root.rotation.set(0, 0, 0);
    checkpoint.set(0, 0, ARENA2.z - 3); player.pos.set(0, 0, ARENA2.z - 3); respawn(); player.hurt = 0;
    setBossBar('DR. NEO CORTEX', CORTEX_HP, CORTEX_HP); bossUI.bar.hidden = false;
    music('cortex'); sfx('intro'); toast('DR. NEO CORTEX!'); cortexLaugh();
  });
}
function stagesReset() {                      // back to the very start of the game
  chase.active = false; chase.boulder.visible = false; dangerEl.style.opacity = 0; setRumble(0);
  cortex.active = false; cortex.dead = 0; cortex.seq = null; cortex.seqPending = false; clearBlasts(); resetPads(); cortex.root.visible = true; cortex.root.rotation.set(0, 0, 0);
  cortex.platform.rotation.set(0, 0, 0); cortex.platform.position.set(0, 5.6, cortex.zp);
}
function cortexLaugh() { sfx('laugh'); cortex.laugh = 1.3; }
function clearBlasts() { for (const b of cortex.blasts) scene.remove(b.mesh); cortex.blasts.length = 0; }

function makeRayGun() {                       // Cortex's ray gun (built from simple shapes, since the model has no gun)
  const g = new THREE.Group();
  const dark = new THREE.MeshLambertMaterial({ color: 0x3b4650, emissive: 0x151a1f }), metal = new THREE.MeshLambertMaterial({ color: 0x8a96a3, emissive: 0x20262c });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.55), dark); body.position.z = 0.15; g.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.55, 8), metal); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, 0.62); g.add(barrel);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.14), dark); grip.position.y = -0.2; g.add(grip);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x66ff66 })); tip.position.set(0, 0.02, 0.92); g.add(tip);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, 0.95); g.add(muzzle);
  g.userData = { tip, muzzle }; return g;
}
async function onCortexModel(gltf) {
  const parts = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o => { if (o.isMesh) parts.push(o); });
  const inner = new THREE.Group();
  for (const o of parts) {
    const map = o.material.map;
    if (map) { map.colorSpace = THREE.SRGBColorSpace; map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestMipmapLinearFilter; map.anisotropy = 8; }
    o.material = new THREE.MeshLambertMaterial({ map, side: THREE.DoubleSide, emissive: 0x222222 });
    o.geometry.applyMatrix4(o.matrixWorld);                    // bake the pose into the vertices so the parts can be bent
    o.removeFromParent(); o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.frustumCulled = false; inner.add(o);
  }
  const box = new THREE.Box3().setFromObject(inner), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  inner.position.set(-c.x, -box.min.y, -c.z);
  const gun = makeRayGun(); inner.add(gun);
  const wrap = new THREE.Group(); wrap.add(inner); wrap.scale.setScalar(5.6 / size.y);   // faces +Z, toward the player
  cortex.model = wrap; cortex.gun = gun; cortex.baseScale = 5.6 / size.y; cortex.anim = makeCortexAnimator(parts); cortex.root.add(wrap);
}
// One rigid mesh: weight each vertex by where it is (legs low, head high, arms out at the sides) and bend those parts each frame.
function makeCortexAnimator(parts) {
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const X1 = new THREE.Vector3(1, 0, 0), XN = new THREE.Vector3(-1, 0, 0), Z1 = new THREE.Vector3(0, 0, 1);
  const v = new THREE.Vector3(), SR = new THREE.Vector3(0.34, 0.95, 0.4), SL = new THREE.Vector3(-0.34, 0.95, 0.4), HEAD = new THREE.Vector3(0, 1.55, 0.3);
  const qA = new THREE.Quaternion(), qB = new THREE.Quaternion(), qGun = new THREE.Quaternion(), qLev = new THREE.Quaternion(), qFlap = new THREE.Quaternion(), qHead = new THREE.Quaternion(), eul = new THREE.Euler();
  const tipRest = new THREE.Vector3(1, 0.85, 0.4);
  let bestX = -1;
  const data = parts.map(o => {
    const pos = o.geometry.attributes.position, n = pos.count, rest = Float32Array.from(pos.array);
    const leg = new Float32Array(n), head = new Float32Array(n), arm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = rest[i * 3], y = rest[i * 3 + 1];
      leg[i] = 1 - sstep(0.45, 0.75, y); head[i] = sstep(1.4, 1.7, y);
      arm[i] = sstep(0.42, 0.62, Math.abs(x)) * (1 - sstep(1.3, 1.55, y));
      if (x > bestX && arm[i] > 0.9) { bestX = x; tipRest.set(x, y, rest[i * 3 + 2]); }
    }
    return { pos, rest, leg, head, arm, n };
  });
  const out = { dir: new THREE.Vector3(), tip: new THREE.Vector3() };
  function update(P, t) {
    qA.setFromUnitVectors(X1, P.aimDir); qGun.set(0, 0, 0, 1).slerp(qA, P.aim);
    qFlap.setFromAxisAngle(Z1, Math.sin(t * 2.2) * 0.1 * (1 - P.aim)); qGun.premultiply(qFlap);
    qB.setFromUnitVectors(XN, P.leverDir); qLev.set(0, 0, 0, 1).slerp(qB, P.lever);
    eul.set(P.nod, P.headYaw, P.headTilt); qHead.setFromEuler(eul);
    const cl = Math.cos(P.legSwing), sl = Math.sin(P.legSwing);
    for (const d of data) {
      const arr = d.pos.array;
      for (let i = 0; i < d.n; i++) {
        const x = d.rest[i * 3], y = d.rest[i * 3 + 1], z = d.rest[i * 3 + 2];
        let nx = x, ny = y, nz = z;
        const wa = d.arm[i];
        if (wa > 0) { v.set(x, y, z).sub(x > 0 ? SR : SL).applyQuaternion(x > 0 ? qGun : qLev).add(x > 0 ? SR : SL); nx += (v.x - x) * wa; ny += (v.y - y) * wa; nz += (v.z - z) * wa; }
        const wl = d.leg[i];
        if (wl > 0) { const s = x > 0 ? 1 : -1, c2 = cl, s2 = sl * s, dy = y - 0.6, dz = z - 0.05; ny += (0.6 + dy * c2 - dz * s2 - y) * wl; nz += (0.05 + dy * s2 + dz * c2 - z) * wl; }   // legs dangle and kick, alternately
        const wh = d.head[i];
        if (wh > 0) { v.set(x, y, z).sub(HEAD).applyQuaternion(qHead).add(HEAD); nx += (v.x - x) * wh; ny += (v.y - y) * wh; nz += (v.z - z) * wh; }
        arr[i * 3] = nx; arr[i * 3 + 1] = ny; arr[i * 3 + 2] = nz;
      }
      d.pos.needsUpdate = true;
    }
    out.dir.copy(X1).applyQuaternion(qGun); out.tip.copy(tipRest).sub(SR).applyQuaternion(qGun).add(SR);   // where the gun hand ended up
  }
  return { update, out };
}
loadGlb(window.__CORTEX_B64, './assets/dr_neo_cortex.glb', onCortexModel, () => {});

const blastGeo = new THREE.SphereGeometry(0.45, 12, 8);
// green zaps just hurt (dodge them); golden zaps are the ones you can spin back at him
const blastMat = new THREE.MeshBasicMaterial({ color: 0x77ff66 }), blastGlow = new THREE.MeshBasicMaterial({ color: 0x33ff33, transparent: true, opacity: 0.35 });
const goldMat = new THREE.MeshBasicMaterial({ color: 0xffd84a }), goldGlow = new THREE.MeshBasicMaterial({ color: 0xffb300, transparent: true, opacity: 0.4 }), blastBack = new THREE.MeshBasicMaterial({ color: 0xffe066 });
const gunPt = new THREE.Vector3(), hitPt = new THREE.Vector3();
function fireBlast(gold = false) {
  const c = cortex; if (!c.gun) return;
  c.gun.userData.muzzle.getWorldPosition(gunPt);
  const dir = new THREE.Vector3(player.pos.x - gunPt.x, player.pos.y + 0.9 - gunPt.y, player.pos.z - gunPt.z).normalize();
  const mesh = new THREE.Mesh(blastGeo, gold ? goldMat : blastMat), glow = new THREE.Mesh(blastGeo, gold ? goldGlow : blastGlow); glow.scale.setScalar(gold ? 2.3 : 1.9); mesh.add(glow);
  mesh.scale.setScalar(gold ? 1.3 : 1);
  mesh.position.copy(gunPt); scene.add(mesh);
  c.blasts.push({ mesh, vel: dir.multiplyScalar(c.stage === 2 ? 14 : 11), kind: 'shot', gold, life: 4 });
  sfx('zap'); c.recoil = 0.3;
  if (gold && !c.goldTold) { c.goldTold = true; toast('SPIN THE GOLD ZAPS BACK AT HIM!'); }
}
function cortexHit() {
  const c = cortex;
  c.hp--; c.stun = 1.6; c.flash = 1.4; c.act = null; c.shootT = 1.4;
  setBossBar('DR. NEO CORTEX', CORTEX_HP, c.hp); sfx('bossHit');
  c.root.getWorldPosition(hitPt); hitPt.y += 2.2; spawnBoom(hitPt, 1.6); spawnDebris(hitPt);
  if (c.hp <= 0) { c.dead = 0.001; clearBlasts(); toast('DR. NEO CORTEX IS DEFEATED!'); }
  else if (c.hp === CORTEX_HP / 2 && c.stage === 1) { c.seqPending = true; clearBlasts(); toast('HE REACHES FOR THE LEVER...'); }
  else toast(`DR. NEO CORTEX LOSES A LIFE! ${c.hp} LEFT`);
}
function updateTrapdoor(dt) {                 // the floor is two trap-door halves; four pads rise out of it, and in stage two they collapse one by one
  const c = cortex, tgt = c.wantOpen ? 1 : 0;
  c.floorOpen += Math.sign(tgt - c.floorOpen) * Math.min(Math.abs(tgt - c.floorOpen), dt / 1.2);
  for (const f of c.floor) { f.mesh.position.x = f.side * (ARENA2.w / 4 + c.floorOpen * (ARENA2.w / 2 + 1)); syncBox(f); }
  for (const s of c.pads) {
    const p = s.pad;
    if (p.state === 'rising') { p.t += dt / 1.4; const k = Math.min(1, p.t); p.top = -0.5 + 1.4 * (k * k * (3 - 2 * k)); if (k >= 1) p.state = 'up'; }
    else if (p.state === 'warn') { p.t += dt; p.plate.material.color.setHex(Math.floor(p.t * 10) % 2 ? 0xff3322 : 0xffcc22); if (p.t > 1.5) { p.state = 'sunk'; p.t = 0; s.broken = true; s.mesh.visible = false; sfx('padCollapse'); } }
    else if (p.state === 'sunk') { p.t += dt; if (p.t > 3.2) { p.state = 'regrow'; p.t = 0; s.broken = false; s.mesh.visible = true; p.top = -0.5; p.plate.material.color.setHex(0x66ffee); } }
    else if (p.state === 'regrow') { p.t += dt / 0.9; const k = Math.min(1, p.t); p.top = -0.5 + 1.4 * k; if (k >= 1) p.state = 'up'; }
    s.mesh.position.y = p.top - p.H / 2; syncBox(s);
  }
  if (dt > 0 && c.active && c.stage === 2 && c.dead === 0 && !c.seq) {
    c.padTimer -= dt;
    if (c.padTimer <= 0) { const up = c.pads.filter(s => s.pad.state === 'up'); if (up.length > 2) { const s = up[(Math.random() * up.length) | 0]; s.pad.state = 'warn'; s.pad.t = 0; toast('A PLATFORM IS FALLING!'); } c.padTimer = 6; }
  }
}
const cortexP = { aim: 0.45, aimDir: new THREE.Vector3(0.55, -0.6, 0.6).normalize(), lever: 0, leverDir: new THREE.Vector3(-0.8, 0.3, 0.4).normalize(), headYaw: 0, headTilt: 0, nod: 0, legSwing: 0 };
const idleAim = new THREE.Vector3(0.55, -0.6, 0.6).normalize(), leverUp = new THREE.Vector3(-0.8, 0.5, 0.4).normalize(), leverDown = new THREE.Vector3(-0.6, -0.7, 0.4).normalize(), toPlayer = new THREE.Vector3();
function updateCortex(dt) {
  const c = cortex, plat = c.platform, wp = plat.position, P = cortexP;
  c.t += dt;
  updateTrapdoor(dt);
  if (c.intro > 0) c.intro -= dt;
  // ---- defeated: the platform fails, he tumbles off in a fireball, then the game is won ----
  if (c.dead > 0) {
    c.dead += dt; wp.y -= dt * (1 + c.dead * 2.5); plat.rotation.z += dt * 0.8; c.root.rotation.y += dt * 12; c.root.rotation.z += dt * 3;
    if (Math.random() < dt * 12) { c.root.getWorldPosition(hitPt); hitPt.x += (Math.random() - 0.5) * 3; hitPt.y += 1 + Math.random() * 3; spawnBoom(hitPt, 0.8 + Math.random()); }
    if (c.dead > 3 && state === 'play') {
      c.active = false; bossUI.bar.hidden = true; plat.visible = false; state = 'won'; uiLockUntil = performance.now() + 900; music(null); sfx('victory');
      showMsg('YOU DEFEATED DR. NEO CORTEX!', `You beat the game!<br>Fruit: ${fruitCount} &nbsp; Crates: ${cratesBroken}/${totalCrates} &nbsp; Lives: ${lives}<br>Press <kbd>Enter</kbd> or tap the button to play again`, 'PLAY AGAIN');
    }
    return;
  }
  c.flash = Math.max(0, c.flash - dt); c.laugh = Math.max(0, c.laugh - dt); c.recoil = Math.max(0, c.recoil - dt);
  if (c.stun > 0) c.stun -= dt;
  if (c.seqPending && c.stun <= 0 && !c.seq) { c.seq = { t: 0, lever: false, rose: false, opened: false }; c.seqPending = false; c.act = null; toast('HE PULLED THE LEVER!'); }
  const fighting = c.intro <= 0 && !c.seq;
  // ---- hover platform sweeps side to side; holds still while he is dizzy or at the lever ----
  if (c.stun <= 0 && !c.seq) c.sweep += dt * (c.stage === 2 ? 0.85 : 0.6);
  wp.x = Math.sin(c.sweep) * 7; wp.y = 5.6 + Math.sin(c.t * 2) * 0.18;
  plat.rotation.z = c.stun > 0 ? Math.sin(c.t * 30) * 0.04 : Math.cos(c.sweep) * 0.05;
  c.rootX += ((c.seq ? -2.1 : 0) - c.rootX) * (1 - Math.exp(-4 * dt)); c.root.position.x = c.rootX; c.root.position.y = 0.45 + Math.sin(c.t * 4) * 0.05;
  // ---- lever / trap-door / pads sequence ("stage two") ----
  let leverK = c.stage === 2 ? 1 : 0;
  if (c.seq) {
    const s = c.seq; s.t += dt;
    leverK = Math.max(0, Math.min(1, (s.t - 1.0) / 0.5));
    if (!s.lever && s.t > 1.5) { s.lever = true; sfx('lever'); }
    if (!s.rose && s.t > 1.9) { s.rose = true; for (const p of c.pads) { p.pad.state = 'rising'; p.pad.t = 0; } sfx('alarm'); sfx('padRise'); toast('GET ON A PLATFORM!'); }
    if (!s.opened && s.t > 4.7) { s.opened = true; c.wantOpen = true; sfx('trapdoor'); const p0 = c.pads[0].pad; checkpoint.set(p0.x, 0.9, p0.z); }   // from now on you respawn on a pad
    if (s.t > 6.2) { c.seq = null; c.stage = 2; c.shootT = 1.2; c.padTimer = 7; toast('STAGE 2! KEEP MOVING!'); cortexLaugh(); }
  }
  c.lever.rotation.z = -0.6 + 1.2 * leverK;
  // ---- ray gun: charge, fire, recoil ----
  if (fighting && c.stun <= 0 && !c.act) { c.shootT -= dt; if (c.shootT <= 0) { c.shotN = (c.shotN || 0) + 1; const gold = c.shotN % 3 === 0; c.act = { kind: 'shoot', t: 0, dur: c.stage === 2 ? 1.0 : 1.3, fired: 0, gold, shots: !gold && c.stage === 2 && Math.random() < 0.45 ? 2 : 1 }; } }
  P.aim = 0.45; P.aimDir.copy(idleAim); P.lever = leverK > 0 ? 1 : 0; let charge = 0, squash = 1, lean = 0;
  const a = c.act;
  if (a && a.kind === 'shoot' && c.stun <= 0) {
    a.t += dt; const p = a.t / a.dur;
    if (c.gun) { c.gun.userData.muzzle.getWorldPosition(gunPt); toPlayer.set(player.pos.x - gunPt.x, player.pos.y + 0.9 - gunPt.y, player.pos.z - gunPt.z).normalize(); }
    const k = Math.min(1, p / 0.35); P.aim = 0.45 + 0.55 * k * k * (3 - 2 * k); P.aimDir.copy(idleAim).lerp(toPlayer, k).normalize();   // he lifts the gun and tracks you
    charge = Math.min(1, p / 0.5);
    if (a.fired === 0 && p >= 0.5) { fireBlast(a.gold); a.fired = 1; }
    if (a.shots === 2 && a.fired === 1 && p >= 0.72) { fireBlast(); a.fired = 2; }
    if (p >= 1) { c.act = null; c.shootT = (c.stage === 2 ? 0.8 : 1.4) * (0.8 + Math.random() * 0.5); }
  } else if (c.stun > 0) c.act = null;
  if (c.recoil > 0) { P.aimDir.y += c.recoil * 1.6; P.aimDir.normalize(); lean = -0.18 * (c.recoil / 0.3); squash = 1 + 0.06 * (c.recoil / 0.3); }
  if (c.seq) { const s = c.seq; P.aimDir.copy(idleAim); P.aim = 0.3; P.leverDir.copy(leverUp).lerp(leverDown, Math.min(1, Math.max(0, (s.t - 1.0) / 0.5))).normalize(); P.lever = Math.min(1, s.t / 0.9); lean = 0.15 * P.lever; }
  squash *= 1 - 0.07 * charge;
  // ---- head + legs ----
  c.root.getWorldPosition(hitPt);
  const look = Math.atan2(player.pos.x - hitPt.x, 12) * 0.9;
  P.headYaw = c.stun > 0 ? Math.sin(c.t * 18) * 0.9 : c.laugh > 0 ? Math.sin(c.t * 24) * 0.45 * Math.min(1, c.laugh) : look;
  P.headTilt = c.stun > 0 ? Math.sin(c.t * 13) * 0.3 : Math.sin(c.t * 1.3) * 0.06;
  P.nod = c.laugh > 0 ? Math.sin(c.t * 24) * 0.25 : charge * 0.2 + Math.sin(c.t * 2) * 0.04;
  P.legSwing = c.stun > 0 ? Math.sin(c.t * 14) * 0.7 : Math.sin(c.t * 3) * 0.3;
  c.root.rotation.set(lean, 0, 0);
  if (cortex.model) { const sxz = 1 / Math.sqrt(squash); cortex.model.scale.set(cortex.baseScale * sxz, cortex.baseScale * squash, cortex.baseScale * sxz); }
  if (c.anim) {
    c.anim.update(P, c.t);
    c.gun.position.copy(c.anim.out.tip); c.gun.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), c.anim.out.dir);
    const tip = c.gun.userData.tip; tip.scale.setScalar(1 + charge * 1.6 + c.recoil * 2); const goldShot = c.act && c.act.gold; tip.material.color.setHex(goldShot && charge > 0 ? (Math.floor(c.t * 14) % 2 ? 0xfff3b0 : 0xffc400) : Math.floor(c.t * 14) % 2 && charge > 0 ? 0xeaffea : 0x66ff66);   // the gun glows gold when a returnable zap is coming
  }
  c.root.visible = c.flash > 0 ? Math.floor(c.t * 20) % 2 === 0 : true;
  // ---- ray blasts ----
  for (let i = c.blasts.length - 1; i >= 0; i--) {
    const b = c.blasts[i]; if (!b) continue;
    const bp = b.mesh.position; let gone = false;
    if (b.kind === 'returning') {                                  // knocked back: homes in on Cortex
      c.root.getWorldPosition(hitPt); hitPt.y += 2.2;
      b.vel.copy(hitPt).sub(bp).setLength(22); bp.addScaledVector(b.vel, dt);
      if (bp.distanceTo(hitPt) < 2.4) { cortexHit(); gone = true; }
    } else {
      bp.addScaledVector(b.vel, dt); b.life -= dt;
      const dist = Math.hypot(bp.x - player.pos.x, bp.y - (player.pos.y + 0.9), bp.z - player.pos.z), powered = player.spin > 0 || invincible > 0;
      if (b.gold && (player.spin > 0 || invincible > 0) && dist < 2.2) { b.kind = 'returning'; b.mesh.material = blastBack; sfx('deflect'); toast('NICE HIT!'); }   // golden zaps can be knocked back
      else if (dist < 0.95) {
        if (invincible > 0) { spawnBoom(bp, 0.6); sfx('rockSmash'); gone = true; }                                  // golden Aku Aku: green zaps just fizzle
        else { hit(); spawnBoom(bp, 0.8); cortexLaugh(); gone = true; }                                              // green zaps always hurt, even if you spin
      } else if (b.life <= 0 || bp.y < -12 || bp.z > ARENA2.z + 12 || (bp.y < 0.15 && c.floorOpen < 0.4 && c.pads.every(s => s.broken || s.pad.top < 0.2))) gone = true;
    }
    if (gone) { scene.remove(b.mesh); const at = c.blasts.indexOf(b); if (at >= 0) c.blasts.splice(at, 1); }
  }
}

// ---------- physics ----------
const STEP_SMALL = 0.35;  // lips this low are stepped over automatically
const STEP_UP = 0.75;   // how tall a lip you can walk onto without jumping (ramps are walked up smoothly)
// Crash's collision is a flat disc at his feet (like the original trilogy), not a box: the corners are round, so he slides around
// crates, walls and ledge corners instead of catching on them.
const clampTo = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
function overlaps(s, p) {
  if (!(p.y + PLAYER_H > s.min.y && p.y < s.max.y)) return false;
  const dx = p.x - clampTo(p.x, s.min.x, s.max.x), dz = p.z - clampTo(p.z, s.min.z, s.max.z);   // distance from the disc's centre to the solid's footprint
  return dx * dx + dz * dz < HALF_W * HALF_W;
}
function moveAxis(axis, amount) {
  player.pos[axis] += amount;
  for (const s of solids) {
    if (s.broken) continue;           // smashed this frame; removed from the list at the start of the next update
    const p = player.pos;
    if (s.ramp) {
      if (!(p.x + HALF_W > s.min.x && p.x - HALF_W < s.max.x && p.z + HALF_W > s.min.z && p.z - HALF_W < s.max.z)) continue;
      const surf = rampY(s, p.z);
      if (!(p.y < surf - 1e-4)) continue;
      if (axis === 'y') { if (amount <= 0) { p.y = surf; player.grounded = true; player.ground = s; if (player.vel.y < 0) player.vel.y = 0; } }
      else if (surf - p.y <= STEP_UP) { p.y = surf; player.grounded = true; player.ground = s; }   // walk up the slope
      else p[axis] -= amount;                                                                    // too steep: blocked
      continue;
    }
    if (!overlaps(s, p)) continue;
    if (axis === 'y') {
      if (amount <= 0) {
        p.y = s.max.y; player.grounded = true; player.ground = s;
        if (player.vel.y < -3 && s.crate) { breakCrate(s, true); }   // a real landing, not just standing on it at a low frame rate
        if (player.vel.y < 0) player.vel.y = 0;
      } else { p.y = s.min.y - PLAYER_H; player.vel.y = 0; }
    } else if (!s.crate && s.max.y - p.y <= STEP_SMALL) {
      p.y = s.max.y; player.grounded = true; player.ground = s;                         // tiny lips never stop you
    } else {
      const cx = clampTo(p.x, s.min.x, s.max.x), cz = clampTo(p.z, s.min.z, s.max.z), dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      if (d > 1e-5) { const r = HALF_W + 0.002; p.x = cx + dx / d * r; p.z = cz + dz / d * r; }   // (a hair extra, so rounding can never leave the disc 'inside' and mistake the push for a landing)       // push the disc out along the surface normal: it slides around corners
      else {                                                                          // centre is inside the footprint (e.g. carried into a wall): push out the way we came, or to the nearest side
        const toMin = s.min[axis] - HALF_W, toMax = s.max[axis] + HALF_W;
        p[axis] = amount > 0 ? toMin : amount < 0 ? toMax : (p[axis] - toMin < toMax - p[axis] ? toMin : toMax);
      }
    }
  }
}
// stay glued to a slope when walking downhill instead of skipping off it
function snapToRamp() {
  const p = player.pos; let best = null, bestY = -Infinity;
  for (const s of solids) {
    if (s.broken || !s.ramp || !(p.x + HALF_W > s.min.x && p.x - HALF_W < s.max.x && p.z + HALF_W > s.min.z && p.z - HALF_W < s.max.z)) continue;
    const surf = rampY(s, p.z), gap = p.y - surf;
    if (gap >= 0 && gap < 0.7 && surf > bestY) { best = s; bestY = surf; }
  }
  if (best) { p.y = bestY; player.grounded = true; player.ground = best; if (player.vel.y < 0) player.vel.y = 0; }
}

const removeQueue = [];
const tmp = new THREE.Vector3();
function update(dt) {
  time += dt;
  if (removeQueue.length) { for (const c of removeQueue) { const i = solids.indexOf(c); if (i >= 0) solids.splice(i, 1); } removeQueue.length = 0; }
  // moving platforms
  for (const s of movers) {
    const m = s.mover, old = s.mesh.position[m.axis];
    s.mesh.position[m.axis] = m.origin + Math.sin(time * m.speed) * m.range;
    s.delta = s.mesh.position[m.axis] - old; syncBox(s);
  }
  for (const c of crates) if (c.armed && !c.broken) {
    c.timer -= dt;
    if (Math.ceil(c.timer) < c.tick && c.timer > 0) { c.tick = Math.ceil(c.timer); sfx('tick'); }   // one tick per second
    c.label.material.map = countdownTex[Math.max(0, Math.min(2, Math.ceil(c.timer) - 1))];
    c.mesh.material.emissive.setHex(Math.floor(c.timer * 6) % 2 ? 0xaa1100 : 0x000000);
    if (c.timer <= 0) explodeTnt(c);
  }
  for (let i = booms.length - 1; i >= 0; i--) {
    const b = booms[i]; b.userData.life -= dt; b.scale.setScalar(1 + (0.5 - b.userData.life) * 7); b.material.opacity = Math.max(0, b.userData.life * 1.7);
    if (b.userData.life <= 0) { scene.remove(b); b.geometry.dispose(); b.material.dispose(); booms.splice(i, 1); }
  }
  for (let i = pops.length - 1; i >= 0; i--) {
    const s = pops[i], u = s.userData; u.life -= dt; u.v.y -= 14 * dt; s.position.addScaledVector(u.v, dt);
    if (u.life <= 0) { scene.remove(s); pops.splice(i, 1); }
  }
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i], u = d.userData;
    u.life -= dt; u.v.y -= 20 * dt; d.position.addScaledVector(u.v, dt); d.rotation.x += dt * 8; d.rotation.z += dt * 6;
    if (u.life <= 0) { scene.remove(d); debris.splice(i, 1); }
  }
  if (state !== 'play') return;

  // input
  const ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  const iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
  tmp.set(ix, 0, iz); if (tmp.lengthSq() > 1) tmp.normalize();
  const accel = player.grounded ? 12 : 6, k = 1 - Math.exp(-accel * dt);
  player.vel.x += (tmp.x * SPEED - player.vel.x) * k;
  player.vel.z += (tmp.z * SPEED - player.vel.z) * k;
  if (tmp.lengthSq() > 0.01) player.facing = Math.atan2(tmp.x, tmp.z);

  // jump
  player.coyote = player.grounded ? COYOTE : player.coyote - dt;
  player.jumpBuf -= dt; player.spinCd -= dt; player.hurt -= dt;
  if (invincible > 0) { const was = Math.ceil(invincible); invincible = Math.max(0, invincible - dt); if (Math.ceil(invincible) !== was) updateHud(); }
  if (player.jumpBuf > 0 && player.coyote > 0) {
    player.vel.y = JUMP_V; player.coyote = 0; player.jumpBuf = 0; player.grounded = false; sfx('jump');
  }
  if (!(keys.Space || keys.KeyK) && player.vel.y > 4) player.vel.y -= 40 * dt; // variable jump height
  player.vel.y = Math.max(player.vel.y - GRAVITY * dt, -30);   // terminal velocity: never fast enough to tunnel a 1-unit crate

  // ride moving platform
  const ground = player.ground;
  if (player.grounded && ground && ground.delta) player.pos[ground.mover.axis] += ground.delta;

  const wasGrounded = player.grounded, vyBefore = player.vel.y;
  player.grounded = false; player.ground = null;
  moveAxis('x', player.vel.x * dt);
  moveAxis('z', player.vel.z * dt);
  moveAxis('y', player.vel.y * dt);
  if (!player.grounded && wasGrounded && player.vel.y <= 0.01) snapToRamp();
  if (player.grounded && !wasGrounded && vyBefore < -8) sfx('land');   // a proper landing makes a thud

  // spin
  if (player.spin > 0) {
    player.spin -= dt; if (player.spin <= 0) player.spinCd = SPIN_COOLDOWN;
    for (const c of crates.slice()) {
      if (c.broken) continue;
      if (Math.hypot(c.mesh.position.x - player.pos.x, c.mesh.position.z - player.pos.z) < 2.5 &&
          c.mesh.position.y > player.pos.y - 0.6 && c.mesh.position.y < player.pos.y + PLAYER_H + 0.5) breakCrate(c, false);
    }
  }

  // fruit
  for (const f of fruits) {
    if (f.got) continue;
    f.mesh.position.y = f.baseY + Math.sin(time * 3 + f.baseY) * 0.08;
    if (f.mesh.position.distanceTo(tmp.set(player.pos.x, player.pos.y + 0.9, player.pos.z)) < 0.9) {
      f.got = true; f.mesh.visible = false; addFruit(1); sfx('fruit');
    }
  }
  // enemies
  for (const e of enemies) {
    if (!e.alive) continue;
    e.t += dt; e.mesh.position[e.axis] = e.origin[e.axis] + Math.sin(e.t * 1.6) * e.range;
    const dx = e.mesh.position.x - player.pos.x, dz = e.mesh.position.z - player.pos.z, dy = e.mesh.position.y - (player.pos.y + 0.5);
    if (dx * dx + dz * dz < 0.8 && Math.abs(dy) < 1.2) {
      const stomp = player.vel.y < 0 && player.pos.y > e.mesh.position.y - 0.1;
      if (player.spin > 0 || stomp || invincible > 0) {
        e.alive = false; e.mesh.visible = false; sfx('squish');
        if (stomp && player.spin <= 0) { player.vel.y = JUMP_V * 0.8; }
        addFruit(2);
      } else hit();
    }
  }
  // spikes
  for (const s of spikes) {
    if (Math.hypot(s.pos.x - player.pos.x, s.pos.z - player.pos.z) < 0.85 &&
        player.pos.y < s.pos.y + 0.6 && player.pos.y + PLAYER_H > s.pos.y) hit();
  }
  if (boss.active) updateBoss(dt);
  if (chase.active) updateChase(dt);
  if (cortex.active) updateCortex(dt);
  // fall
  if (player.pos.y < -10) die();
  // finish
  if (state === 'play' && !boss.active && !chase.active && !cortex.active && finish.position.distanceTo(tmp.set(player.pos.x, player.pos.y + 1, player.pos.z)) < 1.8) startBoss();   // level done -> boss fight
}

// ---------- render loop ----------
const camTarget = new THREE.Vector3(), clock = new THREE.Clock();
let perfT = 0, perfN = 0;
function frame() {
  requestAnimationFrame(frame);          // schedule first: an error below can no longer freeze the game
  const raw = Math.min(clock.getDelta(), 0.2), dt = Math.min(raw, 0.05);
  // adaptive resolution: if the device can't hold ~45fps, drop the render scale a step (and raise it again when there's headroom)
  perfT += raw; perfN++;
  if (perfT > 2) {
    const avg = perfT / perfN; perfT = perfN = 0;
    if (avg > 1 / 42 && dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight); }
    else if (avg < 1 / 58 && dpr < DPR_MAX) { dpr = Math.min(DPR_MAX, dpr + 0.25); renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight); }
  }
  update(dt);

  playerRoot.position.copy(player.pos);
  // facing (smoothed) + spin
  modelHolder.userData.yaw ??= player.facing;
  const diff = Math.atan2(Math.sin(player.facing - modelHolder.userData.yaw), Math.cos(player.facing - modelHolder.userData.yaw));
  modelHolder.userData.yaw += diff * Math.min(1, dt * 14);
  const spinAngle = player.spin > 0 ? (1 - player.spin / SPIN_TIME) * Math.PI * 4 : 0;
  modelHolder.rotation.y = modelHolder.userData.yaw + spinAngle; // the model natively faces +Z
  const speed = Math.hypot(player.vel.x, player.vel.z);
  modelHolder.position.y = 0;
  animator?.update({ dt, time, speed: Math.min(1, speed / SPEED), grounded: player.grounded, vy: player.vel.y, spinning: player.spin > 0 });
  modelHolder.rotation.x = player.grounded ? -0.12 * Math.min(1, speed / SPEED) : -0.05;
  playerRoot.visible = player.hurt > 0 ? Math.floor(time * 20) % 2 === 0 : true;
  // blob shadow
  let sy = -Infinity;
  for (const s of solids) {
    if (s.broken) continue;
    const top = s.ramp ? rampY(s, player.pos.z) : s.max.y;
    if (player.pos.x + HALF_W > s.min.x && player.pos.x - HALF_W < s.max.x && player.pos.z + HALF_W > s.min.z && player.pos.z - HALF_W < s.max.z && top <= player.pos.y + 0.2) sy = Math.max(sy, top);
  }
  shadow.visible = sy > -Infinity; shadow.position.set(player.pos.x, sy + 0.02, player.pos.z);
  shadow.scale.setScalar(MODEL_SCALE * Math.max(0.4, 1 - (player.pos.y - sy) * 0.08));

  if (finish) { finish.rotation.z += dt; }
  // Aku Aku: floats at the player's shoulder looking where Crash is heading; while invincible he is worn on Crash's face like a mask
  const akuShow = masks > 0 || invincible > 0;
  if (akuShow && !aku.visible) aku.userData.init = false;   // newly summoned: appear beside Crash, don't fly in from the last place he was
  aku.visible = akuShow;
  const heading = modelHolder.userData.yaw ?? Math.PI;
  if (invincible > 0) {
    modelHolder.updateWorldMatrix(true, false);
    const face = modelHolder.localToWorld(akuFace.set(0, 2.15, 1.0));           // in front of the snout, at head height
    aku.position.lerp(face, 1 - Math.exp(-30 * dt));
    modelHolder.getWorldQuaternion(akuQuat); aku.quaternion.slerp(akuQuat, 1 - Math.exp(-30 * dt));
    aku.scale.setScalar(0.7 + Math.sin(time * 10) * 0.03);
  } else {
    const side = tmp.set(player.pos.x - 1.4, player.pos.y + 2.5 + Math.sin(time * 2.4) * 0.15, player.pos.z + 0.4);
    if (!aku.userData.init) { aku.position.copy(side); aku.userData.init = true; }
    aku.position.lerp(side, 1 - Math.exp(-8 * dt));
    aku.rotation.y = heading + Math.sin(time * 1.5) * 0.1;                         // faces the way Crash is going (model front is +Z)
    aku.rotation.x = aku.rotation.z = 0;
    aku.scale.setScalar(masks > 1 ? 1.1 : 1);
  }
  // tier look: 1 = normal, 2 = silver glow, golden (invincible) = gold tint + glow
  for (const mt of akuMats) {
    if (!mt.emissive) continue;
    if (invincible > 0) { mt.color.setHex(0xffd24a); mt.emissive.setHex(Math.floor(time * 10) % 2 ? 0xa87c00 : 0x7a5a00); }
    else if (masks > 1) { mt.color.setHex(0xdde6ff); mt.emissive.setHex(0x3a4a66); }
    else { mt.color.setHex(0xffffff); mt.emissive.setHex(0x2a2a2a); }
  }
  // camera
  // camera per stage: normal / boss arena / chase (in front of Crash, looking back at the boulder) / Cortex's lab
  const cam = chase.active ? { dx: 0.4, dy: 7.4, dz: 13, ly: 0.8, lz: -3 } : boss.active ? { dx: 0.4, dy: 5.8, dz: 11, ly: 1.8, lz: -9 } : cortex.active ? { dx: 0.4, dy: 6, dz: 11, ly: 3.2, lz: -9 } : { dx: 0.5, dy: 4.8, dz: 9.5, ly: 1.2, lz: -4 };
  camTarget.set(player.pos.x * cam.dx, Math.max(player.pos.y, -2) + cam.dy, player.pos.z + cam.dz);
  if (camSnap) { camera.position.copy(camTarget); camSnap = false; }
  else camera.position.lerp(camTarget, 1 - Math.exp(-6 * dt));
  camera.lookAt(player.pos.x * cam.dx, Math.max(player.pos.y, -2) + cam.ly, player.pos.z + cam.lz);

  renderer.render(scene, camera);
}
camera.position.set(0, 4.2, 8.5);
window.__game = { cortexHit, fireBlast, goldMat, chase, cortex, startChase, startCortex, audioStatus, sfx, finishPos: () => finish.position.toArray(), boss, spawnRock, startBoss, aku, camera, modelHolder, movers, uiLock: () => uiLockUntil, layout: () => LAYOUT, setCheckpoint: (x, y, z) => checkpoint.set(x, y, z), solids, spikes, setLives: n => { lives = n; updateHud(); }, masks: () => masks, giveMasks: n => { for (let i = 0; i < n; i++) { if (masks >= 2) { masks = 0; invincible = INVINCIBLE_TIME; } else masks++; } updateHud(); }, player, anim: () => animator, enemies, crates, state: () => state, setState: s => { state = s; } };
frame();
