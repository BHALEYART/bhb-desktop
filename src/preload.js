'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  BHB DESKTOP — Unified Preload
//
//  Exposes TWO globals to match each app's original preload exactly:
//    window.electronAPI  — BHB Studio + BHB Live (original shape preserved)
//    window.bhb          — BHB Agent Studio (original nested shape preserved)
//
//  Also injects a floating ← Home button into every non-launcher page.
// ═══════════════════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

// ══════════════════════════════════════════════════════════════════════════
//  window.electronAPI
//  Used by: BHB Studio + BHB Live (and the launcher)
//  Shape matches each app's original preload exactly.
// ══════════════════════════════════════════════════════════════════════════
contextBridge.exposeInMainWorld('electronAPI', {

  // ── BHB Desktop navigation (launcher) ────────────────────────────────
  goHome:        () => ipcRenderer.invoke('app:go-home'),
  getSection:    () => ipcRenderer.invoke('app:section'),
  getAppVersion: () => ipcRenderer.invoke('app:version'),

  // ── BHB Studio ───────────────────────────────────────────────────────
  // isElectron lets the renderer detect it's running in Electron
  isElectron: true,

  // navigate uses .send (not .invoke) — must match original exactly
  navigate(page) { ipcRenderer.send('navigate', page); },

  async getCurrentPage() {
    return ipcRenderer.invoke('get-current-page');
  },

  // saveFile: original takes (buffer, filename, mimeType) as 3 separate args
  async saveFile(buffer, filename, mimeType) {
    const arr = buffer instanceof Uint8Array
      ? Array.from(buffer)
      : Array.from(new Uint8Array(buffer));
    return ipcRenderer.invoke('save-file', { buffer: arr, filename, mimeType });
  },

  // openExternal uses .send — must match original
  openExternal(url) { ipcRenderer.send('open-external', url); },

  // ── BHB Live: asset cache ─────────────────────────────────────────────
  checkAssetsReady:  ()   => ipcRenderer.invoke('check-assets-ready'),
  getAssetCount:     ()   => ipcRenderer.invoke('get-asset-count'),
  downloadAllAssets: ()   => ipcRenderer.invoke('download-all-assets'),
  resetAssetCache:   ()   => ipcRenderer.invoke('reset-asset-cache'),
  onAssetProgress:   (cb) => ipcRenderer.on('asset-progress', (_, d) => cb(d)),

  // ── BHB Live: OBS window ──────────────────────────────────────────────
  openLiveWindow:     (opts)  => ipcRenderer.invoke('open-live-window',       opts),
  closeLiveWindow:    ()      => ipcRenderer.invoke('close-live-window'),
  isLiveOpen:         ()      => ipcRenderer.invoke('is-live-open'),
  setLiveAlwaysOnTop: (flag)  => ipcRenderer.invoke('set-live-always-on-top', flag),
  setLiveSize:        (w, h)  => ipcRenderer.invoke('set-live-size',          { w, h }),
  updateLiveState:    (state) => ipcRenderer.invoke('update-live-state',      state),

  // ── BHB Live: expression shortcuts ────────────────────────────────────
  registerShortcut:       (accel, expr) => ipcRenderer.invoke('register-shortcut',       { accelerator: accel, expression: expr }),
  unregisterShortcut:     (accel)       => ipcRenderer.invoke('unregister-shortcut',      accel),
  unregisterAllShortcuts: ()            => ipcRenderer.invoke('unregister-all-shortcuts'),
  getShortcuts:           ()            => ipcRenderer.invoke('get-shortcuts'),

  // ── BHB Live: event listeners ─────────────────────────────────────────
  onStateUpdate:        (cb) => ipcRenderer.on('state-update',        (_, d) => cb(d)),
  onExpressionActivate: (cb) => ipcRenderer.on('expression-activate', (_, d) => cb(d)),
  onLiveWindowOpened:   (cb) => ipcRenderer.on('live-window-opened',  ()     => cb()),
  onLiveWindowClosed:   (cb) => ipcRenderer.on('live-window-closed',  ()     => cb()),
  removeAllListeners:   (ch) => ipcRenderer.removeAllListeners(ch),

  // ── Auto-updater (shared) ─────────────────────────────────────────────
  installUpdate:      ()    => ipcRenderer.invoke('install-update'),
  checkForUpdates:    ()    => ipcRenderer.invoke('check-for-updates'),
  onUpdateAvailable:  (cb)  => ipcRenderer.on('update-available',  (_, d) => cb(d)),
  onUpdateDownloaded: (cb)  => ipcRenderer.on('update-downloaded', (_, d) => cb(d)),
  onUpdateReady:      (cb)  => ipcRenderer.on('update-ready',      (_, d) => cb(d)),
});

// ══════════════════════════════════════════════════════════════════════════
//  window.bhb
//  Used by: BHB Agent Studio exclusively
//  Shape matches bhb-agent-studio/src/preload.js exactly.
// ══════════════════════════════════════════════════════════════════════════
contextBridge.exposeInMainWorld('bhb', {

  keys: {
    save: (keys) => ipcRenderer.invoke('keys:save', keys),
    load: ()     => ipcRenderer.invoke('keys:load'),
  },

  settings: {
    save: (data) => ipcRenderer.invoke('settings:save', data),
    load: ()     => ipcRenderer.invoke('settings:load'),
  },

  slots: {
    list:   ()           => ipcRenderer.invoke('slots:list'),
    save:   (id, soul)   => ipcRenderer.invoke('slots:save',   { id, soul }),
    load:   (id)         => ipcRenderer.invoke('slots:load',   id),
    delete: (id)         => ipcRenderer.invoke('slots:delete', id),
    newId:  ()           => ipcRenderer.invoke('slots:new-id'),
  },

  assets: {
    status:     ()   => ipcRenderer.invoke('assets:status'),
    download:   ()   => ipcRenderer.invoke('assets:download'),
    dir:        ()   => ipcRenderer.invoke('assets:dir'),
    onProgress: (cb) => ipcRenderer.on('assets:progress', (_, data) => cb(data)),
  },

  elevenlabs: {
    voices: (key)  => ipcRenderer.invoke('elevenlabs:voices', key),
    tts:    (opts) => ipcRenderer.invoke('elevenlabs:tts',    opts),
  },

  ai: {
    chat: (opts) => ipcRenderer.invoke('ai:chat', opts),
  },

  file: {
    readBase64: (p) => ipcRenderer.invoke('file:read-base64', p),
  },

  webview: {
    send: (webContentsId, channel, data) =>
      ipcRenderer.invoke('webview:send', { webContentsId, channel, data }),
    onMessage: (cb) =>
      ipcRenderer.on('webview:ipc', (_, payload) => cb(payload)),
  },

  shell: {
    open: (url) => ipcRenderer.invoke('shell:open', url),
  },

  dialog: {
    openFile: (opts) => ipcRenderer.invoke('dialog:open-file', opts),
  },

  app: {
    version:       ()   => ipcRenderer.invoke('app:version'),
    onUpdateReady: (cb) => ipcRenderer.on('update-ready', (_, d) => cb(d)),
  },
});

// ══════════════════════════════════════════════════════════════════════════
//  Back button injection
//  Floating ← Home button injected into every non-launcher page.
//  No renderer HTML needs to be modified.
// ══════════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  if (location.pathname.includes('/launcher/')) return;

  const btn = document.createElement('button');
  btn.id          = 'bhb-back-btn';
  btn.textContent = '← Home';
  btn.title       = 'Return to BHB Desktop home menu';

  Object.assign(btn.style, {
    position:             'fixed',
    top:                  '12px',
    left:                 '12px',
    zIndex:               '999999',
    padding:              '6px 14px',
    fontSize:             '12px',
    fontFamily:           '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight:           '500',
    color:                'rgba(255,255,255,0.7)',
    background:           'rgba(0,0,0,0.45)',
    border:               '1px solid rgba(255,255,255,0.15)',
    borderRadius:         '6px',
    cursor:               'pointer',
    backdropFilter:       'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition:           'color 0.15s, background 0.15s, border-color 0.15s',
    lineHeight:           '1.4',
    letterSpacing:        '0.01em',
    userSelect:           'none',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.color       = '#fff';
    btn.style.background  = 'rgba(0,0,0,0.7)';
    btn.style.borderColor = 'rgba(255,255,255,0.35)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.color       = 'rgba(255,255,255,0.7)';
    btn.style.background  = 'rgba(0,0,0,0.45)';
    btn.style.borderColor = 'rgba(255,255,255,0.15)';
  });

  btn.addEventListener('click', () => ipcRenderer.invoke('app:go-home'));
  document.body.appendChild(btn);
});
