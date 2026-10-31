// All sound is synthesized with the Web Audio API (no audio files): sound effects plus two looping chiptune themes.
// Browsers (iPad Safari especially) only allow audio after a tap, so everything waits for unlock().
let meter = null, ctx = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null;
let muted = false, theme = null, timer = null, nextTime = 0, step = 0;

try { muted = localStorage.getItem('cba-muted') === '1'; } catch {}

const SILENT_WAV = 'data:audio/wav;base64,UklGRvQHAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YdAHAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
let keepAlive = null;
// iPad/iPhone Safari silences Web Audio when the device is muted unless the page is also playing "media":
// ask for a playback audio session (iOS 17+) and loop a silent audio clip (older iOS).
function iosUnmute() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  try {
    if (!keepAlive) { keepAlive = new Audio(SILENT_WAV); keepAlive.loop = true; keepAlive.setAttribute('playsinline', ''); keepAlive.volume = 0.01; }
    const p = keepAlive.play(); if (p && p.catch) p.catch(() => {});
  } catch {}
}
export function unlock() {
  iosUnmute();
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = ctx.createDynamicsCompressor();                      // keeps loud moments (explosions) from clipping
      master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9;
      musicBus = ctx.createGain(); musicBus.gain.value = 0.28;
      sfxBus.connect(master); musicBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
      meter = ctx.createAnalyser(); meter.fftSize = 1024; comp.connect(meter);   // only used to check that sound is really coming out
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      if (theme) startScheduler();
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch {}
}
export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try { localStorage.setItem('cba-muted', m ? '1' : '0'); } catch {}
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.03);
}
// pause everything while the tab is hidden (saves battery, and the music scheduler can't pile up notes)
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend(); else ctx.resume();
});

const midi = n => 440 * Math.pow(2, (n - 69) / 12);
const ready = () => ctx && ctx.state !== 'closed';

// one oscillator note: frequency f (optionally gliding to f2), shaped by a short envelope
function tone({ f, f2, dur = 0.15, type = 'square', vol = 0.2, delay = 0, attack = 0.005, bus = sfxBus, vibrato = 0 }) {
  if (!ready()) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  if (vibrato) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 7; lg.gain.value = vibrato; l.connect(lg).connect(o.frequency); l.start(t); l.stop(t + dur + 0.05); }
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.05);
}
// filtered noise burst (whooshes, crashes, drums); the filter frequency sweeps from f0 to f1
function noise({ dur = 0.2, vol = 0.3, f0 = 1000, f1, q = 1, type = 'lowpass', delay = 0, bus = sfxBus }) {
  if (!ready()) return;
  const t = ctx.currentTime + delay, s = ctx.createBufferSource(), flt = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; s.loop = true; flt.type = type; flt.Q.value = q; flt.frequency.setValueAtTime(f0, t);
  if (f1) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(flt).connect(g).connect(bus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
}
const arp = (notes, gap, opts) => notes.forEach((n, i) => tone({ ...opts, f: midi(n), delay: (opts.delay || 0) + i * gap }));

// legacy-style blip, kept for small one-off sounds
export function blip(f, d = 0.1, type = 'square', vol = 0.06, slide = 0) {
  tone({ f, f2: slide ? Math.max(30, f + slide) : 0, dur: d, type, vol: vol * 3 });
}

const SFX = {
  jump: () => tone({ f: 280, f2: 620, dur: 0.14, type: 'square', vol: 0.16 }),
  land: () => { noise({ dur: 0.09, vol: 0.25, f0: 500, f1: 150 }); tone({ f: 110, f2: 55, dur: 0.1, type: 'sine', vol: 0.3 }); },
  spin: () => { noise({ dur: 0.28, vol: 0.28, f0: 500, f1: 2600, q: 3, type: 'bandpass' }); tone({ f: 380, f2: 760, dur: 0.22, type: 'sawtooth', vol: 0.07 }); },
  fruit: () => { tone({ f: midi(81), dur: 0.07, type: 'triangle', vol: 0.22 }); tone({ f: midi(88), dur: 0.14, type: 'triangle', vol: 0.22, delay: 0.06 }); },
  crate: () => { noise({ dur: 0.2, vol: 0.4, f0: 1800, f1: 300 }); tone({ f: 190, f2: 80, dur: 0.14, type: 'square', vol: 0.2 }); },
  checkpoint: () => arp([72, 76, 79, 84], 0.07, { dur: 0.16, type: 'triangle', vol: 0.25 }),
  oneup: () => arp([67, 72, 76, 79, 84, 88], 0.06, { dur: 0.14, type: 'square', vol: 0.17 }),
  aku: () => { arp([60, 64, 67, 72, 76, 79, 84], 0.05, { dur: 0.3, type: 'triangle', vol: 0.2, vibrato: 12 }); noise({ dur: 0.5, vol: 0.08, f0: 3000, f1: 6000, type: 'highpass' }); },
  hurt: () => { tone({ f: 330, f2: 80, dur: 0.35, type: 'sawtooth', vol: 0.25 }); noise({ dur: 0.2, vol: 0.25, f0: 2000, f1: 200 }); },
  die: () => { tone({ f: 440, f2: 90, dur: 0.8, type: 'sawtooth', vol: 0.22, vibrato: 25 }); tone({ f: 220, f2: 55, dur: 0.9, type: 'square', vol: 0.12, delay: 0.1 }); },
  squish: () => { tone({ f: 260, f2: 60, dur: 0.16, type: 'square', vol: 0.22 }); noise({ dur: 0.12, vol: 0.2, f0: 1500, f1: 200 }); },
  tick: () => tone({ f: 1100, dur: 0.05, type: 'square', vol: 0.16 }),
  boom: () => { noise({ dur: 0.9, vol: 0.85, f0: 1400, f1: 40 }); tone({ f: 95, f2: 28, dur: 0.7, type: 'sine', vol: 0.6 }); },
  throw: () => { tone({ f: 200, f2: 520, dur: 0.14, type: 'square', vol: 0.15 }); tone({ f: 320, f2: 140, dur: 0.2, type: 'sine', vol: 0.18, delay: 0.05 }); },
  throwBig: () => { tone({ f: 120, f2: 360, dur: 0.3, type: 'sawtooth', vol: 0.2 }); tone({ f: 200, f2: 70, dur: 0.4, type: 'sine', vol: 0.3, delay: 0.1 }); noise({ dur: 0.3, vol: 0.18, f0: 300, f1: 1200, type: 'bandpass', q: 2 }); },
  rockSmash: () => { noise({ dur: 0.16, vol: 0.3, f0: 2200, f1: 400, q: 2, type: 'bandpass' }); tone({ f: 140, f2: 70, dur: 0.1, type: 'square', vol: 0.14 }); },
  deflect: () => { tone({ f: 520, f2: 1100, dur: 0.16, type: 'sawtooth', vol: 0.2 }); tone({ f: 1500, dur: 0.3, type: 'triangle', vol: 0.15, delay: 0.05 }); noise({ dur: 0.25, vol: 0.2, f0: 800, f1: 4000, type: 'bandpass', q: 3 }); },
  bossHit: () => { SFX.boom(); tone({ f: 260, f2: 55, dur: 0.6, type: 'sawtooth', vol: 0.3, vibrato: 30 }); },
  bossLand: () => { noise({ dur: 0.16, vol: 0.3, f0: 350, f1: 90 }); tone({ f: 85, f2: 45, dur: 0.18, type: 'sine', vol: 0.4 }); },
  portal: () => { tone({ f: 200, f2: 1400, dur: 0.9, type: 'sine', vol: 0.22 }); arp([72, 76, 79, 84, 88, 91], 0.08, { dur: 0.35, type: 'triangle', vol: 0.15, delay: 0.3 }); },
  victory: () => { arp([72, 72, 72, 76, 79, 84], 0.13, { dur: 0.2, type: 'square', vol: 0.2 }); [72, 76, 79, 84].forEach(n => tone({ f: midi(n), dur: 1.2, type: 'triangle', vol: 0.16, delay: 0.85 })); },
  gameover: () => arp([69, 65, 62, 57], 0.28, { dur: 0.5, type: 'sawtooth', vol: 0.17 }),
  intro: () => { tone({ f: 70, f2: 50, dur: 0.9, type: 'sawtooth', vol: 0.3 }); noise({ dur: 0.9, vol: 0.2, f0: 200, f1: 900, type: 'lowpass' }); },
};
export function sfx(name) { if (!ready() || muted) return; const f = SFX[name]; if (f) f(); }

// ---------------- music ----------------
// Each theme is a 4-bar loop of 16 steps per bar: bass, lead and drums (null = rest).
const R = null;
const bassBar = (root, boss) => boss
  ? [root, root, R, root, root, R, root + 12, root, root, root, R, root, root + 7, R, root + 5, root]
  : [root, R, root, R, root + 7, R, root, R, root, R, root, R, root + 7, R, root + 3, R];
const THEMES = {
  level: {                       // jungle adventure: D minor, bouncy
    bpm: 128,
    bass: [38, 34, 41, 36].map(r => bassBar(r, false)),
    lead: [
      [74, R, 72, R, 69, R, 72, R, 74, R, R, R, 72, 69, 67, R],
      [70, R, 69, R, 65, R, 69, R, 70, R, R, R, 69, 65, 62, R],
      [72, R, 69, R, 65, R, 69, R, 72, R, R, R, 74, 72, 69, R],
      [67, R, 65, R, 67, R, 69, R, 72, R, 67, R, 69, R, R, R],
    ],
    kick: [1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0], hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
    leadType: 'square', leadVol: 0.07,
  },
  boss: {                        // boss fight: faster, driving, tense
    bpm: 152,
    bass: [38, 38, 34, 36].map(r => bassBar(r, true)),
    lead: [
      [62, R, 65, R, 68, R, 65, R, 62, R, 65, R, 69, R, 68, R],
      [62, R, 65, R, 68, R, 71, R, 74, R, 71, R, 68, R, 65, R],
      [58, R, 62, R, 65, R, 62, R, 58, R, 62, R, 67, R, 65, R],
      [60, R, 64, R, 67, R, 64, R, 60, R, 64, R, 70, R, 67, R],
    ],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1], hat: [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1],
    leadType: 'sawtooth', leadVol: 0.05,
  },
};
function playStep(th, s, t) {
  const bar = (s >> 4) % 4, i = s & 15, d = 60 / th.bpm / 4;
  const b = th.bass[bar][i], l = th.lead[bar][i];
  if (b != null) tone({ f: midi(b), dur: d * 1.7, type: 'triangle', vol: 0.5, delay: t - ctx.currentTime, bus: musicBus, attack: 0.01 });
  if (l != null) tone({ f: midi(l), dur: d * 1.6, type: th.leadType, vol: th.leadVol * 3, delay: t - ctx.currentTime, bus: musicBus, vibrato: 4 });
  if (th.kick[i]) tone({ f: 150, f2: 40, dur: 0.12, type: 'sine', vol: 0.7, delay: t - ctx.currentTime, bus: musicBus });
  if (th.snare[i]) noise({ dur: 0.12, vol: 0.28, f0: 1800, q: 0.8, type: 'bandpass', delay: t - ctx.currentTime, bus: musicBus });
  if (th.hat[i]) noise({ dur: 0.04, vol: 0.12, f0: 7000, type: 'highpass', delay: t - ctx.currentTime, bus: musicBus });
}
function startScheduler() {
  if (timer || !ctx) return;
  nextTime = ctx.currentTime + 0.08; step = 0;
  timer = setInterval(() => {                                   // look-ahead scheduler: queue notes a fraction of a second early so timing stays tight
    if (!ctx || !theme || ctx.state !== 'running') return;
    const th = THEMES[theme], d = 60 / th.bpm / 4;
    if (nextTime < ctx.currentTime - 0.8) nextTime = ctx.currentTime + 0.05;   // we fell behind (tab was paused): don't replay the backlog
    while (nextTime < ctx.currentTime + 0.4) { playStep(th, step, nextTime); nextTime += d; step = (step + 1) % 64; }
  }, 40);
}
export function music(name) {                                   // 'level', 'boss' or null (silence)
  if (name === theme) return;
  theme = name; step = 0;
  if (!ctx) return;                                             // picked up when unlock() runs
  if (name) { nextTime = ctx.currentTime + 0.08; startScheduler(); }
}

// debugging aid: current output loudness (0..1) and engine state
export function status() {
  let rms = 0;
  if (meter) { const d = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(d); rms = Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length); }
  return { state: ctx && ctx.state, theme, step, muted, rms };
}
