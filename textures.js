// Retro look: every surface is a tiny pixel texture with nearest-neighbour filtering,
// and fruit/trees/enemies are flat billboard sprites instead of 3D models.
import * as THREE from 'three';

let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function canvasTex(w, h, draw, { repeat = true, clampT = false } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter; t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = clampT ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; }
  return t;
}
const dot = (g, x, y, col, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
function speckle(g, w, h, base, vars, chance = 0.35) {
  dot(g, 0, 0, base, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (rnd() < chance) dot(g, x, y, vars[(rnd() * vars.length) | 0]);
}
const grassTopTex = () => canvasTex(16, 16, (g, w, h) => speckle(g, w, h, '#4aa83a', ['#3d9530', '#5cbc47', '#2f8226', '#6fcf55']));
const dirtTex = () => canvasTex(16, 16, (g, w, h) => {
  speckle(g, w, h, '#8a5a2c', ['#74481f', '#9c6a38', '#5e3a16']);
  for (let i = 0; i < 5; i++) dot(g, (rnd() * 13) | 0, (rnd() * 13) | 0, '#9a9a9a', 2, 2);
});
const dirtSideTex = () => canvasTex(16, 16, (g, w, h) => {
  speckle(g, w, h, '#8a5a2c', ['#74481f', '#9c6a38', '#5e3a16']);
  for (let x = 0; x < w; x++) { const d = 3 + ((rnd() * 3) | 0); dot(g, x, 0, '#4aa83a', 1, d); dot(g, x, 0, '#3d9530', 1, 1); }
}, { clampT: true });
const metalTex = () => canvasTex(16, 16, (g, w, h) => {
  speckle(g, w, h, '#2a9d8f', ['#23867a', '#35b3a3'], 0.2);
  dot(g, 0, 0, '#16665d', w, 1); dot(g, 0, h - 1, '#16665d', w, 1); dot(g, 0, 0, '#16665d', 1, h); dot(g, w - 1, 0, '#16665d', 1, h);
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) dot(g, x, y, '#c9f2ec', 1, 1);
}, { clampT: true });
const crateTex = (checkpoint) => canvasTex(32, 32, (g, w, h) => {
  const base = checkpoint ? '#3949ab' : '#c98a3c', dark = checkpoint ? '#1a237e' : '#6b4210', mid = checkpoint ? '#2c3a8c' : '#a06a24';
  speckle(g, w, h, base, [mid, checkpoint ? '#4a5bc4' : '#dda052'], 0.25);
  for (let y = 7; y < h; y += 8) dot(g, 0, y, mid, w, 1);
  for (let i = 0; i < w; i++) { dot(g, i, i, dark, 2, 2); dot(g, w - 2 - i, i, dark, 2, 2); }
  dot(g, 0, 0, dark, w, 3); dot(g, 0, h - 3, dark, w, 3); dot(g, 0, 0, dark, 3, h); dot(g, w - 3, 0, dark, 3, h);
  if (checkpoint) { // blocky yellow "C"
    dot(g, 9, 9, '#1a237e', 14, 14);
    dot(g, 10, 10, '#ffeb3b', 12, 3); dot(g, 10, 19, '#ffeb3b', 12, 3); dot(g, 10, 10, '#ffeb3b', 3, 12);
  }
}, { repeat: false });
const waterTex = () => canvasTex(32, 32, (g, w, h) => {
  dot(g, 0, 0, '#1e6fc9', w, h);
  for (let i = 0; i < 40; i++) dot(g, (rnd() * 28) | 0, (rnd() * 32) | 0, rnd() < 0.5 ? '#4a9ae8' : '#1558a8', 3 + ((rnd() * 4) | 0), 1);
});
const treeTex = () => canvasTex(32, 48, (g) => {
  dot(g, 13, 38, '#6d4c41', 6, 10); dot(g, 13, 38, '#4e342e', 2, 10);
  const tiers = [[2, 18, 16], [14, 30, 13], [26, 40, 9]]; // [top, bottom, halfwidth at bottom]
  for (const [y0, y1, hw] of tiers) for (let y = y0; y < y1; y++) {
    const half = Math.max(1, Math.round(hw * (y - y0) / (y1 - y0)));
    for (let x = 16 - half; x < 16 + half; x++) dot(g, x, y, x < 16 - half / 3 ? '#43a047' : (rnd() < 0.3 ? '#1b5e20' : '#2e7d32'));
  }
}, { repeat: false });
const enemyTex = () => canvasTex(24, 20, (g) => {
  for (let y = 0; y < 20; y++) for (let x = 0; x < 24; x++) {
    const dx = (x - 12) / 8.5, dy = (y - 12) / 5.5;
    if (dx * dx + dy * dy < 1) dot(g, x, y, y > 14 ? '#8e1b1b' : (rnd() < 0.2 ? '#e53935' : '#c62828'));
  }
  dot(g, 1, 7, '#e53935', 5, 5); dot(g, 18, 7, '#e53935', 5, 5); dot(g, 1, 7, '#8e1b1b', 5, 1); dot(g, 18, 7, '#8e1b1b', 5, 1);
  for (const x of [8, 15]) { dot(g, x, 3, '#ffffff', 3, 3); dot(g, x + 1, 4, '#000000', 1, 2); }
  for (const x of [5, 8, 15, 18]) dot(g, x, 17, '#5a1010', 1, 3);
}, { repeat: false });

const AKU_CRATE_URL = window.__AKUCRATE_B64 ? 'data:image/png;base64,' + window.__AKUCRATE_B64 : './assets/aku_crate.png';
function akuCrateTex() {
  const t = new THREE.TextureLoader().load(AKU_CRATE_URL);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const WUMPA_URL = window.__WUMPA_B64 ? 'data:image/png;base64,' + window.__WUMPA_B64 : './assets/wumpa.png';
function wumpaTex() {
  const t = new THREE.TextureLoader().load(WUMPA_URL);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const lambert = map => new THREE.MeshLambertMaterial({ map });
const sprite = (map, extra = {}) => new THREE.SpriteMaterial({ map, transparent: true, alphaTest: 0.4, ...extra });

export function makeMaterials() {
  const top = lambert(grassTopTex()), side = lambert(dirtSideTex()), dirt = lambert(dirtTex()), metal = lambert(metalTex());
  const water = lambert(waterTex()); water.map.repeat.set(110, 110); water.transparent = true; water.opacity = 0.85;
  return {
    grass: [side, side, top, dirt, side, side],       // box face order: +x -x +y -y +z -z
    dirt: [dirt, dirt, dirt, dirt, dirt, dirt],
    moving: [metal, metal, metal, metal, metal, metal],
    crate: lambert(crateTex(false)), akuCrate: lambert(akuCrateTex()), checkpoint: lambert(crateTex(true)),
    water, tree: sprite(treeTex()), enemy: sprite(enemyTex()), fruit: sprite(wumpaTex()),
  };
}

// Repeat the texture every `t` world units instead of stretching it over a whole platform face.
// Side faces stretch vertically so the grass fringe stays at the top edge.
export function tileUV(geo, w, h, d, t = 2) {
  const uv = geo.attributes.uv, dims = [[d, 1], [d, 1], [w, d], [w, d], [w, 1], [w, 1]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / t, uv.getY(k) * (dims[f][1] === 1 ? 1 : dims[f][1] / t));
  }
}
