'use strict';

// Breathe — web edition, for use away from the Mac. Same techniques, timings,
// singing bowls and chimes as the iOS app. The logic mirrors
// Shared/BreathingModels.swift, Shared/BreathingEngine.swift and
// Breathe/BowlSounds.swift, so the two behave alike.
//
// The guided recordings are not part of the site: GitHub Pages is public, and
// they aren't ours to publish. Each one is picked once from the device's own
// files, kept in the browser's storage on that device, and never uploaded.

// ------------------------------------------------------------- Breathing model

const PHASE_LABEL = { inhale: 'Inhale', hold: 'Hold', exhale: 'Exhale' };
const BOWL_FOR_PHASE = { inhale: 'bowl-inhale', hold: 'bowl-hold', exhale: 'bowl-exhale' };
const COUNTDOWN_SECONDS = 5;
const EXPANDED = 1;
const CONTRACTED = 0.6;

/** Expand a plan into every timed step of the session (BreathingPlan.makeSteps). */
function makeSteps({ inhale, hold1, exhale, hold2, rounds }) {
  const cycle = [];
  if (inhale > 0) cycle.push({ phase: 'inhale', duration: inhale, expanded: true, countsAsCycle: false });
  if (hold1 > 0) cycle.push({ phase: 'hold', duration: hold1, expanded: true, countsAsCycle: false });
  if (exhale > 0) cycle.push({ phase: 'exhale', duration: exhale, expanded: false, countsAsCycle: false });
  if (hold2 > 0) cycle.push({ phase: 'hold', duration: hold2, expanded: false, countsAsCycle: false });
  if (!cycle.length) return [];
  cycle[cycle.length - 1].countsAsCycle = true;
  const steps = [];
  for (let r = 0; r < Math.max(rounds, 1); r++) cycle.forEach(step => steps.push({ ...step }));
  return steps;
}

const TECHNIQUES = [
  {
    id: 'box', name: 'Box Breathing', tagline: 'Steady & focus', icon: 'box', tint: '#5A6BE0',
    description: 'Equal counts in, hold, out, hold. Steadies the nervous system and sharpens concentration.',
  },
  {
    id: 'fourSevenEight', name: '4 7 8', tagline: 'Calm & sleep', icon: 'moonStars', tint: '#6E56C7',
    description: 'A long, slow exhale that calms the body and helps with sleep and anxiety.',
  },
];

const BOX_LENGTHS = [5, 6, 7, 8];
const ROUND_OPTIONS = [5, 10, 15, 20];

/** The one place a technique becomes a runnable session (TechniqueKind.makeSessionConfig). */
function makeSessionConfig(id, p) {
  if (id === 'box') {
    return {
      title: 'Box Breathing',
      plan: { inhale: p.boxLength, hold1: p.boxLength, exhale: p.boxLength, hold2: p.boxLength, rounds: p.boxRounds },
    };
  }
  return { title: '4 7 8', plan: { inhale: 4, hold1: 7, exhale: 8, hold2: 0, rounds: p.fourRounds } };
}

const GUIDES = [
  { id: 'rob-lenfestey', title: 'Rob Lenfestey', subtitle: 'Guided · 25 min', icon: 'waveform', tint: '#4E7BD1' },
  { id: 'rob-3', title: 'Rob Lenfestey 3', subtitle: 'Guided · 16 min', icon: 'waveform', tint: '#5A6BE0' },
  { id: 'nsdr', title: 'Huberman NSDR', subtitle: 'Guided · 9 min', icon: 'moonZzz', tint: '#4E5FA8' },
  { id: 'wim-hof', title: 'Wim Hof Live', subtitle: 'Guided · 11 min', icon: 'waveform', tint: '#8A79E6' },
  { id: 'insignificance', title: 'Insignificance', subtitle: 'Reflection · 1 min', icon: 'sparkles', tint: '#6C63C4', reflection: true },
  { id: 'alive', title: 'Alive', subtitle: 'Reflection · 2 min', icon: 'sun', tint: '#7F77DD', reflection: true },
];
const guideById = id => GUIDES.find(g => g.id === id);

/** Work out which guide a picked file is, from its name — both the app's own
 *  file names (guided-rob-3.m4a) and the originals (Rob Lenfestey 3.m4a). */
function matchGuide(fileName) {
  const n = ` ${fileName.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const has = word => n.includes(` ${word} `);
  if ((has('rob') || has('lenfestey')) && has('3')) return 'rob-3';
  if (has('rob') || has('lenfestey')) return 'rob-lenfestey';
  if (has('nsdr') || has('huberman')) return 'nsdr';
  if (has('wim') || has('hof')) return 'wim-hof';
  if (has('insignificance')) return 'insignificance';
  if (has('alive') || has('sadhguru')) return 'alive';
  return null;
}

/** Elapsed time as clock text: padded "05:03", otherwise "5:03". */
function clock(seconds, padded = false) {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  return `${padded ? String(m).padStart(2, '0') : m}:${String(total % 60).padStart(2, '0')}`;
}

/** A live breathing session, timed off the clock rather than counted ticks, so
 *  it stays accurate if the browser throttles the page. t < 0 is the countdown. */
class BreathSession {
  constructor(config) {
    this.config = config;
    let at = 0;
    this.timeline = makeSteps(config.plan).map(step => {
      const timed = { ...step, start: at, end: at + step.duration };
      at += step.duration;
      return timed;
    });
    this.total = at;
    this.cycleEnds = this.timeline.filter(s => s.countsAsCycle).map(s => s.end);
    this.totalCycles = this.cycleEnds.length;
    this.origin = performance.now() + COUNTDOWN_SECONDS * 1000;
    this.index = 0;
    this.paused = false;
    this.pausedAt = 0;
    this.finished = false;
  }

  seconds() {
    return ((this.paused ? this.pausedAt : performance.now()) - this.origin) / 1000;
  }

  togglePause() {
    if (this.paused) {
      this.origin += performance.now() - this.pausedAt;
      this.paused = false;
    } else {
      this.pausedAt = performance.now();
      this.paused = true;
    }
  }

  cyclesDone(t) {
    return this.cycleEnds.filter(end => end <= t).length;
  }

  state() {
    const t = this.seconds();
    if (t < 0) return { countingDown: true, countdown: Math.ceil(-t) };
    if (!this.timeline.length || t >= this.total) return { done: true };
    while (this.index < this.timeline.length - 1 && t >= this.timeline[this.index].end) this.index++;
    const step = this.timeline[this.index];
    return {
      t,
      index: this.index,
      step,
      remaining: Math.ceil(step.end - t),
      cycles: this.cyclesDone(t),
      elapsed: Math.floor(t),
    };
  }
}

// ---------------------------------------------------------------- Preferences

// Same keys as the iOS app's BreatheOptions.
const PREF = {
  boxLength: 'opt.box.length',
  boxRounds: 'opt.box.rounds',
  fourRounds: 'opt.four.rounds',
  sound: 'soundEnabled',
  awake: 'keepScreenAwake',
};

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: just won't persist */ }
  },
};

const oneOf = (value, options, fallback) => (options.includes(value) ? value : fallback);

function prefs() {
  return {
    boxLength: oneOf(store.get(PREF.boxLength, 5), BOX_LENGTHS, 5),
    boxRounds: oneOf(store.get(PREF.boxRounds, 5), ROUND_OPTIONS, 5),
    fourRounds: oneOf(store.get(PREF.fourRounds, 5), ROUND_OPTIONS, 5),
    sound: store.get(PREF.sound, true) !== false,
    awake: store.get(PREF.awake, true) !== false,
  };
}

// ------------------------------------------------- Recordings kept on the device

const Recordings = {
  db: null,
  available: true,
  urls: {},
  meta: {},

  async init() {
    try {
      this.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('breathe', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('recordings');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const [keys, rows] = await Promise.all([
        this.request('readonly', s => s.getAllKeys()),
        this.request('readonly', s => s.getAll()),
      ]);
      keys.forEach((id, i) => this.remember(id, rows[i]));
    } catch {
      this.available = false;
    }
  },

  request(mode, run) {
    return new Promise((resolve, reject) => {
      const req = run(this.db.transaction('recordings', mode).objectStore('recordings'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  remember(id, row) {
    if (!row || !row.blob) return;
    if (this.urls[id]) URL.revokeObjectURL(this.urls[id]);
    this.urls[id] = URL.createObjectURL(row.blob);
    this.meta[id] = { name: row.name, size: row.size };
  },

  has(id) { return Boolean(this.urls[id]); },

  async add(id, file) {
    const row = { blob: file, name: file.name, size: file.size, added: Date.now() };
    await this.request('readwrite', s => s.put(row, id));
    this.remember(id, row);
    // Ask the browser not to clear storage under pressure (best effort).
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* optional */ }
  },

  async remove(id) {
    await this.request('readwrite', s => s.delete(id));
    if (this.urls[id]) URL.revokeObjectURL(this.urls[id]);
    delete this.urls[id];
    delete this.meta[id];
  },
};

// ------------------------------------------------------------------- Sound

// Singing bowls and chimes through Web Audio, so a bowl can be faded out on
// short phases exactly as the iPhone does (iOS ignores volume on <audio>).
const Sound = {
  ctx: null,
  buffers: {},
  loading: null,
  last: {},
  NAMES: ['bowl-inhale', 'bowl-hold', 'bowl-exhale', 'wind-chimes'],

  /** Call from a tap: browsers only allow audio to start from a user gesture. */
  unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* Safari 17+ only */ }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return Promise.resolve();
    if (!this.ctx) this.ctx = new Ctx();
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    // A silent blip inside the gesture fully wakes audio on older iOS.
    const blip = this.ctx.createBufferSource();
    blip.buffer = this.ctx.createBuffer(1, 1, 22050);
    blip.connect(this.ctx.destination);
    blip.start(0);
    if (!this.loading) this.loading = Promise.all(this.NAMES.map(n => this.load(n).catch(() => {})));
    return this.loading;
  },

  async load(name) {
    const data = await (await fetch(`sounds/${name}.m4a`)).arrayBuffer();
    this.buffers[name] = await new Promise((resolve, reject) => this.ctx.decodeAudioData(data, resolve, reject));
  },

  /** Strike a sound. Restarts that same sound if it's still ringing; other
   *  bowls keep ringing underneath. `fadeOver` seconds fades it to silence. */
  play(name, fadeOver = 0) {
    const buffer = this.buffers[name];
    if (!buffer || !this.ctx) return;
    try { if (this.last[name]) this.last[name].stop(); } catch { /* already ended */ }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    source.connect(gain);
    gain.connect(this.ctx.destination);
    const now = this.ctx.currentTime;
    if (fadeOver > 0) {
      gain.gain.setValueAtTime(1, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + fadeOver);
    }
    source.start(now);
    this.last[name] = source;
  },

  stopAll() {
    Object.values(this.last).forEach(source => { try { source.stop(); } catch { /* already ended */ } });
    this.last = {};
  },
};

// Keep the screen on during a breathing session (the iPhone's "Keep screen awake").
const Wake = {
  sentinel: null,
  wanted: false,
  /** Resolves false only if the user wants the screen kept on and we couldn't. */
  async request() {
    this.wanted = true;
    if (!prefs().awake) return true;
    if (!('wakeLock' in navigator)) return false;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      return true;
    } catch {
      return false;
    }
  },
  release() {
    this.wanted = false;
    if (this.sentinel) this.sentinel.release().catch(() => {});
    this.sentinel = null;
  },
};
document.addEventListener('visibilitychange', () => {
  // The browser drops the lock when the page is hidden; take it back on return.
  if (document.visibilityState === 'visible' && Wake.wanted) Wake.request();
});

// ------------------------------------------------------------------- Icons

const ICONS = {
  box: '<rect x="4" y="4" width="16" height="16" rx="3.5" stroke-dasharray="3.2 2.7"/>',
  moonStars: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.2 6.2 0 0 0 10.5 10.5z"/><path d="M17 3v3M15.5 4.5h3"/>',
  moonZzz: '<path d="M18.5 15.5A7.5 7.5 0 1 1 8.5 5.5a5.8 5.8 0 0 0 10 10z"/><path d="M14 3h3l-3 3.2h3M19 7.2h2l-2 2.3h2"/>',
  waveform: '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3"/>',
  sparkles: '<path d="M11 3.5l1.8 4.7 4.7 1.8-4.7 1.8L11 16.5l-1.8-4.7L4.5 10l4.7-1.8z"/><path d="M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  chevron: '<path d="M9 5.5l6.5 6.5L9 18.5"/>',
  playCircle: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M10 8.3v7.4l6-3.7z" fill="#0D0B14" stroke="none"/>',
  plusCircle: '<circle cx="12" cy="12" r="9.5"/><path d="M12 8v8M8 12h8"/>',
  play: '<path d="M7 4.5v15l12.5-7.5z"/>',
  pause: '<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>',
  stop: '<rect x="5.5" y="5.5" width="13" height="13" rx="2"/>',
  check: '<circle cx="12" cy="12" r="11" fill="currentColor"/><path d="M7 12.4l3.3 3.3L17.2 8.6" stroke="#0D0B14" stroke-width="2.4" fill="none"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cycles: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  mind: '<path d="M12 5.5A3 3 0 0 0 6.5 5 3 3 0 0 0 4 9.3a3.2 3.2 0 0 0 .4 5.3A3 3 0 0 0 8 19a3 3 0 0 0 4 .5z"/><path d="M12 5.5A3 3 0 0 1 17.5 5 3 3 0 0 1 20 9.3a3.2 3.2 0 0 1-.4 5.3A3 3 0 0 1 16 19a3 3 0 0 1-4 .5z"/><path d="M12 5.5v14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};

const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

// ----------------------------------------------------------------- Helpers

const app = document.getElementById('app');
const pickOne = document.getElementById('pick-one');
const pickMany = document.getElementById('pick-many');
const toastEl = document.getElementById('toast');

const esc = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(' ');
const megabytes = bytes => `${(bytes / 1e6).toFixed(1)} MB`;
const isIOS = () => /iP(hone|od|ad)/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

let toastTimer = 0;
function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

// ----------------------------------------------------- Screens and navigation

const ui = { view: 'home', teardown: null, onKey: null, pendingGuide: null };

/** Swap the whole screen. `teardown` runs when this screen is next replaced. */
function setScreen(view, html, teardown = null) {
  if (ui.teardown) ui.teardown();
  ui.teardown = teardown;
  ui.onKey = null;
  ui.view = view;
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

// One history entry for "away from Home", so the browser's Back button (and
// Android's back gesture) returns home rather than leaving the site.
function leaveHome() {
  if (ui.view === 'home') history.pushState({ breathe: true }, '');
}
function goHome() {
  if (history.state && history.state.breathe) history.back();
  else showHome();
}
window.addEventListener('popstate', () => showHome());

document.addEventListener('keydown', event => {
  if (ui.onKey && !event.metaKey && !event.ctrlKey && !event.altKey) ui.onKey(event);
});

function card({ action, id, iconName, tint, title, sub, trail }) {
  return `
    <button class="card" data-action="${action}" data-id="${id}" style="--tint:${rgb(tint)}">
      <span class="card-icon">${icon(iconName)}</span>
      <span class="card-text">
        <span class="card-title">${esc(title)}</span>
        <span class="card-sub">${esc(sub)}</span>
      </span>
      <span class="card-trail">${icon(trail)}</span>
    </button>`;
}

// --------------------------------------------------------------------- Home

function showHome() {
  const guideCard = g => {
    const ready = Recordings.has(g.id);
    return card({
      action: 'open-guide', id: g.id, iconName: g.icon, tint: g.tint, title: g.title,
      // The section heading already says Guided / Reflections, so drop it here
      // to keep "tap to add" on one line on a phone.
      sub: ready ? g.subtitle : `${g.subtitle.split(' · ').pop()} · tap to add`,
      trail: ready ? 'playCircle' : 'plusCircle',
    });
  };
  const showHint = isIOS() && !isStandalone() && !store.get('hint.install', false);

  setScreen('home', `
    <section class="home">
      <div class="home-top">
        <button class="icon-btn" data-action="settings" aria-label="Settings">${icon('gear')}</button>
      </div>
      <h1>Life is Here &amp; Now</h1>

      <div class="section-label">Techniques</div>
      <div class="grid">
        ${TECHNIQUES.map(t => card({
          action: 'open-technique', id: t.id, iconName: t.icon, tint: t.tint,
          title: t.name, sub: t.tagline, trail: 'chevron',
        })).join('')}
      </div>

      <div class="section-label">Guided</div>
      <div class="grid">${GUIDES.filter(g => !g.reflection).map(guideCard).join('')}</div>

      <div class="section-label">Reflections</div>
      <div class="grid">${GUIDES.filter(g => g.reflection).map(guideCard).join('')}</div>

      ${showHint ? `
        <div class="hint">
          <span>Install it: tap <b>Share</b>, then <b>Add to Home Screen</b>. It then opens full-screen and works offline.</span>
          <button data-action="dismiss-hint" aria-label="Dismiss">${icon('close')}</button>
        </div>` : ''}
    </section>`);
}

// -------------------------------------------------------------------- Setup

function segmented(title, key, options, value, unit = '') {
  return `
    <div class="panel">
      <h3>${title}</h3>
      <div class="segmented" role="group" aria-label="${title}">
        ${options.map(o => `<button data-action="choose" data-key="${key}" data-value="${o}" aria-pressed="${o === value}">${o}${unit}</button>`).join('')}
      </div>
    </div>`;
}

function showSetup(id) {
  const technique = TECHNIQUES.find(t => t.id === id);
  const p = prefs();
  const options = id === 'box'
    ? segmented('Breath length', PREF.boxLength, BOX_LENGTHS, p.boxLength, 's') +
      segmented('Rounds', PREF.boxRounds, ROUND_OPTIONS, p.boxRounds)
    : segmented('Rounds', PREF.fourRounds, ROUND_OPTIONS, p.fourRounds);

  setScreen('setup', `
    <section class="sheet">
      <div class="sheet-bar">
        <button class="text-btn left" data-action="home">Close</button>
        <h2>${esc(technique.name)}</h2>
        <span></span>
      </div>
      <p class="desc">${esc(technique.description)}</p>
      ${options}
      <div class="spacer"></div>
      <button class="primary" data-action="start" data-id="${id}">Start</button>
    </section>`);
  ui.onKey = e => { if (e.key === 'Escape') goHome(); };
}

// ---------------------------------------------------------- Breathing session

const TONE_COLOR = { accent: '#7F77DD', inhale: '#3E33A6', exhale: '#51306E' };

function controls(paused) {
  return `
    <button class="ctrl" data-action="toggle-pause">
      <span class="ctrl-circle">${icon(paused ? 'play' : 'pause', 'fill')}</span>
      <span>${paused ? 'Resume' : 'Pause'}</span>
    </button>
    <button class="ctrl stop" data-action="stop">
      <span class="ctrl-circle">${icon('stop', 'fill')}</span>
      <span>Stop</span>
    </button>`;
}

function startSession(config) {
  const session = new BreathSession(config);
  const soundOn = prefs().sound;
  let frame = 0;

  setScreen('session', `
    <section class="screen">
      <header class="s-head">
        <h2>${esc(config.title)}</h2>
        <div class="s-meta">${icon('clock')}<span data-el="elapsed">00:00</span></div>
      </header>
      <div class="s-stage">
        <div class="orb-wrap" data-el="orb">
          <div class="orb-glow" data-el="glow"></div>
          <div class="orb" data-el="ball">
            <div class="tone accent on"></div><div class="tone inhale"></div><div class="tone exhale"></div>
          </div>
          <div class="orb-text">
            <div class="orb-label" data-el="label">Get ready</div>
            <div class="orb-count" data-el="count">${COUNTDOWN_SECONDS}</div>
          </div>
        </div>
      </div>
      <div class="s-below"><p class="s-round" data-el="round">Starting…</p></div>
      <div class="controls" data-el="controls">${controls(false)}</div>
    </section>`,
    () => { cancelAnimationFrame(frame); Wake.release(); });

  const el = name => app.querySelector(`[data-el="${name}"]`);
  const els = {
    elapsed: el('elapsed'), orb: el('orb'), glow: el('glow'), ball: el('ball'),
    label: el('label'), count: el('count'), round: el('round'), controls: el('controls'),
  };

  const setOrb = (scale, tone, seconds) => {
    els.orb.style.setProperty('--d', `${seconds}s`);
    els.orb.style.setProperty('--s', String(scale));
    els.ball.querySelectorAll('.tone').forEach(t => t.classList.toggle('on', t.classList.contains(tone)));
    els.glow.style.backgroundColor = TONE_COLOR[tone];
    els.ball.style.boxShadow = `0 0 calc(var(--side) * .09) ${TONE_COLOR[tone]}80`;
  };
  setOrb(CONTRACTED, 'accent', 0.4);

  let lastIndex = -1;
  let lastText = '';

  const render = () => {
    const st = session.state();
    if (st.done) { finishSession(session, false); return; }

    let label, count, round, elapsed;
    if (st.countingDown) {
      label = 'Get ready';
      count = st.countdown;
      round = 'Starting…';
      elapsed = 0;
    } else {
      const step = st.step;
      if (st.index !== lastIndex) {
        lastIndex = st.index;
        const tone = step.phase === 'inhale' ? 'inhale'
          : step.phase === 'exhale' ? 'exhale'
          : (step.expanded ? 'inhale' : 'exhale');
        setOrb(step.expanded ? EXPANDED : CONTRACTED, tone, Math.max(step.duration, 0.4));
        // Only strike if we're on time — not when catching up after the page
        // was hidden, which would ring a bowl in the middle of a phase.
        if (soundOn && st.t - step.start < 1) {
          Sound.play(BOWL_FOR_PHASE[step.phase], step.duration <= 3 ? Math.max(step.duration - 0.4, 0.6) : 0);
        }
      }
      label = PHASE_LABEL[step.phase];
      count = st.remaining;
      round = `Round ${Math.min(st.cycles + 1, Math.max(session.totalCycles, 1))} of ${session.totalCycles}`;
      elapsed = st.elapsed;
    }

    const text = `${label}|${count}|${round}|${elapsed}`;
    if (text !== lastText) {
      if (st.countingDown && lastText && navigator.vibrate) navigator.vibrate(12);
      lastText = text;
      els.label.textContent = label;
      els.count.textContent = count > 0 ? String(count) : '';
      els.round.textContent = round;
      els.elapsed.textContent = clock(elapsed, true);
    }
    frame = requestAnimationFrame(render);
  };

  const togglePause = () => {
    session.togglePause();
    els.controls.innerHTML = controls(session.paused);
  };

  ui.session = { togglePause, stop: () => finishSession(session, true) };
  ui.onKey = e => {
    if (e.key === ' ') {
      e.preventDefault();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      togglePause();
    } else if (e.key === 'Escape') {
      finishSession(session, true);
    }
  };

  Wake.request().then(ok => {
    // Say so rather than let the screen sleep mid-session: a locked phone
    // suspends the page, and the bowls stop with it.
    if (!ok && !Wake.warned) {
      Wake.warned = true;
      toast('This browser won’t keep the screen on — set Auto-Lock to Never while you practise.');
    }
  });
  frame = requestAnimationFrame(render);
}

function finishSession(session, early) {
  if (session.finished) return;
  session.finished = true;
  const t = Math.min(Math.max(session.seconds(), 0), session.total);
  const duration = early ? Math.floor(t) : session.total;
  const cycles = early ? session.cyclesDone(t) : session.totalCycles;
  // Wind chimes close the session, finished or stopped, as on the iPhone.
  if (prefs().sound) Sound.play('wind-chimes');
  ui.session = null;
  showSummary({ title: session.config.title, duration, cycles, hideCycles: false }, () => Sound.stopAll());
}

// ------------------------------------------------------------- Guided audio

function clearMediaSession() {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    ['play', 'pause'].forEach(a => navigator.mediaSession.setActionHandler(a, null));
  } catch { /* partial support */ }
}

function setMediaSession(title, player) {
  if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: 'Breathe',
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    navigator.mediaSession.setActionHandler('play', () => player.play());
    navigator.mediaSession.setActionHandler('pause', () => player.pause());
    // Play and pause only — skipping around a guided session makes no sense.
    ['seekbackward', 'seekforward', 'previoustrack', 'nexttrack', 'seekto'].forEach(a => {
      try { navigator.mediaSession.setActionHandler(a, null); } catch { /* not supported */ }
    });
  } catch { /* partial support */ }
}

/** Must run inside the tap: iOS only starts playback from a user gesture. */
function startGuide(id) {
  const guide = guideById(id);
  const player = new Audio();
  player.preload = 'auto';
  player.src = Recordings.urls[id];
  const started = Date.now();
  const playing = player.play();
  let ended = false;

  setScreen('audio', `
    <section class="screen" data-el="screen">
      <header class="s-head">
        <h2>${esc(guide.title)}</h2>
        <div class="s-meta">${icon('clock')}<span data-el="clock">0:00</span></div>
      </header>
      <div class="s-stage">
        <div class="pulse-orb" style="--tint:${rgb(guide.tint)}">${icon(guide.icon)}</div>
      </div>
      <div class="s-below">
        <div class="progress">
          <div class="bar"><i data-el="bar"></i></div>
          <div class="times"><span data-el="pos">0:00</span><span data-el="left">-0:00</span></div>
        </div>
        <button class="tap-to-play" data-el="tap" hidden>Tap to play</button>
      </div>
      <div class="controls" data-el="controls">${controls(false)}</div>
    </section>`,
    () => {
      // Leaving mid-play (e.g. the browser's Back button).
      detach();
      player.pause();
      player.removeAttribute('src');
      player.load();
      clearMediaSession();
    });

  const el = name => app.querySelector(`[data-el="${name}"]`);
  const els = {
    screen: el('screen'), clock: el('clock'), bar: el('bar'),
    pos: el('pos'), left: el('left'), tap: el('tap'), controls: el('controls'),
  };

  const onTime = () => {
    const d = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 0;
    const now = player.currentTime;
    els.clock.textContent = clock(now);
    els.pos.textContent = clock(now);
    els.left.textContent = `-${clock(Math.max(d - now, 0))}`;
    els.bar.style.width = d ? `${Math.min(now / d, 1) * 100}%` : '0';
  };
  const onPlayState = () => {
    const paused = player.paused;
    els.controls.innerHTML = controls(paused);
    els.screen.classList.toggle('is-paused', paused);
    if (!paused) els.tap.hidden = true;
    try { navigator.mediaSession.playbackState = paused ? 'paused' : 'playing'; } catch { /* optional */ }
  };
  const onEnded = () => end();

  const events = { timeupdate: onTime, loadedmetadata: onTime, play: onPlayState, pause: onPlayState, ended: onEnded };
  Object.entries(events).forEach(([name, fn]) => player.addEventListener(name, fn));
  function detach() {
    Object.entries(events).forEach(([name, fn]) => player.removeEventListener(name, fn));
  }

  /** End of the guide, natural or stopped: ring the closing bowl and show the
   *  summary. The bowl plays on the same element, which the tap already
   *  unlocked — so it sounds even if the guide ends with the screen locked. */
  function end() {
    if (ended) return;
    ended = true;
    detach();
    player.pause();
    const duration = (Date.now() - started) / 1000;
    player.src = 'sounds/bowl-exhale.m4a';
    player.play().catch(() => {});
    ui.teardown = null;  // keep the player alive for the bell
    ui.audio = null;
    showSummary({ title: guide.title, duration, cycles: 0, hideCycles: true }, () => {
      player.pause();
      player.removeAttribute('src');
      player.load();
      clearMediaSession();
    });
  }

  const toggle = () => (player.paused ? player.play().catch(() => {}) : player.pause());
  ui.audio = { toggle, stop: end, tap: () => player.play().catch(() => {}) };
  ui.onKey = e => {
    if (e.key === ' ') {
      e.preventDefault();
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      toggle();
    } else if (e.key === 'Escape') {
      end();
    }
  };

  setMediaSession(guide.title, player);
  if (playing && playing.catch) {
    playing.catch(() => {
      // Autoplay refused — offer a plain button rather than silence.
      els.tap.hidden = false;
      onPlayState();
    });
  }
}

// ------------------------------------------------------------------ Summary

function showSummary({ title, duration, cycles, hideCycles }, teardown) {
  const tile = (iconName, value, label) =>
    `<div class="tile">${icon(iconName)}<b>${value}</b><span>${label}</span></div>`;
  setScreen('summary', `
    <section class="summary">
      <div class="check">${icon('check')}</div>
      <div>
        <h2>Nice work</h2>
        <p class="sub">${esc(title)}</p>
      </div>
      <div class="tiles">
        ${tile('clock', clock(duration), 'Duration')}
        ${hideCycles ? '' : tile('cycles', cycles, 'Cycles')}
        ${tile('mind', (duration / 60).toFixed(1), 'Mindful min')}
      </div>
      <p class="note">The web version doesn't save to Apple Health.</p>
      <button class="primary" data-action="home">Done</button>
    </section>`, teardown);
  ui.onKey = e => { if (e.key === 'Enter' || e.key === 'Escape') goHome(); };
}

// ----------------------------------------------------------------- Settings

function toggleRow(label, key, on) {
  return `
    <div class="row">
      <div class="row-text">${label}</div>
      <label class="switch">
        <input type="checkbox" data-pref="${key}" ${on ? 'checked' : ''} aria-label="${label}">
        <span class="knob"></span>
      </label>
    </div>`;
}

function showSettings() {
  const p = prefs();
  const recordingRow = g => {
    const m = Recordings.meta[g.id];
    return `
      <div class="row">
        <span class="row-icon" style="--tint:${rgb(g.tint)}">${icon(g.icon)}</span>
        <div class="row-text">
          <div>${esc(g.title)}</div>
          <div class="row-sub">${m ? `${esc(m.name)} · ${megabytes(m.size)}` : 'Not added'}</div>
        </div>
        ${m
          ? `<button class="small-btn danger" data-action="remove-guide" data-id="${g.id}">Remove</button>`
          : `<button class="small-btn" data-action="add-guide" data-id="${g.id}">Add…</button>`}
      </div>`;
  };
  const noWakeLock = !('wakeLock' in navigator);

  setScreen('settings', `
    <section class="sheet">
      <div class="sheet-bar">
        <span></span>
        <h2>Settings</h2>
        <button class="text-btn right" data-action="home">Done</button>
      </div>

      <div>
        <div class="group-label">Session</div>
        <div class="group">
          ${toggleRow('Singing bowl guidance', PREF.sound, p.sound)}
          ${toggleRow('Keep screen awake', PREF.awake, p.awake)}
        </div>
        <p class="footnote">A Tibetan singing bowl marks each phase — a high bowl to breathe in, a middle bowl to hold, a low bowl to breathe out — so you can follow with your eyes closed.${noWakeLock ? ' <b>This browser can’t keep the screen on</b> — set Auto-Lock to Never while you practise.' : ''}</p>
      </div>

      <div>
        <div class="group-label">Recordings</div>
        <div class="group">
          ${GUIDES.map(recordingRow).join('')}
          <div class="row">
            <div class="row-text">Add several at once<div class="row-sub">Recognised by file name</div></div>
            <button class="small-btn" data-action="add-many">Choose…</button>
          </div>
        </div>
        <p class="footnote">${Recordings.available
          ? 'Recordings stay on this device and are never uploaded. Pick each one once from your files and it’s kept for next time — no internet needed to play it.'
          : '<b>This browser can’t store recordings</b> — private browsing blocks it. Open the site in a normal window.'}</p>
      </div>

      <div>
        <div class="group-label">About this web version</div>
        <div class="group">
          <div class="row"><div class="row-text">Version</div><span class="row-sub">Web 1.0</span></div>
        </div>
        <p class="footnote">For use away from your Mac. It doesn’t log to Apple Health, show heart rate, or run on Apple Watch — those need the installed app.${isIOS() && !isStandalone() ? ' To install it, tap <b>Share</b>, then <b>Add to Home Screen</b>.' : ''}</p>
      </div>
    </section>`);
  ui.onKey = e => { if (e.key === 'Escape') goHome(); };
}

// ----------------------------------------------------------- Adding recordings

function rerender() {
  if (ui.view === 'settings') showSettings();
  else if (ui.view === 'home') showHome();
}

function askForRecording(id) {
  if (!Recordings.available) {
    toast('This browser can’t store recordings — private browsing blocks it.');
    return;
  }
  ui.pendingGuide = id;
  pickOne.click();
}

pickOne.addEventListener('change', async () => {
  const file = pickOne.files && pickOne.files[0];
  const id = ui.pendingGuide;
  pickOne.value = '';
  ui.pendingGuide = null;
  if (!file || !id) return;
  try {
    await Recordings.add(id, file);
    toast(`Added ${guideById(id).title}`);
  } catch {
    toast('Couldn’t save that recording — the device may be short of space.');
  }
  rerender();
});

pickMany.addEventListener('change', async () => {
  const files = Array.from(pickMany.files || []);
  pickMany.value = '';
  let added = 0;
  const unknown = [];
  for (const file of files) {
    const id = matchGuide(file.name);
    if (!id) { unknown.push(file.name); continue; }
    try { await Recordings.add(id, file); added++; } catch { unknown.push(file.name); }
  }
  toast(unknown.length
    ? `Added ${added} · didn’t recognise ${unknown.length} — add ${unknown.length === 1 ? 'it' : 'those'} one by one`
    : `Added ${added} recording${added === 1 ? '' : 's'}`);
  rerender();
});

// ---------------------------------------------------------------- Actions

app.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;

  switch (action) {
    case 'settings':
      leaveHome();
      showSettings();
      break;
    case 'home':
      goHome();
      break;
    case 'open-technique':
      leaveHome();
      showSetup(id);
      break;
    case 'choose':
      store.set(target.dataset.key, Number(target.dataset.value));
      target.parentElement.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b === target)));
      break;
    case 'start':
      Sound.unlock();  // inside the tap, so the bowls are allowed to play
      startSession(makeSessionConfig(id, prefs()));
      break;
    case 'open-guide':
      if (Recordings.has(id)) {
        leaveHome();
        startGuide(id);
      } else {
        askForRecording(id);
      }
      break;
    case 'toggle-pause':
      if (ui.session) ui.session.togglePause();
      else if (ui.audio) ui.audio.toggle();
      break;
    case 'stop':
      if (ui.session) ui.session.stop();
      else if (ui.audio) ui.audio.stop();
      break;
    case 'add-guide':
      askForRecording(id);
      break;
    case 'add-many':
      if (Recordings.available) pickMany.click();
      else toast('This browser can’t store recordings — private browsing blocks it.');
      break;
    case 'remove-guide':
      Recordings.remove(id).then(() => {
        toast(`Removed ${guideById(id).title}`);
        rerender();
      }).catch(() => toast('Couldn’t remove that recording.'));
      break;
    case 'dismiss-hint':
      store.set('hint.install', true);
      target.closest('.hint').remove();
      break;
    default:
      break;
  }
});

app.addEventListener('click', event => {
  if (event.target.closest('[data-el="tap"]') && ui.audio) ui.audio.tap();
});

app.addEventListener('change', event => {
  const input = event.target.closest('input[data-pref]');
  if (input) store.set(input.dataset.pref, input.checked);
});

// --------------------------------------------------------------------- Start

(function boot() {
  history.replaceState(null, '');
  showHome();
  // Draw Home straight away, then fill in which recordings this device has.
  Recordings.init().then(() => { if (ui.view === 'home') showHome(); });

  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || (local && location.search.includes('sw')))) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
