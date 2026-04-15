/**
 * customizer-preload.js
 * Injected into the BHB Customizer webview.
 * Polls trait state from localStorage + DOM and relays it to the renderer
 * via ipcRenderer.sendToHost().
 *
 * The Customizer stores state in localStorage under several possible keys
 * (the exact key depends on the Customizer version). We try all known
 * patterns and also read directly from the DOM as a fallback.
 */

const { ipcRenderer } = require('electron');

// ── Known localStorage keys used by BHB Customizer ────────────────────────
const LS_KEYS = [
  'bhb-customizer-state',
  'bhb-traits',
  'bhbCustomizerState',
  'bhb_customizer',
  'characterState',
  'bhb-character',
];

// ── Trait slot labels as rendered in the Customizer DOM ───────────────────
const SLOT_LABELS = ['BODY','HEAD','EYES','MOUTH','OUTFIT','TEXTURE','BACKGROUND'];

let lastSnapshot = null;

// ── Read trait state ────────────────────────────────────────────────────────

function readFromLocalStorage() {
  for (const key of LS_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      // Expect an object with at least one SLOT_LABELS key
      if (data && typeof data === 'object') {
        const hasSlot = SLOT_LABELS.some(s => s in data || s.toLowerCase() in data);
        if (hasSlot) return normalizeKeys(data);
        // Nested under .traits?
        if (data.traits && typeof data.traits === 'object') return normalizeKeys(data.traits);
        // Nested under .animator?.traits?
        if (data.animator?.traits) return normalizeKeys(data.animator.traits);
      }
    } catch { /* ignore parse errors */ }
  }
  return null;
}

function normalizeKeys(obj) {
  // Ensure all keys are uppercase
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k.toUpperCase()] = v;
  }
  return out;
}

/**
 * DOM fallback: the Customizer displays the current trait name in a label
 * above the arrow controls for each slot. We walk the DOM to find them.
 *
 * Typical DOM pattern (may vary):
 *   <div class="trait-label">Dark Tone</div>   (or data-slot="BODY")
 *   <div class="slot-name">BODY</div>
 */
function readFromDOM() {
  const traits = {};

  // Strategy 1: elements with data-slot attribute
  document.querySelectorAll('[data-slot]').forEach(el => {
    const slot = el.dataset.slot?.toUpperCase();
    const name = el.dataset.traitName || el.dataset.value || el.textContent?.trim();
    if (slot && name && SLOT_LABELS.includes(slot)) traits[slot] = name;
  });

  if (Object.keys(traits).length >= 3) return traits;

  // Strategy 2: look for trait-display or current-trait class patterns
  const candidates = document.querySelectorAll(
    '.trait-name, .trait-label, .current-trait, [class*="traitName"], [class*="trait-display"], [class*="traitValue"]'
  );
  if (candidates.length > 0) {
    // Try to match by proximity to a slot label
    candidates.forEach(el => {
      const text = el.textContent?.trim();
      if (!text) return;
      // Walk up to find a parent with a slot indicator
      let node = el.parentElement;
      for (let i = 0; i < 6; i++) {
        if (!node) break;
        const slotAttr = node.dataset?.slot?.toUpperCase() ||
          node.querySelector('[class*="slot"]')?.textContent?.trim().toUpperCase();
        if (slotAttr && SLOT_LABELS.includes(slotAttr)) {
          traits[slotAttr] = text;
          break;
        }
        node = node.parentElement;
      }
    });
  }

  return Object.keys(traits).length >= 2 ? traits : null;
}

/**
 * Try to read the female toggle state.
 */
function readFemale() {
  // Common patterns for a female toggle in the Customizer
  const toggle = document.querySelector(
    'input[data-female], #female-toggle, .female-toggle input, [data-gender]'
  );
  if (toggle) return toggle.checked || toggle.dataset.gender === 'female';
  // Check localStorage
  for (const key of LS_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (typeof data?.female === 'boolean') return data.female;
      if (typeof data?.isFemale === 'boolean') return data.isFemale;
    } catch {}
  }
  return false;
}

/**
 * Read the current background/scene from localStorage or DOM.
 */
function readBackground() {
  for (const key of [...LS_KEYS, 'bhb-animator-state']) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (data?.BACKGROUND) return data.BACKGROUND;
      if (data?.background) return data.background;
      if (data?.traits?.BACKGROUND) return data.traits.BACKGROUND;
    } catch {}
  }
  return null;
}

// ── Snapshot + diff ────────────────────────────────────────────────────────

function snapshot() {
  const traits = readFromLocalStorage() || readFromDOM();
  if (!traits || Object.keys(traits).length < 2) return null;

  const bg = readBackground();
  if (bg && !traits.BACKGROUND) traits.BACKGROUND = bg;

  return {
    traits,
    female: readFemale(),
    timestamp: Date.now(),
  };
}

function hasChanged(a, b) {
  if (!a || !b) return a !== b;
  return JSON.stringify(a.traits) !== JSON.stringify(b.traits) || a.female !== b.female;
}

// ── Push to renderer ───────────────────────────────────────────────────────

function pushSnapshot(data) {
  ipcRenderer.sendToHost('customizer:traits', data);
}

// ── Listen for pull requests from renderer ────────────────────────────────

ipcRenderer.on('customizer:get-traits', () => {
  const data = snapshot();
  if (data) pushSnapshot(data);
  else ipcRenderer.sendToHost('customizer:traits', { traits: {}, female: false, error: 'No trait data found' });
});

// ── Continuous polling (500ms) ─────────────────────────────────────────────

setInterval(() => {
  const current = snapshot();
  if (current && hasChanged(current, lastSnapshot)) {
    lastSnapshot = current;
    pushSnapshot(current);
  }
}, 500);

// ── Also fire on localStorage changes (catches saves from other tabs/frames)

window.addEventListener('storage', () => {
  const current = snapshot();
  if (current && hasChanged(current, lastSnapshot)) {
    lastSnapshot = current;
    pushSnapshot(current);
  }
});

// ── Ready ping ────────────────────────────────────────────────────────────

window.addEventListener('load', () => {
  setTimeout(() => {
    ipcRenderer.sendToHost('customizer:ready', {});
    // Attempt initial read
    const initial = snapshot();
    if (initial) {
      lastSnapshot = initial;
      pushSnapshot(initial);
    }
  }, 800); // give the Customizer JS time to hydrate from localStorage
});

console.log('[BHB Agent Studio] Customizer preload active');
