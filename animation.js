// The player model is a single rigid mesh with no skeleton, so we fake one:
// each vertex gets weights for legs / arms / head by where it sits on the model,
// and every frame the weighted parts are rotated about hip / shoulder pivots.
// Model space here is the glTF's own: x = side, y = -forward, z = up.
import * as THREE from 'three';

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const HIP = { y: -8, z: 55, x: 12 }, SHOULDER = { y: -8, z: 100, x: 26 }, NECK = { y: -8, z: 112 };

export function makeAnimator(root) {
  const parts = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const pos = o.geometry.attributes.position, rest = Float32Array.from(pos.array), n = pos.count;
    const w = { legL: new Float32Array(n), legR: new Float32Array(n), armL: new Float32Array(n), armR: new Float32Array(n), head: new Float32Array(n) };
    for (let i = 0; i < n; i++) {
      const x = rest[i * 3], z = rest[i * 3 + 2];
      const arm = sstep(20, 28, Math.abs(x)) * sstep(32, 42, z) * (1 - sstep(104, 112, z));
      const leg = (1 - arm) * (1 - sstep(48, 70, z));
      const right = sstep(-4, 4, x);                    // 0 on the -x side, 1 on the +x side
      w.legR[i] = leg * right; w.legL[i] = leg * (1 - right);
      w.armR[i] = arm * right; w.armL[i] = arm * (1 - right);
      w.head[i] = (1 - arm) * sstep(108, 120, z);
    }
    let restMinZ = Infinity; for (let i = 0; i < n; i++) restMinZ = Math.min(restMinZ, rest[i * 3 + 2]);
    parts.push({ pos, rest, w, n, restMinZ });
  });
  const restMin = Math.min(...parts.map(p => p.restMinZ));

  const st = { phase: 0, run: 0, air: 0, spin: 0, squash: 0 };
  const p = new THREE.Vector3();

  // rotate point about an x-axis pivot (swing, a>0 = forward), then about the y-axis (abduct, b>0 = outward on `side`)
  function swing(v, piv, a, wgt) {
    if (!wgt || !a) return;
    const th = -a * wgt, c = Math.cos(th), s = Math.sin(th), dy = v.y - piv.y, dz = v.z - piv.z;
    v.y = piv.y + dy * c - dz * s; v.z = piv.z + dy * s + dz * c;
  }
  function abduct(v, piv, side, b, wgt) {
    if (!wgt || !b) return;
    const ph = -side * b * wgt, c = Math.cos(ph), s = Math.sin(ph), dx = v.x - piv.x, dz = v.z - piv.z;
    v.x = piv.x + dx * c + dz * s; v.z = piv.z - dx * s + dz * c;
  }

  // input: { dt, time, speed (0..1), grounded, vy, spinning }
  function update({ dt, time, speed, grounded, vy, spinning }) {
    const k = f => 1 - Math.exp(-f * dt);
    st.run += (speed - st.run) * k(12);
    st.air += ((grounded ? 0 : 1) - st.air) * k(18);
    st.spin += ((spinning ? 1 : 0) - st.spin) * k(25);
    st.phase += dt * (5 + st.run * 7) * (st.run > 0.05 ? 1 : 0);
    const run = st.run * (1 - st.air), air = st.air, sp = st.spin;
    const breathe = Math.sin(time * 2.2);
    const falling = sstep(0, -6, vy);                       // 0 rising .. 1 falling fast

    const stride = Math.sin(st.phase);
    // legs: opposite swing while running; split stride in the air
    const legSwing = stride * 0.85 * run + air * 0.55;
    const legSwingR = -stride * 0.85 * run - air * 0.35;
    // arms: counter-swing while running, up while rising, out while falling or spinning
    let armF = -stride * 0.95 * run + breathe * 0.03;
    let armFR = stride * 0.95 * run + breathe * 0.03;
    const raise = air * (1 - falling) * 2.3;
    armF += raise; armFR += raise;
    const out = Math.max(air * falling * 1.1, sp * 1.4) + run * 0.08;
    const headNod = Math.sin(st.phase * 2) * 0.04 * run + breathe * 0.015 - air * 0.12;
    const lift = Math.abs(stride) * 2.5 * run;               // body bob while running

    let minZ = Infinity;
    for (const part of parts) {
      const { pos, rest, w, n } = part, arr = pos.array;
      for (let i = 0; i < n; i++) {
        p.set(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
        swing(p, { y: HIP.y, z: HIP.z }, legSwing, w.legL[i]);
        swing(p, { y: HIP.y, z: HIP.z }, legSwingR, w.legR[i]);
        swing(p, { y: SHOULDER.y, z: SHOULDER.z }, armF, w.armL[i]);
        swing(p, { y: SHOULDER.y, z: SHOULDER.z }, armFR, w.armR[i]);
        abduct(p, { x: -SHOULDER.x, z: SHOULDER.z }, -1, out, w.armL[i]);
        abduct(p, { x: SHOULDER.x, z: SHOULDER.z }, 1, out, w.armR[i]);
        swing(p, { y: NECK.y, z: NECK.z }, headNod, w.head[i]);
        if (w.legL[i] + w.legR[i] > 0.5 && p.z < minZ) minZ = p.z;
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
      }
    }
    // keep whichever foot is lowest on the ground while grounded; bob on top
    const drop = grounded && Number.isFinite(minZ) ? minZ - restMin : 0;
    for (const part of parts) {
      const arr = part.pos.array, off = -drop * (1 - air) + lift * (1 - air);
      for (let i = 2; i < arr.length; i += 3) arr[i] += off;
      part.pos.needsUpdate = true;
    }
  }
  return { update, state: st };
}
