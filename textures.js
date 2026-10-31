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
const pathTex = () => canvasTex(32, 32, (g, w, h) => {      // sandy jungle trail with a few grass tufts
  speckle(g, w, h, '#b9783a', ['#a3672f', '#cc8d4b', '#8f5724', '#d9a05e', '#c07f40'], 0.55);
  for (let i = 0; i < 6; i++) { const x = (rnd() * 28) | 0, y = (rnd() * 28) | 0; dot(g, x, y, '#8a5424', 3, 2); dot(g, x + 1, y, '#6e3f18', 1, 1); }
  for (let i = 0; i < 5; i++) { const x = (rnd() * 30) | 0, y = (rnd() * 28) | 0; dot(g, x, y, '#3f8f2a', 1, 3); dot(g, x + 1, y + 1, '#5cb344', 1, 2); dot(g, x - 1, y + 1, '#2f7a20', 1, 2); }
});
const dirtTex = () => canvasTex(16, 16, (g, w, h) => {
  speckle(g, w, h, '#7a4c24', ['#66401c', '#8c5c2e', '#52320f']);
  for (let i = 0; i < 5; i++) dot(g, (rnd() * 13) | 0, (rnd() * 13) | 0, '#8f8f78', 2, 2);
});
const dirtSideTex = () => canvasTex(16, 16, (g, w, h) => {   // earth cliff with a mossy grass lip
  speckle(g, w, h, '#7a4c24', ['#66401c', '#8c5c2e', '#52320f']);
  for (let x = 0; x < w; x++) { const d = 3 + ((rnd() * 3) | 0); dot(g, x, 0, '#3f8f2a', 1, d); dot(g, x, 0, '#5cb344', 1, 1); dot(g, x, d - 1, '#2a6a1c', 1, 1); }
}, { clampT: true });
// carved stone tiki wall: teal-grey blocks with blue/orange tribal bands
const stoneTex = () => canvasTex(32, 32, (g, w, h) => {
  speckle(g, w, h, '#4b6a63', ['#41605a', '#567870', '#384f4a'], 0.35);
  for (const y of [0, 16]) dot(g, 0, y, '#1d2b28', w, 1);
  for (const [x, y] of [[0, 0], [16, 16]]) dot(g, x, y, '#1d2b28', 1, 16);
  dot(g, 16, 0, '#1d2b28', 1, 16); dot(g, 0, 16, '#1d2b28', 1, 16);
  for (let i = 0; i < 16; i += 2) { dot(g, 2 + i / 1.2, 4 + (i % 4), '#2f86c4', 2, 2); dot(g, 2 + i / 1.2, 8 - (i % 4), '#e0902c', 1, 2); }
  dot(g, 20, 20, '#e8dba2', 8, 2); dot(g, 20, 24, '#2f86c4', 8, 2); dot(g, 22, 21, '#1d2b28', 1, 4); dot(g, 26, 21, '#1d2b28', 1, 4);
  dot(g, 4, 20, '#d4382c', 3, 3); dot(g, 9, 20, '#d4382c', 3, 3); dot(g, 6, 26, '#e8dba2', 5, 2);
});
const mossTex = () => canvasTex(16, 16, (g, w, h) => speckle(g, w, h, '#3e5f33', ['#33512a', '#4a7340', '#5b8a4a', '#6b5a3a'], 0.5));
const metalTex = () => canvasTex(16, 16, (g, w, h) => {
  speckle(g, w, h, '#2a9d8f', ['#23867a', '#35b3a3'], 0.2);
  dot(g, 0, 0, '#16665d', w, 1); dot(g, 0, h - 1, '#16665d', w, 1); dot(g, 0, 0, '#16665d', 1, h); dot(g, w - 1, 0, '#16665d', 1, h);
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) dot(g, x, y, '#c9f2ec', 1, 1);
}, { clampT: true });
const waterTex = () => canvasTex(32, 32, (g, w, h) => {       // leafy canopy far below the path
  speckle(g, w, h, '#245a22', ['#1b4a1a', '#2f7a2b'], 0.5);
  for (let i = 0; i < 60; i++) {
    const x = (rnd() * 30) | 0, y = (rnd() * 30) | 0, c = ['#3a8a31', '#4fa83f', '#1c4a1b', '#2f7a2b'][(rnd() * 4) | 0];
    dot(g, x, y, c, 3, 2); dot(g, x + 1, y - 1, c, 1, 1);
  }
  for (let i = 0; i < 14; i++) dot(g, (rnd() * 30) | 0, (rnd() * 30) | 0, '#7acb5b', 2, 1);
});
const treeTex = () => canvasTex(64, 56, (g) => {            // jungle plant: fan of drooping broad leaves
  const bx = 32, by = 52;
  const shades = [['#2f7d2a', '#3f9a34', '#58b84a'], ['#276b24', '#348a2d', '#4aa63e']];
  for (let k = 0; k < 9; k++) {
    const ang = (-80 + k * 20) * Math.PI / 180, L = 26 + ((k % 3) * 3), sh = shades[k % 2];
    for (let s = 0; s < L; s++) {
      const x = bx + Math.sin(ang) * s, y = by - Math.cos(ang) * s * 0.9 + s * s * 0.012 * (1 + Math.abs(Math.sin(ang)) * 2);
      const wd = Math.max(1, Math.round(Math.sin(Math.PI * (s + 2) / (L + 4)) * 5.5));
      for (let o = -wd; o <= wd; o++) {
        const px = x + Math.cos(ang) * o, py = y + Math.sin(ang) * o * 0.6;
        dot(g, Math.round(px), Math.round(py), o === 0 ? '#9ad36a' : (o < 0 ? sh[0] : (rnd() < 0.35 ? sh[2] : sh[1])));
      }
    }
  }
  dot(g, 30, 46, '#5a3d22', 5, 10);
}, { repeat: false });
const flowerTex = (petal, centre) => canvasTex(16, 16, (g) => {
  dot(g, 7, 8, '#2f7d2a', 2, 8);
  for (const [x, y] of [[5, 4], [9, 4], [4, 7], [10, 7], [7, 2]]) dot(g, x, y, petal, 3, 3);
  dot(g, 7, 5, centre, 3, 3);
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

// pixel-art crate faces: assets/<name>.png, or embedded as base64 in window.__TEX_B64 for the single-file build
function imgTex(name) {
  const b64 = window.__TEX_B64 && window.__TEX_B64[name];
  const t = new THREE.TextureLoader().load(b64 ? 'data:image/png;base64,' + b64 : `./assets/${name}.png`);
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
  const top = lambert(pathTex()), side = lambert(dirtSideTex()), dirt = lambert(dirtTex()), metal = lambert(metalTex());
  const stone = lambert(stoneTex()), moss = lambert(mossTex());
  const water = lambert(waterTex()); water.map.repeat.set(120, 600);
  return {
    grass: [side, side, top, dirt, side, side],
    wall: [stone, stone, moss, stone, stone, stone],       // box face order: +x -x +y -y +z -z
    dirt: [dirt, dirt, dirt, dirt, dirt, dirt],
    moving: [metal, metal, metal, metal, metal, metal],
    crate: lambert(imgTex('crate')), lifeCrate: lambert(imgTex('crate_life')), tntCrate: lambert(imgTex('crate_tnt')),
    akuCrate: lambert(imgTex('aku_crate')), checkpoint: lambert(imgTex('crate_checkpoint')),
    water, tree: sprite(treeTex()), flowerBlue: sprite(flowerTex('#3a8fe0', '#ffd54f')), flowerRed: sprite(flowerTex('#d8344c', '#ffeb3b')), enemy: sprite(enemyTex()), fruit: sprite(wumpaTex()),
  };
}

// Repeat the texture every `t` world units instead of stretching it over a whole platform face.
// Side faces stretch vertically so the grass fringe stays at the top edge.
export function tileUV(geo, w, h, d, t = 2, tallSides = false) {
  const uv = geo.attributes.uv, dims = tallSides ? [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]] : [[d, 1], [d, 1], [w, d], [w, d], [w, 1], [w, 1]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / t, uv.getY(k) * (dims[f][1] === 1 ? 1 : dims[f][1] / t));
  }
}
