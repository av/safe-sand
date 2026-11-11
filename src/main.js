import { createContext } from './gl.js';
import { SandSim, TW } from './sim.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { SandAudio } from './audio.js';
import { PRESETS, PRESET_ORDER } from './presets.js';
import { SCREENS, SCREEN_ORDER, drawScreen } from './screens.js';

const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const SUBSTEPS = 3;
const INTRO = 1.8;
const UA = navigator.userAgent;
const IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ANDROID = /Android/i.test(UA);
const QUALITY = [
  { dpr: 3, grains: 1 },
  { dpr: 2, grains: 1 },
  { dpr: 1.5, grains: 1 },
  { dpr: 1.5, grains: 0.75 },
  { dpr: 1.5, grains: 0.55 },
];

const canvas = document.getElementById('c');
const $ = (id) => document.getElementById(id);

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('sand.' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sand.' + k, JSON.stringify(v)); } catch {} },
};

const coarse = matchMedia('(pointer: coarse)').matches;
const ppi = Number(params.get('ppi')) || (coarse ? 160 : 96);
const mmPerPx = 25.4 / ppi;
const standalone = navigator.standalone || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;

let gl, sim, renderer, input, audio;
let presetKey = PRESETS[params.get('sand')] ? params.get('sand') : (PRESETS[store.get('preset')] ? store.get('preset') : 'river');
let screenKey = SCREENS[params.get('screen')] ? params.get('screen') : (SCREENS[store.get('screen')] ? store.get('screen') : 'light');
let qtyPct = Math.max(5, Math.round(Number(store.get('qtyPct')) || 100));
let soundOn = store.get('sound', true) !== false;
let hapticsOn = store.get('haptics', true) !== false;
let dpr = 1;
let view = { w: 0, h: 0, vw: 0, vh: 0, angle: -1, dpr: 0 };
let started = false;
let introT = 0;
let lastT = 0;
let running = !document.hidden;
let rafId = 0;
let lost = false;
let needsDraw = true;
let statsSeen = false;
let emptySince = 0;
let emptyShown = false;
let seed = Number(params.get('seed')) || (Date.now() % 100000);
const storedLevel = Number(store.get('quality', 0));
const perf = {
  level: Number.isInteger(storedLevel) ? Math.max(0, Math.min(QUALITY.length - 1, storedLevel - 1)) : 0,
  base: 0, idle: [], samples: [], t0: 0, hold: 0, pourEnd: 0, probe: 0, probeSamples: [], suspect: 0, ema: 16.7, median: 0, capped: false,
};
const hap = { jerk: -1e9, finger: -1e9, last: -1e9, peak: 0 };

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const TWfloor = (n) => Math.floor(n / TW) * TW;

function particleBudget(areaMm2) {
  const want = areaMm2 * (Number(params.get('density')) || 8);
  const minSide = Math.min(innerWidth, innerHeight);
  const cap = Number(params.get('n')) || (coarse ? (minSide > 600 ? 240000 : 200000) : 400000);
  return Math.max(65536, Math.min(cap, want));
}

function glObjects(obj) {
  const found = new Set();
  const visit = (v, d) => {
    if (!v || typeof v !== 'object' || d > 2) return;
    if (v instanceof WebGLTexture || v instanceof WebGLFramebuffer) found.add(v);
    else if (Array.isArray(v)) v.forEach((x) => visit(x, d + 1));
    else if (Object.getPrototypeOf(v) === Object.prototype) Object.values(v).forEach((x) => visit(x, d + 1));
  };
  Object.values(obj).forEach((v) => visit(v, 0));
  return found;
}

function replacing(obj, fn) {
  const before = glObjects(obj);
  fn();
  const after = glObjects(obj);
  for (const o of before) {
    if (after.has(o)) continue;
    if (o instanceof WebGLTexture) gl.deleteTexture(o);
    else gl.deleteFramebuffer(o);
  }
}

function screenAngle() {
  const o = screen.orientation;
  const legacy = typeof window.orientation === 'number' ? window.orientation : null;
  const a = IOS && legacy !== null ? legacy : (o && typeof o.angle === 'number' ? o.angle : legacy || 0);
  return ((Math.round(a / 90) * 90) % 360 + 360) % 360;
}

function layout(force = false) {
  const angle = coarse ? screenAngle() : 0;
  const vw = innerWidth, vh = innerHeight;
  const side = angle % 180 !== 0;
  const w = side ? vh : vw, h = side ? vw : vh;
  const want = Math.min(window.devicePixelRatio || 1, QUALITY[perf.level].dpr);
  if (!force && view.vw === vw && view.vh === vh && view.angle === angle && view.dpr === want) return false;
  view = { w, h, vw, vh, angle, dpr: want };
  dpr = want;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.style.left = (vw - w) / 2 + 'px';
  canvas.style.top = (vh - h) / 2 + 'px';
  canvas.style.transform = angle ? `rotate(${-angle}deg)` : '';
  const th = angle * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  input.toLocal = angle
    ? (x, y) => { const dx = x - vw / 2, dy = y - vh / 2; return [dx * c - dy * s + w / 2, dx * s + dy * c + h / 2]; }
    : (x, y) => [x, y];
  replacing(renderer, () => renderer.resize(canvas.width, canvas.height, Math.min(1, 1.2 / dpr)));
  refreshScreen();
  perf.hold = performance.now() + 2500;
  return true;
}

function refreshScreen() {
  const sc = SCREENS[screenKey];
  renderer.look.screenGain = sc.gain;
  renderer.look.shadowK = sc.shadowK;
  renderer.setScreen(drawScreen(screenKey, canvas.width, canvas.height, dpr));
  document.documentElement.style.background = screenKey === 'dark' ? '#050505' : '#111';
  document.body.classList.toggle('darkscreen', screenKey !== 'light');
  needsDraw = true;
}

function applyQuality() {
  if (!sim.count) return;
  sim.active = Math.min(sim.count, Math.max(65536, TWfloor(sim.count * QUALITY[perf.level].grains)));
}

function worldSize() { return [view.w * mmPerPx, view.h * mmPerPx]; }

function resetWorld(intro, amount = 1) {
  const [W, H] = worldSize();
  const budget = particleBudget(W * H);
  const target = Math.round(budget * qtyPct / 100);
  const TH = Math.max(1, Math.ceil(target / TW));
  const allocated = TW * TH;
  if (!sim.world || Math.abs(sim.world[0] - W) > 0.01 || Math.abs(sim.world[1] - H) > 0.01 || !sim.count || allocated !== sim.count) {
    replacing(sim, () => sim.resize(W, H, target));
  }
  sim.setPreset(PRESETS[presetKey]);
  sim.pour({ seed: seed++, intro, amount });
  applyQuality();
  introT = intro ? INTRO : 0;
  statsSeen = false;
  emptySince = 0;
  emptyShown = false;
  $('empty').classList.remove('show');
  needsDraw = true;
}

function readParticles() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, sim.state[sim.cur].fb);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  const A = new Float32Array(sim.count * 4);
  gl.readPixels(0, 0, TW, sim.TH, gl.RGBA, gl.FLOAT, A);
  gl.readBuffer(gl.COLOR_ATTACHMENT1);
  const B = new Float32Array(sim.count * 4);
  gl.readPixels(0, 0, TW, sim.TH, gl.RGBA, gl.FLOAT, B);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { A, B };
}

function remapWorld() {
  const [W, H] = worldSize();
  if (!sim.world) return resetWorld(false);
  if (Math.abs(sim.world[0] - W) < 0.5 && Math.abs(sim.world[1] - H) < 0.5) return;
  const { A, B } = readParticles();
  const sx = W / sim.world[0], sy = H / sim.world[1];
  for (let i = 0; i < sim.count; i++) {
    if (B[i * 4 + 3] < 0.5) continue;
    A[i * 4] = Math.min(W - 0.3, Math.max(0.3, A[i * 4] * sx));
    A[i * 4 + 1] = Math.min(H - 0.3, Math.max(0.3, A[i * 4 + 1] * sy));
  }
  replacing(sim, () => sim.resize(W, H, sim.count));
  for (const s of sim.state) {
    gl.bindTexture(gl.TEXTURE_2D, s.A);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TW, sim.TH, gl.RGBA, gl.FLOAT, A);
    gl.bindTexture(gl.TEXTURE_2D, s.B);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TW, sim.TH, gl.RGBA, gl.FLOAT, B);
  }
  applyQuality();
  needsDraw = true;
}

function onResize() {
  if (lost || !sim) return;
  if (layout()) remapWorld();
}

function buildGL() {
  const ctx = createContext(canvas);
  gl = ctx.gl;
  sim = new SandSim(gl, ctx.floatBlend);
  renderer = new Renderer(gl);
}

function init() {
  input = new Input(canvas, mmPerPx);
  if (params.has('flip')) input.sign = -input.sign;
  audio = new SandAudio();
  buildGL();
  layout(true);
  resetWorld(false, TEST || params.has('nopour') ? 1 : 0);
  buildMenu();
  bindPlatform();
  schedule();
}

function bindPlatform() {
  const block = (e) => { if (e.cancelable) e.preventDefault(); };
  document.addEventListener('touchmove', block, { passive: false });
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'contextmenu', 'selectstart', 'dragstart']) {
    document.addEventListener(ev, block, { passive: false });
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 60));
  screen.orientation?.addEventListener?.('change', onResize);
  document.addEventListener('visibilitychange', () => setRunning(!document.hidden));
  window.addEventListener('pagehide', () => setRunning(false));
  window.addEventListener('pageshow', () => setRunning(!document.hidden));
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    cancelLoop();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    try {
      buildGL();
      lost = false;
      layout(true);
      if (started && !TEST) resetWorld(true);
      else resetWorld(false, TEST ? 1 : 0);
      schedule();
    } catch (err) { fail(err); }
  });
  setInterval(() => { if (screenKey === 'lock' && !lost) refreshScreen(); }, 15000);
}

function setRunning(on) {
  if (on === running) return;
  running = on;
  if (on) {
    lastT = 0;
    perf.hold = performance.now() + 2500;
    perf.samples.length = 0;
    schedule();
    audio.resume();
    if (started) acquireWakeLock();
  } else {
    cancelLoop();
    audio.suspend();
  }
}

function schedule() {
  if (!rafId && running && !lost && !TEST) rafId = requestAnimationFrame(loop);
}

function cancelLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function pourEnvelope(t) {
  return Math.min(1, t / 0.15) * Math.max(0, Math.min(1, 1 - (t - 1.6) / 0.9));
}

function frame(dt) {
  const grav = input.gravity(dt);
  const fingers = input.fingers(dt, SUBSTEPS);
  sim.splat();
  for (let s = 0; s < SUBSTEPS; s++) {
    if (s === 2) sim.splat();
    sim.step(dt / SUBSTEPS, grav, fingers.map((f) => f.subs[s]));
  }
  renderer.draw(sim, input.light());
  const st = sim.readStats();
  if (st.volume > 0) statsSeen = true;
  introT = Math.max(0, introT - dt);
  const flowN = st.flow / Math.max(1, sim.world[0] * sim.world[1]) * 0.9;
  const level = Math.min(1, Math.pow(Math.max(0, flowN - 0.01) / 1000, 0.3));
  const pour = introT > 0 ? pourEnvelope(INTRO - introT) : 0;
  audio.update(level, pour, Math.max(0.85, Math.min(1.3, 0.19 / (PRESETS[presetKey].size?.[0] || 0.19))));
  haptics(level, fingers.length > 0, dt);
  const now = performance.now();
  if (started && introT === 0 && statsSeen) {
    if (st.coverage < 0.004) {
      if (!emptySince) emptySince = now;
      if (!emptyShown && now - emptySince > 900) { emptyShown = true; $('empty').classList.add('show'); }
    } else {
      emptySince = 0;
      if (emptyShown && st.coverage > 0.02) { emptyShown = false; $('empty').classList.remove('show'); }
    }
  }
  window.__stats = { ...st, flowN, level, fps: 1000 / perf.ema };
}

function haptics(level, touching, dt) {
  if (!hapticsOn || !started || !navigator.vibrate) return;
  const now = performance.now();
  if (input.hasMotion && Math.abs(Math.hypot(...input.motion) - 9.81) > 6) hap.jerk = now;
  if (touching) hap.finger = now;
  hap.peak = Math.max(level, hap.peak * Math.exp(-dt / 0.3));
  if (now - hap.jerk < 700 && now - hap.finger > 300 && hap.peak > 0.45 && level < hap.peak * 0.5 && now - hap.last > 450) {
    navigator.vibrate(Math.round(8 + 14 * Math.min(1, hap.peak)));
    hap.last = now;
    hap.peak = level;
  }
}

function loop(t) {
  rafId = 0;
  if (!running || lost) return;
  const raw = lastT ? t - lastT : 0;
  lastT = t;
  const idle = (!started && !needsDraw) || perf.probe > 0;
  if (raw > 0) measure(raw, idle);
  if (!idle) {
    frame(raw > 0 ? Math.min(raw / 1000, 1 / 30) : 1 / 60);
    needsDraw = false;
  }
  schedule();
}

function measure(ms, idle) {
  const now = performance.now();
  if (idle) {
    if (perf.probe > 0) {
      perf.probeSamples.push(ms);
      if (--perf.probe === 0) settleProbe(now);
    } else {
      perf.idle.push(ms);
      if (perf.idle.length > 90) perf.idle.shift();
      if (perf.idle.length >= 12) perf.base = median(perf.idle);
    }
    return;
  }
  perf.ema += (Math.min(ms, 250) - perf.ema) * 0.05;
  if (!started || (introT > 0 && now < perf.pourEnd) || now < perf.hold || perf.level >= QUALITY.length - 1) {
    perf.samples.length = 0;
    perf.t0 = now;
    return;
  }
  perf.samples.push(ms);
  if (now - perf.t0 < 2000 || perf.samples.length < 60) return;
  const s = perf.samples.slice().sort((x, y) => x - y);
  const med = s[s.length >> 1];
  const target = Math.max(perf.base || 1000 / 60, 1000 / 60);
  const slow = s.filter((x) => x > target * 1.5).length / s.length;
  perf.median = med;
  perf.samples.length = 0;
  perf.t0 = now;
  if (med > target * 1.3 || slow > 0.4) {
    perf.suspect = Math.max(med, target * 1.3);
    perf.probe = 6;
    perf.probeSamples = [];
  }
}

function settleProbe(now) {
  const idleMs = median(perf.probeSamples.slice(-4));
  perf.hold = now + 2500;
  if (idleMs > perf.suspect * 0.75) {
    perf.base = idleMs;
    perf.capped = true;
    return;
  }
  degrade();
}

function effective(level) {
  const q = QUALITY[level];
  return [Math.min(window.devicePixelRatio || 1, q.dpr), q.grains];
}

function degrade() {
  const cur = effective(perf.level).join();
  let next = perf.level;
  while (next < QUALITY.length - 1 && effective(next).join() === cur) next++;
  if (effective(next).join() === cur) return;
  perf.level = next;
  store.set('quality', next);
  layout();
  applyQuality();
  perf.hold = performance.now() + 3000;
}

let wakeLock = null;
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {}
}

function start() {
  if (started) return;
  started = true;
  const motion = input.requestMotion();
  if (soundOn) audio.start();
  if (ANDROID && !IOS && coarse && !standalone && !window.Capacitor && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.(screen.orientation.type))
      .catch(() => {});
  }
  acquireWakeLock();
  $('intro').classList.add('hide');
  document.body.classList.add('started');
  motion.then((ok) => {
    resetWorld(true);
    perf.hold = performance.now() + (INTRO + 2) * 1000;
    perf.pourEnd = performance.now() + 7000;
    if (!ok) toast('Motion access was declined. Drawing still works; reload to allow tilting.');
    else if (!coarse) toast('Drag to plow · arrow keys tilt · hold Space to shake');
    else setTimeout(() => { if (!input.lastMotionTime) toast('No motion sensor data. Drawing still works.'); }, 3000);
  });
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 4200);
}

function buildMenu() {
  const sandEls = [$('sands'), $('introSands')];
  const screenEls = [$('screens'), $('introScreens')];
  const sync = () => {
    sandEls.forEach((el) => [...el.children].forEach((c) => c.classList.toggle('on', c.dataset.k === presetKey)));
    screenEls.forEach((el) => [...el.children].forEach((c) => c.classList.toggle('on', c.dataset.k === screenKey)));
  };
  for (const el of sandEls) {
    for (const k of PRESET_ORDER) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.k = k;
      b.dataset.sand = k;
      b.style.setProperty('--c', PRESETS[k].swatch);
      b.innerHTML = `<i></i><span>${PRESETS[k].name}</span>`;
      b.onclick = () => {
        presetKey = k; store.set('preset', k); sync();
        if (started) { resetWorld(true); closeMenu(); }
      };
      el.appendChild(b);
    }
  }
  for (const el of screenEls) {
    for (const k of SCREEN_ORDER) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.k = k;
      b.textContent = SCREENS[k].name;
      b.onclick = () => { screenKey = k; store.set('screen', k); sync(); refreshScreen(); };
      el.appendChild(b);
    }
  }
  sync();
  $('picker').addEventListener('click', (e) => e.stopPropagation());
  const amount = $('amount');
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const dec = document.createElement('button');
  dec.type = 'button';
  dec.textContent = '−';
  dec.style.cssText = 'border:0;border-radius:50%;width:32px;height:32px;background:rgba(255,255,255,.09);color:#fff;font:inherit;font-size:16px;line-height:1;cursor:pointer;display:grid;place-items:center;';
  const val = document.createElement('span');
  val.textContent = `${qtyPct}%`;
  val.style.cssText = 'font-size:13.5px;color:#fff;min-width:44px;text-align:center;line-height:1;';
  const inc = document.createElement('button');
  inc.type = 'button';
  inc.textContent = '+';
  inc.style.cssText = 'border:0;border-radius:50%;width:32px;height:32px;background:rgba(255,255,255,.09);color:#fff;font:inherit;font-size:16px;line-height:1;cursor:pointer;display:grid;place-items:center;';
  let qtyTimer = null;
  const commitQty = () => {
    if (qtyTimer) clearTimeout(qtyTimer);
    qtyTimer = setTimeout(() => {
      qtyTimer = null;
      resetWorld(true);
      closeMenu();
    }, 800);
  };
  const apply = () => {
    val.textContent = `${qtyPct}%`;
    store.set('qtyPct', qtyPct);
    commitQty();
  };
  dec.onclick = () => { qtyPct = Math.max(5, qtyPct - 5); apply(); };
  inc.onclick = () => { qtyPct = qtyPct + 5; apply(); };
  wrap.appendChild(dec);
  wrap.appendChild(val);
  wrap.appendChild(inc);
  amount.appendChild(wrap);
  const snd = $('sound');
  const syncSound = () => { snd.textContent = soundOn ? 'Sound on' : 'Sound off'; snd.classList.toggle('on', soundOn); };
  syncSound();
  snd.onclick = () => {
    soundOn = !soundOn; store.set('sound', soundOn); syncSound();
    if (soundOn) audio.start();
    audio.setEnabled(soundOn);
  };
  const hb = $('haptics');
  if (coarse && navigator.vibrate) {
    const syncHaptics = () => { hb.textContent = hapticsOn ? 'Haptics on' : 'Haptics off'; hb.classList.toggle('on', hapticsOn); };
    syncHaptics();
    hb.onclick = () => { hapticsOn = !hapticsOn; store.set('haptics', hapticsOn); syncHaptics(); if (hapticsOn) navigator.vibrate(12); };
  } else hb.remove();
  $('pour').onclick = () => { resetWorld(true); closeMenu(); };
  $('emptyPour').onclick = () => resetWorld(true);
  $('menuBtn').onclick = (e) => { e.stopPropagation(); $('menu').classList.toggle('open'); };
  $('menu').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('intro').addEventListener('click', start);
  input.swallow = () => {
    if (!$('menu').classList.contains('open')) return false;
    closeMenu();
    return true;
  };
  let calm = 0;
  canvas.addEventListener('pointerdown', () => {
    closeMenu();
    audio.kick();
    if (!started && TEST) started = true;
    document.body.classList.add('playing');
    clearTimeout(calm);
  });
  const settle = () => { clearTimeout(calm); calm = setTimeout(() => document.body.classList.remove('playing'), 1800); };
  canvas.addEventListener('pointerup', settle);
  canvas.addEventListener('pointercancel', settle);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
}

function closeMenu() { $('menu').classList.remove('open'); }

function fail(err) {
  console.error(err);
  const intro = $('intro');
  intro.classList.remove('hide');
  intro.innerHTML = '<div class="card"><h1>Sand</h1><p></p></div>';
  intro.querySelector('p').textContent = err.message;
}

window.sand = {
  advance(frames = 1, dt = 1 / 60) { for (let i = 0; i < frames; i++) frame(dt); gl.finish(); },
  gravity(f) { input.override = f; },
  drag(points, frames = 30, r = 4.6) {
    const pts = points.map(([x, y]) => [x * mmPerPx, y * mmPerPx]);
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = lens[lens.length - 1];
    const at = (t) => {
      const d = t * total;
      for (let i = 1; i < pts.length; i++) if (d <= lens[i] || i === pts.length - 1) {
        const k = (d - lens[i - 1]) / Math.max(lens[i] - lens[i - 1], 1e-6);
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
      }
      return pts[pts.length - 1];
    };
    for (let f = 0; f < frames; f++) {
      const subs = [];
      for (let s = 0; s < SUBSTEPS; s++) {
        const a = at((f + s / SUBSTEPS) / frames), b = at((f + (s + 1) / SUBSTEPS) / frames);
        subs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], vx: (b[0] - a[0]) * 60 * SUBSTEPS, vy: (b[1] - a[1]) * 60 * SUBSTEPS, r });
      }
      input.synthetic = [{ subs, speed: 0 }];
      frame(1 / 60);
    }
    gl.finish();
  },
  reset(intro = false, s) { if (s !== undefined) seed = s; resetWorld(intro); },
  setPreset(k) { presetKey = k; resetWorld(false); },
  setScreen(k) { screenKey = k; refreshScreen(); },
  look: () => renderer.look,
  particles: readParticles,
  speedStats() {
    const { A, B } = readParticles();
    const sp = [];
    let air = 0, dead = 0;
    for (let i = 0; i < sim.count; i++) {
      if (B[i * 4 + 3] < 0.5) { dead++; continue; }
      if (B[i * 4] > 0) air++;
      sp.push(Math.hypot(A[i * 4 + 2], A[i * 4 + 3]));
    }
    sp.sort((a, b) => a - b);
    const q = (f) => +sp[Math.floor(f * (sp.length - 1))].toFixed(2);
    return { n: sp.length, dead, air, p50: q(0.5), p90: q(0.9), p99: q(0.99), max: q(1), moving: sp.filter((v) => v > 0.5).length };
  },
  stats: () => window.__stats,
  info: () => ({
    count: sim.count, active: sim.active, world: sim.world, grid: [sim.GW, sim.GH], dpr, mmPerPx, floatBlend: sim.floatBlend, maxPoint: renderer.maxPoint,
    angle: view.angle,
    audio: audio.ctx ? audio.ctx.state + (audio.node ? '' : ' (no worklet)') : 'off',
    quality: {
      level: perf.level, dprCap: QUALITY[perf.level].dpr, grains: QUALITY[perf.level].grains,
      fps: +(1000 / perf.ema).toFixed(1), medianMs: +perf.median.toFixed(2), baseHz: perf.base ? +(1000 / perf.base).toFixed(1) : null, capped: perf.capped,
    },
  }),
};

try {
  init();
} catch (err) {
  fail(err);
}
