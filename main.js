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

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x8fd3ff, 25, 90);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
scene.add(new THREE.HemisphereLight(0xffffff, 0x4a7a3a, 1.1));
const sun = new THREE.DirectionalLight(0xfff2cc, 1.6);
sun.position.set(10, 20, 8); scene.add(sun);

const mat = c => new THREE.MeshLambertMaterial({ color: c });
const T = makeMaterials();
const M = { ...T, spike: mat(0xcfd8dc), step: T.grass, portal: new THREE.MeshBasicMaterial({ color: 0xb388ff, transparent: true, opacity: 0.7 }) };

// ---------- world state ----------
const solids = [];   // { mesh, min:Vector3, max:Vector3, vel?, crate? }
const crates = [], fruits = [], enemies = [], spikes = [], movers = [];
let finish;

function addBox(x, y, z, w, h, d, material, extra = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  if (!extra.crate) tileUV(geo, w, h, d);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.set(x, y, z); scene.add(mesh);
  const s = { mesh, min: new THREE.Vector3(), max: new THREE.Vector3(), half: new THREE.Vector3(w / 2, h / 2, d / 2), ...extra };
  syncBox(s); solids.push(s); return s;
}
function syncBox(s) {
  s.min.copy(s.mesh.position).sub(s.half); s.max.copy(s.mesh.position).add(s.half);
}
// top surface of a platform at height `top`
function platform(x, z0, z1, w, top = 0, material = M.grass) {
  const d = Math.abs(z1 - z0), h = 2;
  return addBox(x, top - h / 2, (z0 + z1) / 2, w, h, d, material);
}
function crate(x, y, z, kind = 'normal', fruitCount = 0) {
  const s = addBox(x, y + 0.5, z, 1, 1, 1, kind === 'checkpoint' ? M.checkpoint : kind === 'aku' ? M.akuCrate : M.crate, { crate: true });
  s.kind = kind; s.fruitCount = fruitCount; crates.push(s);
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
  platform(0, 4, -22, 7);
  crate(-1.5, 0, -8, 'normal', 3); crate(1.5, 0, -8, 'normal', 3); crate(0, 0, -14, 'normal', 5); crate(0, 0, -11, 'aku');
  fruitLine(0, 0.9, -3, -6, 3); fruitLine(0, 0.9, -16, -20, 4);
  // 2. first gap + patrol platform
  platform(0, -25, -42, 7);
  enemy(0, 0, -31, 'x', 2.5); enemy(0, 0, -37, 'x', 2.5);
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
  // 5. staircase area
  platform(0, -72, -102, 8);
  addBox(0, 0.6, -80, 8, 1.2, 3, M.step);
  addBox(0, 1.1, -85, 8, 2.2, 3, M.step);
  crate(-2, 2.2, -85, 'normal', 5); crate(2, 2.2, -85, 'normal', 5); crate(0, 2.2, -85, 'aku');
  enemy(0, 0, -76, 'x', 3); enemy(0, 2.2, -90 + 0, 'x', 3);
  enemy(0, 0, -96, 'x', 3);
  fruitLine(0, 2.0, -78, -83, 3); fruitLine(0, 3.4, -88, -92, 3);
  spike(0, 0, -93);
  // 6. finale
  platform(0, -105, -124, 7);
  crate(0, 0, -107, 'checkpoint'); crate(0, 0, -110, 'aku'); crate(-2, 0, -112, 'normal', 8); crate(2, 0, -112, 'normal', 8);
  fruitLine(0, 0.9, -108, -118, 6);
  finish = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.25, 12, 32), M.portal);
  finish.position.set(0, 2, -120); scene.add(finish);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.45, 24), M.portal); finish.add(disc);

  // scenery
  const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), M.water);
  water.rotation.x = -Math.PI / 2; water.position.y = -12; scene.add(water);
  for (let i = 0; i < 90; i++) {
    const side = Math.random() < 0.5 ? -1 : 1, z = 10 - Math.random() * 150, x = side * (6 + Math.random() * 18);
    const h = 5 + Math.random() * 6;
    const t = new THREE.Sprite(M.tree); t.scale.set(h * 0.7, h, 1); t.position.set(x, h / 2 - 1.5, z); scene.add(t);
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
const aku = new THREE.Group(); aku.visible = false; scene.add(aku);
const akuMats = []; let aku2 = null;
loadGlb(window.__AKU_B64, './assets/aku_aku.glb', gltf => {
  const model = gltf.scene, box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3());
  const wrap = new THREE.Group(); wrap.add(model); wrap.scale.setScalar(1.9 / size.y);
  const c = box.getCenter(new THREE.Vector3()); model.position.sub(c);
  model.traverse(o => { if (o.isMesh) { o.frustumCulled = false; for (const mt of [].concat(o.material)) { akuMats.push(mt); mt.fog = false; } } });
  aku.add(wrap);
  aku2 = aku.clone(true); scene.add(aku2); aku2.visible = false;
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
let masks = 1, invincible = 0;
let state = 'title', lives = START_LIVES, fruitCount = 0, cratesBroken = 0, totalCrates = crates.length;
let checkpoint = new THREE.Vector3(0, 0, 0), time = 0;
const hud = { lives: document.getElementById('lives'), fruit: document.getElementById('fruit'), crates: document.getElementById('crates'), aku: document.getElementById('aku') };
const msg = document.getElementById('msg'), msgbody = document.getElementById('msgbody');
function updateHud() {
  hud.lives.textContent = `♥ x${lives}`; hud.fruit.innerHTML = `<img src="${WUMPA_URL}" height="26" style="image-rendering:pixelated;vertical-align:middle"> ${fruitCount}`;
  hud.aku.textContent = invincible > 0 ? `AKU AKU INVINCIBLE ${Math.ceil(invincible)}s` : masks > 0 ? `AKU AKU x${masks}` : '';
  hud.crates.textContent = `📦 ${cratesBroken}/${totalCrates}`;
}
function showMsg(title, body) {
  msg.querySelector('h1').textContent = title; msgbody.innerHTML = body; msg.classList.remove('hidden');
}
showMsg('RETRO RUN', `<kbd>WASD</kbd>/<kbd>Arrows</kbd> move &nbsp; <kbd>Space</kbd> jump &nbsp; <kbd>Shift</kbd>/<kbd>J</kbd> spin<br>Spin or stomp crates and enemies, collect fruit, reach the portal.<br><br>Aku Aku crates give you a mask that blocks one hit. Collect three for a burst of invincibility.<br><br>Press <kbd>Enter</kbd> or tap to start<br>On iPad: use the on-screen arrows, JUMP and SPIN buttons<br><small>Aku Aku model by anttipantti (CC BY 4.0)</small>`);
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
  beep(260, 0.25, 'sawtooth', 0.07, -120); updateHud(); toast(masks > 0 ? 'AKU AKU PROTECTED YOU!' : 'MASK LOST!');
}
function die() {
  if (player.hurt > 0.5) return;
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
function breakCrate(c, bounce) {
  if (c.broken) return;
  spawnDebris(c.mesh.position);
  c.broken = true; c.mesh.visible = false; cratesBroken++;
  const i = solids.indexOf(c); if (i >= 0) solids.splice(i, 1);
  if (c.kind === 'checkpoint') { checkpoint.set(c.mesh.position.x, c.mesh.position.y - 0.5, c.mesh.position.z); beep(700, 0.25, 'triangle', 0.07, 300); }
  else beep(220, 0.15, 'square', 0.07, -80);
  if (c.kind === 'aku') {
    beep(520, 0.3, 'triangle', 0.08, 500);
    if (++masks >= 3) { masks = 0; invincible = 12; toast('AKU AKU INVINCIBLE!'); } else toast(`AKU AKU MASK x${masks}!`);
  }
  addFruit(c.fruitCount || 0);
  if (bounce) { player.vel.y = JUMP_V * 0.8; player.grounded = false; }
  updateHud();
}

// ---------- physics ----------
function overlaps(s, p) {
  return p.x + HALF_W > s.min.x && p.x - HALF_W < s.max.x &&
         p.z + HALF_W > s.min.z && p.z - HALF_W < s.max.z &&
         p.y + PLAYER_H > s.min.y && p.y < s.max.y;
}
function moveAxis(axis, amount) {
  player.pos[axis] += amount;
  for (const s of solids) {
    if (!overlaps(s, player.pos)) continue;
    const p = player.pos;
    if (axis === 'y') {
      if (amount <= 0) {
        p.y = s.max.y; player.grounded = true; player.ground = s;
        if (player.vel.y < -1 && s.crate) { breakCrate(s, true); }
        if (player.vel.y < 0) player.vel.y = 0;
      } else { p.y = s.min.y - PLAYER_H; player.vel.y = 0; }
    } else {
      p[axis] = amount > 0 ? s.min[axis] - HALF_W : s.max[axis] + HALF_W;
    }
  }
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

  player.grounded = false; player.ground = null;
  moveAxis('x', player.vel.x * dt);
  moveAxis('z', player.vel.z * dt);
  moveAxis('y', player.vel.y * dt);

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
    if (player.pos.x + HALF_W > s.min.x && player.pos.x - HALF_W < s.max.x && player.pos.z + HALF_W > s.min.z && player.pos.z - HALF_W < s.max.z && s.max.y <= player.pos.y + 0.2) sy = Math.max(sy, s.max.y);
  }
  shadow.visible = sy > -Infinity; shadow.position.set(player.pos.x, sy + 0.02, player.pos.z);
  shadow.scale.setScalar(MODEL_SCALE * Math.max(0.4, 1 - (player.pos.y - sy) * 0.08));

  if (finish) { finish.rotation.z += dt; }
  // Aku Aku masks hover on either side of the player (one per mask held; a single big glowing one while invincible)
  [[aku, -1.4, masks > 0 || invincible > 0], [aku2, 1.4, masks > 1 && invincible <= 0]].forEach(([a, side, show], i) => {
    if (!a) return;
    a.visible = show;
    const target = tmp.set(player.pos.x + side, player.pos.y + 2.5 + Math.sin(time * 2.4 + i * 2) * 0.15, player.pos.z + 0.4);
    if (!a.userData.init) { a.position.copy(target); a.userData.init = true; }
    a.position.lerp(target, 1 - Math.exp(-8 * dt));
    a.rotation.y = Math.sin(time * 1.5 + i) * 0.35 - player.vel.x * 0.02;
    a.scale.setScalar(1 + (invincible > 0 ? 0.15 + Math.sin(time * 12) * 0.05 : 0));
  });
  for (const mt of akuMats) if (mt.emissive) mt.emissive.setHex(invincible > 0 ? (Math.floor(time * 8) % 2 ? 0x2a5577 : 0x665522) : 0x2a2a2a);
  // camera
  camTarget.set(player.pos.x * 0.5, Math.max(player.pos.y, -2) + 4.8, player.pos.z + 9.5);
  camera.position.lerp(camTarget, 1 - Math.exp(-6 * dt));
  camera.lookAt(player.pos.x * 0.5, Math.max(player.pos.y, -2) + 1.2, player.pos.z - 4);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
camera.position.set(0, 4.2, 8.5);
window.__game = { masks: () => masks, giveMasks: n => { for (let i = 0; i < n; i++) { if (++masks >= 3) { masks = 0; invincible = 12; } } updateHud(); }, player, anim: () => animator, enemies, crates, state: () => state, setState: s => { state = s; } };
frame();
