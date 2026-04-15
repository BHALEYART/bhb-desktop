'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  BHB DESKTOP — Unified Preload
//
//  Exposes window.electronAPI with every channel used across all three apps.
//  Also injects a floating back-button into any non-launcher page so users
//  can return to the home menu without touching the original renderer code.
// ═══════════════════════════════════════════════════════════════════════════

const { contextBridge, ipcRenderer } = require('electron');

// ── Helper: one-shot listener cleanup ─────────────────────────────────────
function on(channel, callback) {
  const handler = (_, ...args) => callback(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

// ── Expose API ─────────────────────────────────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {

  // ── Navigation (BHB Desktop) ───────────────────────────────────────────
  navigate:       (section) => ipcRenderer.invoke('app:navigate', section),
  goHome:         ()        => ipcRenderer.invoke('app:go-home'),
  getSection:     ()        => ipcRenderer.invoke('app:section'),
  getAppVersion:  ()        => ipcRenderer.invoke('app:version'),

  // ── BHB Studio: internal page navigation ──────────────────────────────
  // Renderer fires ipcRenderer.send('navigate', 'customizer'|'animator')
  navigatePage:   (page)    => ipcRenderer.send('navigate', page),
  getCurrentPage: ()        => ipcRenderer.invoke('get-current-page'),

  // ── File & shell ───────────────────────────────────────────────────────
  saveFile:       (data)    => ipcRenderer.invoke('save-file', data),
  openExternal:   (url)     => ipcRenderer.send('open-external', url),
  shellOpen:      (url)     => ipcRenderer.invoke('shell:open', url),
  openFileDialog: (opts)    => ipcRenderer.invoke('dialog:open-file', opts),
  readFileBase64: (p)       => ipcRenderer.invoke('file:read-base64', p),

  // ── API Keys (safeStorage — Agent Studio) ─────────────────────────────
  saveKeys: (keys) => ipcRenderer.invoke('keys:save', keys),
  loadKeys: ()     => ipcRenderer.invoke('keys:load'),

  // ── Settings ───────────────────────────────────────────────────────────
  saveSettings: (data) => ipcRenderer.invoke('settings:save', data),
  loadSettings: ()     => ipcRenderer.invoke('settings:load'),

  // ── Save Slots (Agent Studio soul files) ──────────────────────────────
  listSlots:  ()             => ipcRenderer.invoke('slots:list'),
  saveSlot:   (id, soul)     => ipcRenderer.invoke('slots:save',   { id, soul }),
  loadSlot:   (id)           => ipcRenderer.invoke('slots:load',   id),
  deleteSlot: (id)           => ipcRenderer.invoke('slots:delete', id),
  newSlotId:  ()             => ipcRenderer.invoke('slots:new-id'),

  // ── Agent Studio assets ────────────────────────────────────────────────
  getAssetsStatus:   ()   => ipcRenderer.invoke('assets:status'),
  downloadAssets:    ()   => ipcRenderer.invoke('assets:download'),
  getAssetsDir:      ()   => ipcRenderer.invoke('assets:dir'),
  onAssetsProgress:  (cb) => on('assets:progress', cb),

  // ── BHB Live assets ───────────────────────────────────────────────────
  checkAssetsReady:    ()   => ipcRenderer.invoke('check-assets-ready'),
  getAssetCount:       ()   => ipcRenderer.invoke('get-asset-count'),
  downloadAllAssets:   ()   => ipcRenderer.invoke('download-all-assets'),
  resetAssetCache:     ()   => ipcRenderer.invoke('reset-asset-cache'),
  onAssetProgress:     (cb) => on('asset-progress', cb),

  // ── ElevenLabs TTS (Agent Studio) ─────────────────────────────────────
  getVoices: (apiKey)               => ipcRenderer.invoke('elevenlabs:voices', apiKey),
  tts:       (apiKey, voiceId, text, settings) =>
                                       ipcRenderer.invoke('elevenlabs:tts', { apiKey, voiceId, text, settings }),

  // ── AI chat (Agent Studio) ────────────────────────────────────────────
  aiChat: (opts) => ipcRenderer.invoke('ai:chat', opts),

  // ── Webview bridge (Agent Studio) ─────────────────────────────────────
  webviewSend:  (webContentsId, channel, data) =>
                  ipcRenderer.invoke('webview:send', { webContentsId, channel, data }),
  onWebviewIpc: (cb) => on('webview:ipc', cb),

  // ── BHB Live: OBS window ──────────────────────────────────────────────
  openLiveWindow:    (opts) => ipcRenderer.invoke('open-live-window',       opts),
  closeLiveWindow:   ()     => ipcRenderer.invoke('close-live-window'),
  isLiveOpen:        ()     => ipcRenderer.invoke('is-live-open'),
  setLiveAlwaysOnTop:(f)    => ipcRenderer.invoke('set-live-always-on-top', f),
  setLiveSize:       (w, h) => ipcRenderer.invoke('set-live-size',          { w, h }),
  updateLiveState:   (s)    => ipcRenderer.invoke('update-live-state',      s),
  onLiveWindowOpened:(cb)   => on('live-window-opened', cb),
  onLiveWindowClosed:(cb)   => on('live-window-closed', cb),
  onStateUpdate:     (cb)   => on('state-update', cb),

  // ── BHB Live: expression hotkeys ──────────────────────────────────────
  registerShortcut:      (accelerator, expression) =>
                           ipcRenderer.invoke('register-shortcut', { accelerator, expression }),
  unregisterShortcut:    (accelerator) => ipcRenderer.invoke('unregister-shortcut',      accelerator),
  unregisterAllShortcuts:()            => ipcRenderer.invoke('unregister-all-shortcuts'),
  getShortcuts:          ()            => ipcRenderer.invoke('get-shortcuts'),
  onExpressionActivate:  (cb)          => on('expression-activate', cb),

  // ── Auto-updater ──────────────────────────────────────────────────────
  installUpdate:     ()  => ipcRenderer.invoke('install-update'),
  checkForUpdates:   ()  => ipcRenderer.invoke('check-for-updates'),
  onUpdateAvailable: (cb) => on('update-available',  cb),
  onUpdateDownloaded:(cb) => on('update-downloaded', cb),
  onUpdateReady:     (cb) => on('update-ready',      cb),

  // ── Generic event listener (for renderers that wire events directly) ──
  on:  (channel, cb) => on(channel, cb),
  off: (channel, cb) => ipcRenderer.removeListener(channel, cb),
});

// ── Back button injection ─────────────────────────────────────────────────
// Injects a floating "← Home" button into every section page.
// The launcher itself is excluded. This way none of the three original
// renderer HTML files need to be modified at all.
window.addEventListener('DOMContentLoaded', () => {
  // Don't inject on the launcher
  if (location.pathname.includes('/launcher/')) return;

  const btn = document.createElement('button');
  btn.id = 'bhb-back-btn';
  btn.textContent = '← Home';
  btn.title = 'Return to BHB Desktop home menu';

  Object.assign(btn.style, {
    position:        'fixed',
    top:             '12px',
    left:            '12px',
    zIndex:          '999999',
    padding:         '6px 14px',
    fontSize:        '12px',
    fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight:      '500',
    color:           'rgba(255,255,255,0.7)',
    background:      'rgba(0,0,0,0.45)',
    border:          '1px solid rgba(255,255,255,0.15)',
    borderRadius:    '6px',
    cursor:          'pointer',
    backdropFilter:  'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition:      'color 0.15s, background 0.15s, border-color 0.15s',
    lineHeight:      '1.4',
    letterSpacing:   '0.01em',
    userSelect:      'none',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.color = '#fff';
    btn.style.background = 'rgba(0,0,0,0.7)';
    btn.style.borderColor = 'rgba(255,255,255,0.35)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.color = 'rgba(255,255,255,0.7)';
    btn.style.background = 'rgba(0,0,0,0.45)';
    btn.style.borderColor = 'rgba(255,255,255,0.15)';
  });

  btn.addEventListener('click', () => {
    ipcRenderer.invoke('app:go-home');
  });

  // On light-themed pages (Studio) darken the button text/bg
  if (document.documentElement.classList.contains('light') ||
      document.body.style.background?.includes('faf') ||
      document.body.style.backgroundColor?.includes('faf')) {
    btn.style.color = 'rgba(0,0,0,0.55)';
    btn.style.background = 'rgba(255,255,255,0.6)';
    btn.style.borderColor = 'rgba(0,0,0,0.12)';
  }

  document.body.appendChild(btn);
});
