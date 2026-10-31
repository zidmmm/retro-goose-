import * as THREE from 'three';
import { GLTFLoader } from './lib/loaders/GLTFLoader.js';
import { makeAnimator } from './animation.js';
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

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x4f7a52);
scene.fog = new THREE.Fog(0x4f7a52, 22, 85);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 110);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
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
  s.kind = kind; s.fruitCount = kind === 'normal' ? Math.max(1, fruitCount) : fruitCount; crates.push(s);   // a normal crate always holds at least one Wumpa
  if (kind === 'tnt') s.armed = false;
}
function fruit(x, y, z) {
  const m = new THREE.Sprite(M.fruit); m.scale.set(0.95, 0.85, 1);
  m.position.set(x, y, z); scene.add(m); fruits.push({ mesh: m, got: false, baseY: y });
}
function fruitLine(x, y, z0, z1, n) {
  for (let i = 0; i < n; i++) fruit(x, y, z0 + (z1 - z0) * i / (n - 1));
}
function enemy(x, y, z, axis, range) {
  const g = new THREE.Sprite(M.enemy); g.scale.set(1.5, 1.25, 1);
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
  platform(0, -83, -89, 8, 2.2);
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
  platform(0, z, LEVEL_END, 8); walls(z, LEVEL_END, 4);
  crate(0, 0, z - 1.5, 'checkpoint'); crate(-2.5, 0, z - 6, 'normal', 8); crate(2.5, 0, z - 6, 'normal', 8); crate(0, 0, z - 9, 'aku');
  enemy(0, 0, z - 12, 'x', 3); enemy(0, 0, z - 16, 'x', 3); enemy(0, 0, z - 20, 'x', 3);
  fruitLine(0, 0.9, z - 3, LEVEL_END + 5, 10);
  finish = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.25, 12, 32), M.portal);
  finish.position.set(0, 2, LEVEL_END + 6); scene.add(finish);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45, 24), M.portal); finish.add(disc);

  // scenery
  const water = new THREE.Mesh(new THREE.PlaneGeometry(500, -LEVEL_END + 300), M.water);
  water.rotation.x = -Math.PI / 2; water.position.set(0, -9, LEVEL_END / 2); scene.add(water);
  const span = -LEVEL_END + 20;
  for (let z = 14; z > LEVEL_END - 24; z -= 2.2) {                 // a thick bush canopy below the path hides the drop
    for (let k = 0; k < 4; k++) {
      const x = (Math.random() - 0.5) * 34, bs = 3.5 + Math.random() * 3, y = -3 - Math.random() * 5;
      const b = new THREE.Sprite(M.tree); b.scale.set(bs * 1.15, bs, 1); b.position.set(x, y, z + Math.random() * 2); scene.add(b);
    }
  }
  for (let i = 0; i < Math.round(-LEVEL_END * 0.9); i++) {          // big jungle plants either side of the trail
    const side = Math.random() < 0.5 ? -1 : 1, z = 10 - Math.random() * span, x = side * (6.5 + Math.random() * 16);
    const h = 5 + Math.random() * 6;
    const t = new THREE.Sprite(M.tree); t.scale.set(h * 1.15, h, 1); t.position.set(x, h / 2 - 1.8, z); scene.add(t);
  }
  for (let i = 0; i < Math.round(-LEVEL_END * 0.35); i++) {         // leafy bushes hugging the path edge, and flowers
    const side = Math.random() < 0.5 ? -1 : 1, z = 10 - Math.random() * span, x = side * (5.3 + Math.random() * 2.5);
    const bush = new THREE.Sprite(M.tree); const bs = 2 + Math.random() * 1.8; bush.scale.set(bs * 1.15, bs, 1); bush.position.set(x, bs / 2 - 0.3, z); scene.add(bush);
    const f = new THREE.Sprite(Math.random() < 0.5 ? M.flowerBlue : M.flowerRed); f.scale.set(0.9, 0.9, 1); f.position.set(side * (4.9 + Math.random() * 1.2), 0.3, z + Math.random() * 3); scene.add(f);
  }
}
buildLevel();

// ---------- player ----------
const player = { pos: new THREE.Vector3(0, 0, 0), vel: new THREE.Vector3(), grounded: false, ground: null,
  coyote: 0, jumpBuf: 0, spin: 0, spinCd: 0, facing: Math.PI, hurt: 0 };
const playerRoot = new THREE.Group(); scene.add(playerRoot);
const modelHolder = new THREE.Group(); playerRoot.add(modelHolder);
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.35 }));
shadow.rotation.x = -Math.PI / 2; scene.add(shadow);

function placeholder() {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.9, 4, 10), mat(0xff7043)); m.position.y = PLAYER_H / 2; modelHolder.add(m);
}
let animator = null;
const onModel = gltf => {
  const model = gltf.scene;
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
  const model = gltf.scene, box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  const wrap = new THREE.Group(); wrap.add(model); wrap.scale.setScalar(1.9 / size.y);
  const c = box.getCenter(new THREE.Vector3()); model.position.sub(c);
  model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; for (const mt of [].concat(o.material)) { akuMats.push(mt); mt.fog = false; } } });
  aku.add(wrap);
}, () => {});

// ---------- input ----------
const keys = {};
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (e.code === 'Space' || e.code === 'KeyK') player.jumpBuf = JUMP_BUFFER;
  if (['ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyX'].includes(e.code)) trySpin();
  if (state !== 'play' && (e.code === 'Enter' || e.code === 'Space')) startOrRestart();
});
// ---- on-screen touch controls (iPad / phones) ----
if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) document.body.classList.add('touch');
for (const b of document.querySelectorAll('#touch button')) {
  const press = e => {
    e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch {} b.classList.add('down');
    if (b.dataset.key) { keys[b.dataset.key] = true; if (b.dataset.key === 'Space') player.jumpBuf = JUMP_BUFFER; }
    if (b.dataset.action === 'spin') trySpin();
  };
  const release = e => { e.preventDefault(); b.classList.remove('down'); if (b.dataset.key) keys[b.dataset.key] = false; };
  b.addEventListener('pointerdown', press);
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, release);
  b.addEventListener('contextmenu', e => e.preventDefault());
}
document.getElementById('msg').addEventListener('pointerdown', () => { if (state !== 'play') startOrRestart(); });
addEventListener('keyup', e => { keys[e.code] = false; });

// ---------- sound ----------
let ac;
function beep(f, d = 0.1, type = 'square', vol = 0.06, slide = 0) {
  try {
    ac ||= new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f; if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), ac.currentTime + d);
    g.gain.value = vol; g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + d);
    o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d);
  } catch {}
}

// ---------- game state ----------
let masks = 0, invincible = 0; // masks = Aku Aku power level 0..2 (hits he can absorb); invincible = seconds of golden Aku Aku
let state = 'title', lives = START_LIVES, fruitCount = 0, cratesBroken = 0, totalCrates = crates.length;
let checkpoint = new THREE.Vector3(0, 0, 0), time = 0;
const hud = { lives: document.getElementById('lives'), fruit: document.getElementById('fruit'), crates: document.getElementById('crates'), aku: document.getElementById('aku') };
const msg = document.getElementById('msg'), msgbody = document.getElementById('msgbody');
function updateHud() {
  hud.lives.textContent = `♥ x${lives}`; hud.fruit.innerHTML = `<img src="${WUMPA_URL}" height="26" style="image-rendering:pixelated;vertical-align:middle"> ${fruitCount}`;
  hud.aku.textContent = invincible > 0 ? `GOLDEN AKU AKU ${Math.ceil(invincible)}s` : masks > 0 ? `AKU AKU LV ${masks}/3` : '';
  hud.crates.textContent = `📦 ${cratesBroken}/${totalCrates}`;
}
const GAME_TITLE = 'CRASH BANDICOOT ADVENTURE';
function showMsg(title, body) {
  const h1 = msg.querySelector('h1'); h1.textContent = title; h1.hidden = title === GAME_TITLE;   // the logo stands in for the title text
  msgbody.innerHTML = body; msg.classList.remove('hidden');
}
showMsg(GAME_TITLE, `<kbd>WASD</kbd>/<kbd>Arrows</kbd> move &nbsp; <kbd>Space</kbd> jump &nbsp; <kbd>Shift</kbd>/<kbd>J</kbd> spin<br>Spin or stomp crates and enemies, collect fruit, reach the portal.<br><br>Break an Aku Aku crate to summon Aku Aku, who blocks hits. Break two more to turn him golden and become invincible (but you can still fall).<br><br>Press <kbd>Enter</kbd> or tap to start<br>On iPad: use the on-screen arrows, JUMP and SPIN buttons<br><small>Aku Aku model by anttipantti (CC BY 4.0)</small>`);
function startOrRestart() {
  if (ac === undefined) beep(1, 0.01, 'sine', 0.0001);
  if (state === 'title' || state === 'over' || state === 'won') {
    if (state !== 'title') location.reload();
    state = 'play'; msg.classList.add('hidden'); updateHud();
  }
}
function respawn() {
  player.pos.copy(checkpoint); player.vel.set(0, 0, 0); player.spin = 0; player.hurt = 1;
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
  beep(260, 0.25, 'sawtooth', 0.07, -120); updateHud(); toast(masks > 0 ? 'AKU AKU PROTECTED YOU!' : 'AKU AKU IS GONE!');
}
function die() {
  if (player.hurt > 0.5) return;
  masks = 0; invincible = 0;
  lives--; beep(300, 0.4, 'sawtooth', 0.08, -200); updateHud();
  if (lives <= 0) { state = 'over'; showMsg('GAME OVER', `Fruit: ${fruitCount} &nbsp; Crates: ${cratesBroken}/${totalCrates}<br>Press <kbd>Enter</kbd> to retry`); return; }
  respawn();
}
function addFruit(n) { fruitCount += n; while (fruitCount >= 100) { fruitCount -= 100; lives++; beep(900, 0.3, 'triangle', 0.08, 600); } updateHud(); }
function trySpin() {
  if (state !== 'play' || player.spin > 0 || player.spinCd > 0) return;
  player.spin = SPIN_TIME; beep(500, 0.15, 'sawtooth', 0.04, 300);
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
  c.armed = true; c.timer = fromStomp ? 3 : 0.15; beep(900, 0.08, 'square', 0.06);
  c.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: countdownTex[2], transparent: true, depthTest: false }));
  c.label.scale.set(1.1, 1.1, 1); c.label.position.copy(c.mesh.position).add(new THREE.Vector3(0, 1.4, 0)); scene.add(c.label);
}
function explodeTnt(c) {
  if (c.broken) return;
  const p = c.mesh.position.clone();
  c.broken = true; c.mesh.visible = false; cratesBroken++; scene.remove(c.label);
  const i = solids.indexOf(c); if (i >= 0) solids.splice(i, 1);
  spawnDebris(p); spawnDebris(p);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff8a00, transparent: true, opacity: 0.85 }));
  ball.position.copy(p); ball.userData = { life: 0.5 }; scene.add(ball); booms.push(ball);
  beep(120, 0.5, 'sawtooth', 0.12, -80);
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
  c.broken = true; c.mesh.visible = false; cratesBroken++;
  const i = solids.indexOf(c); if (i >= 0) solids.splice(i, 1);
  if (c.kind === 'checkpoint') { checkpoint.set(c.mesh.position.x, c.mesh.position.y - 0.5, c.mesh.position.z); beep(700, 0.25, 'triangle', 0.07, 300); toast('CHECKPOINT!'); }
  else beep(220, 0.15, 'square', 0.07, -80);
  if (c.kind === 'life') { lives++; beep(900, 0.35, 'triangle', 0.09, 700); toast('1UP!'); }
  if (c.kind === 'aku') {
    beep(520, 0.3, 'triangle', 0.08, 500);
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

// ---------- physics ----------
const STEP_SMALL = 0.35;  // lips this low are stepped over automatically
const STEP_UP = 0.75;   // how tall a lip you can walk onto without jumping (ramps are walked up smoothly)
function overlaps(s, p) {
  return p.x + HALF_W > s.min.x && p.x - HALF_W < s.max.x &&
         p.z + HALF_W > s.min.z && p.z - HALF_W < s.max.z &&
         p.y + PLAYER_H > s.min.y && p.y < s.max.y;
}
function moveAxis(axis, amount) {
  player.pos[axis] += amount;
  for (const s of solids) {
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
        if (player.vel.y < -1 && s.crate) { breakCrate(s, true); }
        if (player.vel.y < 0) player.vel.y = 0;
      } else { p.y = s.min.y - PLAYER_H; player.vel.y = 0; }
    } else if (!s.crate && s.max.y - p.y <= STEP_SMALL) {
      p.y = s.max.y; player.grounded = true; player.ground = s;                         // tiny lips never stop you
    } else {
      p[axis] = amount > 0 ? s.min[axis] - HALF_W : s.max[axis] + HALF_W;
    }
  }
}
// stay glued to a slope when walking downhill instead of skipping off it
function snapToRamp() {
  const p = player.pos; let best = null, bestY = -Infinity;
  for (const s of solids) {
    if (!s.ramp || !(p.x + HALF_W > s.min.x && p.x - HALF_W < s.max.x && p.z + HALF_W > s.min.z && p.z - HALF_W < s.max.z)) continue;
    const surf = rampY(s, p.z), gap = p.y - surf;
    if (gap >= 0 && gap < 0.7 && surf > bestY) { best = s; bestY = surf; }
  }
  if (best) { p.y = bestY; player.grounded = true; player.ground = best; if (player.vel.y < 0) player.vel.y = 0; }
}

const tmp = new THREE.Vector3();
function update(dt) {
  time += dt;
  // moving platforms
  for (const s of movers) {
    const m = s.mover, old = s.mesh.position[m.axis];
    s.mesh.position[m.axis] = m.origin + Math.sin(time * m.speed) * m.range;
    s.delta = s.mesh.position[m.axis] - old; syncBox(s);
  }
  for (const c of crates) if (c.armed && !c.broken) {
    c.timer -= dt;
    c.label.material.map = countdownTex[Math.max(0, Math.min(2, Math.ceil(c.timer) - 1))];
    c.mesh.material.emissive.setHex(Math.floor(c.timer * 6) % 2 ? 0xaa1100 : 0x000000);
    if (c.timer <= 0) explodeTnt(c);
  }
  for (let i = booms.length - 1; i >= 0; i--) {
    const b = booms[i]; b.userData.life -= dt; b.scale.setScalar(1 + (0.5 - b.userData.life) * 7); b.material.opacity = Math.max(0, b.userData.life * 1.7);
    if (b.userData.life <= 0) { scene.remove(b); booms.splice(i, 1); }
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
    player.vel.y = JUMP_V; player.coyote = 0; player.jumpBuf = 0; player.grounded = false; beep(400, 0.15, 'square', 0.04, 250);
  }
  if (!(keys.Space || keys.KeyK) && player.vel.y > 4) player.vel.y -= 40 * dt; // variable jump height
  player.vel.y -= GRAVITY * dt;

  // ride moving platform
  const ground = player.ground;
  if (player.grounded && ground && ground.delta) player.pos[ground.mover.axis] += ground.delta;

  const wasGrounded = player.grounded;
  player.grounded = false; player.ground = null;
  moveAxis('x', player.vel.x * dt);
  moveAxis('z', player.vel.z * dt);
  moveAxis('y', player.vel.y * dt);
  if (!player.grounded && wasGrounded && player.vel.y <= 0.01) snapToRamp();

  // spin
  if (player.spin > 0) {
    player.spin -= dt; if (player.spin <= 0) player.spinCd = SPIN_COOLDOWN;
    for (const c of crates.slice()) {
      if (c.broken) continue;
      if (Math.abs(c.mesh.position.x - player.pos.x) < 2.3 && Math.abs(c.mesh.position.z - player.pos.z) < 2.3 &&
          c.mesh.position.y > player.pos.y - 0.6 && c.mesh.position.y < player.pos.y + PLAYER_H + 0.5) breakCrate(c, false);
    }
  }

  // fruit
  for (const f of fruits) {
    if (f.got) continue;
    f.mesh.position.y = f.baseY + Math.sin(time * 3 + f.baseY) * 0.08;
    if (f.mesh.position.distanceTo(tmp.set(player.pos.x, player.pos.y + 0.9, player.pos.z)) < 0.9) {
      f.got = true; f.mesh.visible = false; addFruit(1); beep(1000, 0.06, 'triangle', 0.04);
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
        e.alive = false; e.mesh.visible = false; beep(150, 0.2, 'square', 0.07, -60);
        if (stomp && player.spin <= 0) { player.vel.y = JUMP_V * 0.8; }
        addFruit(2);
      } else hit();
    }
  }
  // spikes
  for (const s of spikes) {
    if (Math.abs(s.pos.x - player.pos.x) < 0.5 + HALF_W && Math.abs(s.pos.z - player.pos.z) < 0.5 + HALF_W &&
        player.pos.y < s.pos.y + 0.6 && player.pos.y + PLAYER_H > s.pos.y) hit();
  }
  // fall
  if (player.pos.y < -10) die();
  // finish
  if (state === 'play' && finish.position.distanceTo(tmp.set(player.pos.x, player.pos.y + 1, player.pos.z)) < 1.8) {
    state = 'won'; beep(600, 0.6, 'triangle', 0.08, 600);
    showMsg('LEVEL COMPLETE!', `Fruit: ${fruitCount} &nbsp; Crates: ${cratesBroken}/${totalCrates} &nbsp; Lives: ${lives}<br>Press <kbd>Enter</kbd> to play again`);
  }
}

// ---------- render loop ----------
const camTarget = new THREE.Vector3(), clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
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
    const top = s.ramp ? rampY(s, player.pos.z) : s.max.y;
    if (player.pos.x + HALF_W > s.min.x && player.pos.x - HALF_W < s.max.x && player.pos.z + HALF_W > s.min.z && player.pos.z - HALF_W < s.max.z && top <= player.pos.y + 0.2) sy = Math.max(sy, top);
  }
  shadow.visible = sy > -Infinity; shadow.position.set(player.pos.x, sy + 0.02, player.pos.z);
  shadow.scale.setScalar(MODEL_SCALE * Math.max(0.4, 1 - (player.pos.y - sy) * 0.08));

  if (finish) { finish.rotation.z += dt; }
  // Aku Aku: floats at the player's shoulder looking where Crash is heading; while invincible he is worn on Crash's face like a mask
  aku.visible = masks > 0 || invincible > 0;
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
  camTarget.set(player.pos.x * 0.5, Math.max(player.pos.y, -2) + 4.8, player.pos.z + 9.5);
  camera.position.lerp(camTarget, 1 - Math.exp(-6 * dt));
  camera.lookAt(player.pos.x * 0.5, Math.max(player.pos.y, -2) + 1.2, player.pos.z - 4);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
camera.position.set(0, 4.2, 8.5);
window.__game = { layout: () => LAYOUT, setCheckpoint: (x, y, z) => checkpoint.set(x, y, z), solids, spikes, setLives: n => { lives = n; updateHud(); }, masks: () => masks, giveMasks: n => { for (let i = 0; i < n; i++) { if (masks >= 2) { masks = 0; invincible = INVINCIBLE_TIME; } else masks++; } updateHud(); }, player, anim: () => animator, enemies, crates, state: () => state, setState: s => { state = s; } };
frame();
