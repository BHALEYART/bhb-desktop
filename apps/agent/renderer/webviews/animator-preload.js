/**
 * animator-preload.js
 * Injected into the BHB Animator webview.
 *
 * Responsibilities:
 *  1. Receive a base64-encoded mp3 from the renderer
 *  2. Convert it to a Blob URL
 *  3. Inject it into the Animator as if the user had uploaded it
 *  4. Trigger lip sync (the Animator starts animating automatically on audio load)
 *  5. Report playback state back to the renderer
 *  6. Receive trait config and apply it (so the character matches the soul file)
 *  7. Receive mood preset and apply Auto Expressions
 */

const { ipcRenderer } = require('electron');

// ── Wait for Animator to be fully ready ──────────────────────────────────

let animatorReady = false;

window.addEventListener('load', () => {
  setTimeout(() => {
    animatorReady = true;
    ipcRenderer.sendToHost('animator:ready', {});
    console.log('[BHB Agent Studio] Animator preload active, page ready');
  }, 1200);
});

// ── Load Audio (main flow for TTS lip sync) ────────────────────────────────

ipcRenderer.on('animator:load-audio', async (_, { base64, mimeType = 'audio/mpeg' }) => {
  try {
    // Convert base64 → Uint8Array → Blob → Object URL
    const binary    = atob(base64);
    const bytes     = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob      = new Blob([bytes], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);

    const success = await injectAudio(objectUrl);
    ipcRenderer.sendToHost('animator:audio-loaded', { success, url: objectUrl });
  } catch (e) {
    ipcRenderer.sendToHost('animator:error', { message: e.message });
    console.error('[BHB Animator Preload] load-audio error:', e);
  }
});

/**
 * Inject audio into the Animator through multiple strategies,
 * falling back gracefully if one doesn't work.
 */
async function injectAudio(objectUrl) {

  // ── Strategy 1: Programmatic file input dispatch ──────────────────────
  // The Animator likely has a <input type="file"> for audio upload.
  const fileInput = findAudioInput();
  if (fileInput) {
    try {
      const file = await urlToFile(objectUrl, 'bhb-tts.mp3', 'audio/mpeg');
      const dt   = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input',  { bubbles: true }));
      console.log('[BHB Animator Preload] Audio injected via file input');
      watchPlayback();
      return true;
    } catch (e) {
      console.warn('[BHB Animator Preload] File input strategy failed:', e.message);
    }
  }

  // ── Strategy 2: Drop event on the audio zone ──────────────────────────
  const dropZone = findAudioDropZone();
  if (dropZone) {
    try {
      const file = await urlToFile(objectUrl, 'bhb-tts.mp3', 'audio/mpeg');
      const dt   = new DataTransfer();
      dt.items.add(file);

      ['dragenter','dragover','drop'].forEach(evtName => {
        const evt = new DragEvent(evtName, { bubbles: true, cancelable: true, dataTransfer: dt });
        dropZone.dispatchEvent(evt);
      });
      console.log('[BHB Animator Preload] Audio injected via drag/drop');
      watchPlayback();
      return true;
    } catch (e) {
      console.warn('[BHB Animator Preload] Drop strategy failed:', e.message);
    }
  }

  // ── Strategy 3: Intercept Animator's internal audio player directly ───
  // Some versions of the Animator expose a global loadAudio() or similar
  const globalFns = ['loadAudio', 'setAudio', 'uploadAudio', 'loadTrack', 'bhbLoadAudio'];
  for (const fn of globalFns) {
    if (typeof window[fn] === 'function') {
      try {
        window[fn](objectUrl);
        console.log(`[BHB Animator Preload] Audio injected via window.${fn}()`);
        watchPlayback();
        return true;
      } catch (e) {
        console.warn(`[BHB Animator Preload] window.${fn}() failed:`, e.message);
      }
    }
  }

  // ── Strategy 4: Find the Animator's <audio> element and set src ───────
  const audioEl = document.querySelector('audio#animator-audio, audio.lip-sync-audio, audio[data-animator]');
  if (audioEl) {
    audioEl.src = objectUrl;
    audioEl.load();
    audioEl.dispatchEvent(new Event('loadeddata', { bubbles: true }));
    console.log('[BHB Animator Preload] Audio injected via direct <audio> src');
    watchPlayback(audioEl);
    return true;
  }

  console.warn('[BHB Animator Preload] No audio injection strategy succeeded');
  return false;
}

// ── Apply Traits ──────────────────────────────────────────────────────────

ipcRenderer.on('animator:set-traits', (_, { traits, moodPreset, female = false }) => {
  applyTraits(traits, moodPreset, female);
});

function applyTraits(traits, moodPreset, female) {
  // Store in localStorage so the Animator reads it on init
  const stateKeys = ['bhb-customizer-state', 'bhbCustomizerState', 'bhb-traits'];
  for (const key of stateKeys) {
    try { localStorage.setItem(key, JSON.stringify({ ...traits, female })); } catch {}
  }

  // Also try calling any global trait-setter the Animator exposes
  const setterFns = ['setTraits', 'loadTraits', 'applyTraits', 'bhbSetTraits'];
  for (const fn of setterFns) {
    if (typeof window[fn] === 'function') {
      try { window[fn](traits, female); break; } catch {}
    }
  }

  // Mood preset / Auto Expressions
  if (moodPreset) {
    setTimeout(() => applyMoodPreset(moodPreset), 800);
  }

  ipcRenderer.sendToHost('animator:traits-applied', { traits, female });
}

function applyMoodPreset(preset) {
  // Try global setters first
  const presetFns = ['setMoodPreset', 'setAutoExpressionPreset', 'bhbSetMood'];
  for (const fn of presetFns) {
    if (typeof window[fn] === 'function') {
      try { window[fn](preset); return; } catch {}
    }
  }

  // Fallback: find and click the mood preset button in the DOM
  const buttons = document.querySelectorAll(
    `[data-mood="${preset}"], [data-preset="${preset}"], .mood-btn, .preset-btn`
  );
  for (const btn of buttons) {
    const txt = btn.textContent?.toLowerCase() || btn.dataset.mood || btn.dataset.preset || '';
    if (txt.includes(preset)) { btn.click(); return; }
  }

  // Auto Expressions toggle
  const autoToggle = document.querySelector(
    '#auto-expressions, .auto-expr-toggle, input[data-auto-expressions]'
  );
  if (autoToggle && !autoToggle.checked) autoToggle.click();
}

// ── Playback Monitoring ────────────────────────────────────────────────────

function watchPlayback(audioEl) {
  const el = audioEl || document.querySelector('audio');
  if (!el) return;

  el.addEventListener('play',  () => ipcRenderer.sendToHost('animator:playing',  {}));
  el.addEventListener('pause', () => ipcRenderer.sendToHost('animator:paused',   {}));
  el.addEventListener('ended', () => ipcRenderer.sendToHost('animator:ended',    {}));
  el.addEventListener('timeupdate', () => {
    ipcRenderer.sendToHost('animator:progress', {
      current: el.currentTime,
      duration: el.duration || 0,
    });
  });
}

// ── Playback control from renderer ────────────────────────────────────────

ipcRenderer.on('animator:play',  () => { document.querySelector('audio')?.play(); });
ipcRenderer.on('animator:pause', () => { document.querySelector('audio')?.pause(); });

// ── Export trigger ────────────────────────────────────────────────────────

ipcRenderer.on('animator:export', () => {
  const exportFns  = ['exportVideo', 'renderVideo', 'bhbExport', 'startExport'];
  const exportBtns = document.querySelectorAll(
    '.export-btn, #export-btn, [data-action="export"], button[class*="export"], button[class*="render"]'
  );

  for (const fn of exportFns) {
    if (typeof window[fn] === 'function') { try { window[fn](); return; } catch {} }
  }
  for (const btn of exportBtns) {
    const txt = btn.textContent?.toLowerCase() || '';
    if (txt.includes('export') || txt.includes('render')) { btn.click(); return; }
  }

  ipcRenderer.sendToHost('animator:error', { message: 'Export button not found' });
});

// ── Helpers ────────────────────────────────────────────────────────────────

function findAudioInput() {
  // Ordered by specificity
  return (
    document.querySelector('input[type="file"][accept*="audio"]') ||
    document.querySelector('input[type="file"][accept*="mp3"]')   ||
    document.querySelector('input[type="file"][accept*=".mp3"]')  ||
    document.querySelector('#audio-upload, .audio-upload input, [data-audio-upload]') ||
    document.querySelector('input[type="file"]') // last resort
  );
}

function findAudioDropZone() {
  return (
    document.querySelector('[data-drop-zone="audio"], .audio-drop, #audio-drop, .waveform-zone') ||
    document.querySelector('[class*="audioZone"], [class*="audio-zone"], [class*="waveform"]')
  );
}

async function urlToFile(url, filename, mimeType) {
  const res  = await fetch(url);
  const buf  = await res.arrayBuffer();
  return new File([buf], filename, { type: mimeType });
}
