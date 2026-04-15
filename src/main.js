'use strict';
// ═══════════════════════════════════════════════════════════════════════════
//  BHB DESKTOP — Unified Main Process
//  Single BrowserWindow launcher that loads one section at a time:
//    launcher  →  home menu
//    studio    →  BHB Studio (Customizer)
//    animator  →  BHB Studio (Animator)
//    live      →  BHB Live (OBS Control)
//    agent     →  BHB Agent Studio
//
//  liveWin is a second BrowserWindow spawned only while BHB Live is active.
// ═══════════════════════════════════════════════════════════════════════════

const {
  app, BrowserWindow, ipcMain, globalShortcut,
  session, protocol, systemPreferences,
  safeStorage, dialog, shell, Menu, nativeTheme,
} = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const https = require('https');
const http  = require('http');

// ── Must be called before app.whenReady() ─────────────────────────────────
protocol.registerSchemesAsPrivileged([{
  scheme:     'bhb-asset',
  privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true },
}]);

// ── Paths ──────────────────────────────────────────────────────────────────
const USER_DATA     = app.getPath('userData');
const SLOTS_DIR     = path.join(USER_DATA, 'slots');
const AGENT_ASSETS  = path.join(USER_DATA, 'assets');      // BHB Agent Studio assets
const LIVE_ASSETS   = path.join(USER_DATA, 'bhb-assets');  // BHB Live assets
const LIVE_MANIFEST = path.join(LIVE_ASSETS, 'manifest.json');
const KEYS_FILE     = path.join(USER_DATA, 'keys.enc');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const AUDIO_TMP     = path.join(os.tmpdir(), 'bhb-agent-studio');

for (const d of [SLOTS_DIR, AGENT_ASSETS, LIVE_ASSETS, AUDIO_TMP]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// ── Window references ──────────────────────────────────────────────────────
let mainWin    = null;  // single main window (launcher + sections)
let liveWin    = null;  // BHB Live OBS capture window (spawned on demand)

// ── Section state ──────────────────────────────────────────────────────────
let currentSection = 'launcher';
let studioPage     = 'customizer'; // tracks sub-page within Studio
const shortcutMap  = new Map();    // accelerator → expression (BHB Live)

// Per-section window configuration
const SECTION_CONFIG = {
  launcher: { width: 880,  height: 640,  minW: 880,  minH: 640,  bg: '#0a0a0a', theme: 'dark',  resize: false },
  studio:   { width: 1280, height: 820,  minW: 900,  minH: 600,  bg: '#fafaf5', theme: 'light', resize: true  },
  animator: { width: 1280, height: 820,  minW: 900,  minH: 600,  bg: '#fafaf5', theme: 'light', resize: true  },
  live:     { width: 1220, height: 860,  minW: 980,  minH: 680,  bg: '#0d0d0d', theme: 'dark',  resize: true  },
  agent:    { width: 1200, height: 820,  minW: 900,  minH: 640,  bg: '#0a0a0a', theme: 'dark',  resize: true  },
};

// Absolute paths to each section's entry HTML
function getSectionHTML(section) {
  const base = path.join(__dirname, '..');
  const map = {
    launcher: path.join(base, 'launcher', 'index.html'),
    studio:   path.join(base, 'apps', 'studio', 'customizer', 'index.html'),
    animator: path.join(base, 'apps', 'studio', 'animator',   'index.html'),
    live:     path.join(base, 'apps', 'live',   'control.html'),
    agent:    path.join(base, 'apps', 'agent',  'renderer',   'index.html'),
  };
  return map[section] || null;
}

// ── Auto-updater ───────────────────────────────────────────────────────────
let autoUpdater = null;
if (app.isPackaged) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload         = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger               = null;
  } catch (_) { autoUpdater = null; }
}

function setupAutoUpdater() {
  if (!autoUpdater) return;
  autoUpdater.on('update-available',  (i) => mainWin?.webContents.send('update-available',  { version: i.version, releaseNotes: i.releaseNotes || '' }));
  autoUpdater.on('update-downloaded', (i) => {
    mainWin?.webContents.send('update-downloaded', { version: i.version });
    mainWin?.webContents.send('update-ready'); // compat alias used by Agent Studio
  });
  autoUpdater.on('error', () => {});
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
}

// ── bhb-asset:// protocol (BHB Live local asset serving) ─────────────────
function registerAssetProtocol() {
  protocol.registerFileProtocol('bhb-asset', (request, callback) => {
    const rel      = decodeURIComponent(request.url.replace(/^bhb-asset:\/\//, ''));
    const filePath = path.normalize(path.join(LIVE_ASSETS, rel));
    if (!filePath.startsWith(LIVE_ASSETS)) return callback({ error: -10 }); // deny path traversal
    callback({ path: filePath });
  });
}

// ── Permission handlers ───────────────────────────────────────────────────
function setupPermissions() {
  const ses = session.defaultSession;
  const allowed = ['media', 'microphone', 'audioCapture', 'mediaKeySystem', 'notifications', 'fullscreen'];
  ses.setPermissionCheckHandler((_, permission) => allowed.includes(permission));
  ses.setPermissionRequestHandler((_, permission, callback) => callback(allowed.includes(permission)));
}

async function ensureMicPermission() {
  if (process.platform !== 'darwin') return;
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone').catch(() => {});
  }
}

// ── Mic gate for Live section ──────────────────────────────────────────────
// BHB Live's renderer initialises multiple AudioContext nodes on load,
// each triggering its own getUserMedia call. On macOS, if TCC hasn't granted
// permission to this app yet, every call spawns a system dialog.
// Fix: block the page load until TCC has resolved (granted or denied) so
// all subsequent getUserMedia calls inside the renderer are already approved.
async function ensureMicBeforeLive() {
  if (process.platform !== 'darwin') return;
  const status = systemPreferences.getMediaAccessStatus('microphone');
  // Already granted — renderer calls will be silently approved by Chromium
  if (status === 'granted') return;
  // Show exactly one OS dialog, wait for the user to respond, then load
  await systemPreferences.askForMediaAccess('microphone').catch(() => {});
}

// ── loadSection ───────────────────────────────────────────────────────────
// Core navigation function — tears down previous section, resizes window,
// sets theme, and loads the new section's HTML.
function loadSection(section) {
  if (!mainWin || mainWin.isDestroyed()) return;

  // Teardown: unregister Live shortcuts and close OBS window when leaving Live
  if (currentSection === 'live' && section !== 'live') {
    globalShortcut.unregisterAll();
    shortcutMap.clear();
    if (liveWin && !liveWin.isDestroyed()) liveWin.close();
  }

  // For Live: ensure macOS TCC mic permission resolves BEFORE the renderer
  // loads. This prevents 12+ dialogs from multiple AudioContext init calls.
  if (section === 'live') await ensureMicBeforeLive();

  const html = getSectionHTML(section);
  if (!html) { console.error(`[loadSection] Unknown section: ${section}`); return; }

  currentSection = section;
  if (section === 'studio')   studioPage = 'customizer';
  if (section === 'animator') studioPage = 'animator';

  const cfg = SECTION_CONFIG[section] || SECTION_CONFIG.launcher;

  mainWin.setResizable(cfg.resize);
  mainWin.setMinimumSize(cfg.minW, cfg.minH);
  mainWin.setSize(cfg.width, cfg.height, true);
  mainWin.center();
  mainWin.setBackgroundColor(cfg.bg);
  nativeTheme.themeSource = cfg.theme;

  mainWin.loadFile(html);
  mainWin.webContents.once('did-finish-load', buildMenu);
}

// ── createMainWindow ──────────────────────────────────────────────────────
function createMainWindow() {
  const iconFile = process.platform === 'win32' ? 'icon.ico'
                 : process.platform === 'darwin' ? 'icon.icns' : 'icon.png';
  const iconPath = path.join(__dirname, '..', 'build', iconFile);

  const cfg = SECTION_CONFIG.launcher;

  mainWin = new BrowserWindow({
    width:    cfg.width,
    height:   cfg.height,
    minWidth:  cfg.minW,
    minHeight: cfg.minH,
    resizable: cfg.resize,
    backgroundColor: cfg.bg,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    title: 'BHB Desktop',
    show:  false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webSecurity:      true,
      webviewTag:       true, // required by Agent Studio's embedded webviews
    },
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
  });

  mainWin.loadFile(path.join(__dirname, '..', 'launcher', 'index.html'));
  mainWin.once('ready-to-show', () => mainWin.show());

  if (isDev) mainWin.webContents.openDevTools({ mode: 'detach' });

  mainWin.on('closed', () => {
    if (liveWin && !liveWin.isDestroyed()) liveWin.close();
    mainWin = null;
  });

  // Open external links in system browser, not in the app window
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith('file://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) { event.preventDefault(); shell.openExternal(url); }
  });

  // Log renderer errors in dev
  if (isDev) {
    mainWin.webContents.on('render-process-gone', (_, d) => console.error('[Renderer crashed]', d));
    mainWin.webContents.on('did-fail-load',       (_, c, d) => console.error('[Load failed]', c, d));
  }
}

// ── createLiveWindow ──────────────────────────────────────────────────────
// BHB Live's second window — frameless, optionally transparent, for OBS.
function createLiveWindow(opts = {}) {
  if (liveWin && !liveWin.isDestroyed()) { liveWin.focus(); return; }

  liveWin = new BrowserWindow({
    width:   opts.width  || 1000,
    height:  opts.height || 1000,
    minWidth: 320, minHeight: 320,
    title:    'BHB Live — OBS Capture',
    frame:       false,
    transparent: !!opts.transparent,
    alwaysOnTop: !!opts.alwaysOnTop,
    resizable:   true,
    hasShadow:   false,
    backgroundColor: opts.transparent ? '#00000000' : '#000000',
    show: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  liveWin.loadFile(path.join(__dirname, '..', 'apps', 'live', 'live.html'));
  liveWin.once('ready-to-show', () => {
    liveWin.show();
    mainWin?.webContents.send('live-window-opened');
  });
  liveWin.on('closed', () => {
    liveWin = null;
    mainWin?.webContents.send('live-window-closed');
  });
}

// ── buildMenu ─────────────────────────────────────────────────────────────
function buildMenu() {
  const isMac    = process.platform === 'darwin';
  const inStudio = currentSection === 'studio' || currentSection === 'animator';

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: '⌂  Home Menu',
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => { if (mainWin) loadSection('launcher'); },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...(inStudio ? [
          {
            label: '🎨  Customizer',
            type: 'radio', checked: studioPage === 'customizer',
            accelerator: 'CmdOrCtrl+1',
            click: () => { if (mainWin) loadSection('studio'); },
          },
          {
            label: '🎬  Animator',
            type: 'radio', checked: studioPage === 'animator',
            accelerator: 'CmdOrCtrl+2',
            click: () => { if (mainWin) loadSection('animator'); },
          },
          { type: 'separator' },
        ] : []),
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' }, { role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'BHB Website',       click: () => shell.openExternal('https://bigheadbillionaires.com') },
        { label: 'Discord Community', click: () => shell.openExternal('https://discord.gg/MHskPjHsf2') },
        { label: 'View on GitHub',    click: () => shell.openExternal('https://github.com/BHALEYART/bhb-desktop') },
        { type: 'separator' },
        ...(isMac ? [] : [{
          label: 'About BHB Desktop',
          click: () => dialog.showMessageBox(mainWin, {
            type: 'info', title: 'BHB Desktop', message: 'BHB Desktop',
            detail: `Version ${app.getVersion()}\n\nBig Head Billionaires — All-in-One Suite\nStudio · Live · Agent Studio\n\nBuilt on Solana · © 2025`,
          }),
        }]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Webview wiring (Agent Studio) ─────────────────────────────────────────
// Agent Studio uses <webview> tags that embed customizer/animator pages.
// We need to map relative preload attribute paths to absolute disk paths.
app.on('web-contents-created', (_, wc) => {
  wc.on('will-attach-webview', (event, webPreferences, params) => {
    const preloadMap = {
      'customizer-preload.js': path.join(__dirname, '..', 'apps', 'agent', 'renderer', 'webviews', 'customizer-preload.js'),
      'animator-preload.js':   path.join(__dirname, '..', 'apps', 'agent', 'renderer', 'webviews', 'animator-preload.js'),
    };
    if (params.preload) {
      const base = path.basename(params.preload);
      if (preloadMap[base]) webPreferences.preload = preloadMap[base];
    }
    delete webPreferences.nodeIntegration;
  });

  // Forward webview IPC messages to the main renderer
  if (wc.getType() === 'webview') {
    wc.on('ipc-message', (e, channel, ...args) => {
      mainWin?.webContents.send('webview:ipc', { webContentsId: wc.id, channel, args });
    });
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  setupPermissions();
  registerAssetProtocol();
  await ensureMicPermission();
  createMainWindow();
  buildMenu();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) { createMainWindow(); buildMenu(); }
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit',         () => globalShortcut.unregisterAll());


// ══════════════════════════════════════════════════════════════════════════
//  IPC — NAVIGATION
// ══════════════════════════════════════════════════════════════════════════

// Primary navigation (launcher cards + back button)
ipcMain.handle('app:navigate', (_, section) => { loadSection(section); return { ok: true }; });
ipcMain.handle('app:go-home',  ()            => { loadSection('launcher'); return { ok: true }; });
ipcMain.handle('app:section',  ()            => currentSection);
ipcMain.handle('app:version',  ()            => app.getVersion());

// BHB Studio legacy: renderer fires ipcMain.on('navigate', page)
// Maps 'customizer' / 'animator' to the unified section names
ipcMain.on('navigate', (_, page) => {
  if (['studio', 'animator', 'customizer'].includes(currentSection) ||
      currentSection === 'studio' || currentSection === 'animator') {
    loadSection(page === 'animator' ? 'animator' : 'studio');
  }
});

// BHB Studio renderer asks which page is currently active
ipcMain.handle('get-current-page', () => studioPage);


// ══════════════════════════════════════════════════════════════════════════
//  IPC — FILE & SHELL
// ══════════════════════════════════════════════════════════════════════════

// Save file with native dialog (BHB Studio: canvas export, MP4, etc.)
ipcMain.handle('save-file', async (_, { buffer, filename, mimeType }) => {
  const ext     = path.extname(filename).slice(1).toUpperCase() || 'FILE';
  const mimeMap = {
    'image/png':  [{ name: 'PNG Image',  extensions: ['png']  }],
    'video/mp4':  [{ name: 'MP4 Video',  extensions: ['mp4']  }],
    'video/webm': [{ name: 'WebM Video', extensions: ['webm'] }],
    'audio/wav':  [{ name: 'WAV Audio',  extensions: ['wav']  }],
    'audio/mpeg': [{ name: 'MP3 Audio',  extensions: ['mp3']  }],
  };
  const filters = mimeMap[mimeType] || [{ name: `${ext} File`, extensions: [ext.toLowerCase()] }];
  const { filePath, canceled } = await dialog.showSaveDialog(mainWin, {
    title:       `Save ${ext}`,
    defaultPath: path.join(app.getPath('downloads'), filename),
    filters,
    properties:  ['showOverwriteConfirmation'],
  });
  if (canceled || !filePath) return { saved: false };
  try {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return { saved: true, filePath };
  } catch (e) { return { saved: false, error: e.message }; }
});

// Open URL in system browser
ipcMain.on(    'open-external',    (_, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('shell:open',       (_, url) => shell.openExternal(url));

// Native open-file dialog
ipcMain.handle('dialog:open-file', async (_, opts) => {
  const r = await dialog.showOpenDialog(mainWin, opts);
  return r.canceled ? null : r.filePaths[0];
});

// Read a file as base64 (used by Agent Studio's webview audio bridge)
ipcMain.handle('file:read-base64', (_, filePath) => {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  return fs.readFileSync(filePath).toString('base64');
});


// ══════════════════════════════════════════════════════════════════════════
//  IPC — API KEYS  (encrypted — Agent Studio)
// ══════════════════════════════════════════════════════════════════════════

ipcMain.handle('keys:save', (_, keys) => {
  try {
    fs.writeFileSync(KEYS_FILE, safeStorage.encryptString(JSON.stringify(keys)));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('keys:load', () => {
  try {
    if (!fs.existsSync(KEYS_FILE)) return {};
    return JSON.parse(safeStorage.decryptString(fs.readFileSync(KEYS_FILE)));
  } catch { return {}; }
});


// ══════════════════════════════════════════════════════════════════════════
//  IPC — SETTINGS  (shared across sections)
// ══════════════════════════════════════════════════════════════════════════

ipcMain.handle('settings:save', (_, data) => {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  return { ok: true };
});

ipcMain.handle('settings:load', () => {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch { return {}; }
});


// ══════════════════════════════════════════════════════════════════════════
//  IPC — SAVE SLOTS  (Agent Studio soul files)
// ══════════════════════════════════════════════════════════════════════════

ipcMain.handle('slots:list', () =>
  fs.readdirSync(SLOTS_DIR).filter(f => f.endsWith('.json')).map(f => {
    const data = JSON.parse(fs.readFileSync(path.join(SLOTS_DIR, f), 'utf8'));
    return { id: f.replace('.json', ''), name: data.name || 'Unnamed', tagline: data.tagline || '', thumbnail: data._thumbnail || null };
  })
);
ipcMain.handle('slots:save', (_, { id, soul }) => {
  fs.writeFileSync(path.join(SLOTS_DIR, `${id}.json`), JSON.stringify(soul, null, 2));
  return { ok: true };
});
ipcMain.handle('slots:load', (_, id) => {
  const f = path.join(SLOTS_DIR, `${id}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
});
ipcMain.handle('slots:delete', (_, id) => {
  const f = path.join(SLOTS_DIR, `${id}.json`);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  return { ok: true };
});
ipcMain.handle('slots:new-id', () => `slot_${Date.now()}`);


// ══════════════════════════════════════════════════════════════════════════
//  IPC — AGENT STUDIO ASSETS  (CDN → userData/assets/)
// ══════════════════════════════════════════════════════════════════════════

const AGENT_MANIFEST_URL = 'https://raw.githubusercontent.com/BHALEYART/bhb-agent-docs/main/asset-manifest.json';
const AGENT_CDN_BASE     = 'https://bhaleyart.github.io/bhb-assets/';

ipcMain.handle('assets:status', () => {
  const manifest = path.join(AGENT_ASSETS, 'manifest.json');
  if (!fs.existsSync(manifest)) return { downloaded: false, count: 0 };
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  return { downloaded: true, count: m.files?.length || 0, version: m.version };
});

ipcMain.handle('assets:download', async () => {
  const fetch = (await import('node-fetch')).default;
  try {
    const manifest = await (await fetch(AGENT_MANIFEST_URL)).json();
    const files    = manifest.files || [];
    let   done     = 0;
    for (const file of files) {
      const dest = path.join(AGENT_ASSETS, file.path);
      if (!fs.existsSync(path.dirname(dest))) fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) {
        const buf = await (await fetch(AGENT_CDN_BASE + file.path)).buffer();
        fs.writeFileSync(dest, buf);
      }
      done++;
      mainWin?.webContents.send('assets:progress', { done, total: files.length });
    }
    fs.writeFileSync(path.join(AGENT_ASSETS, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { ok: true, count: files.length };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('assets:dir', () => AGENT_ASSETS);


// ══════════════════════════════════════════════════════════════════════════
//  IPC — BHB LIVE ASSETS  (CDN → userData/bhb-assets/)
//  Full manifest + concurrent downloader ported from bhb-obs-plugin/main.js
// ══════════════════════════════════════════════════════════════════════════

const LIVE_CDN_BASE = 'https://bhaleyart.github.io/BigHeadCharacterCooker';

function buildLiveAssetManifest() {
  const EYES    = ['Curious.png','Alien.png','Annoyed.png','Demonic.png','Diamond.png','Dots.png','Grumpy.png','Hypnotized.png','Infuriated.png','Insect.png','Joy.png','Light Bright.png','Monocle.png','Ouchy.png','Paranoid.png','Possessed.png','Ruby Stare.png','Spider.png','Stare.png','Stoney Eyes.png','Sunglasses.png','Surprised.png','Tears.png','Deceased.png','Too Chill.png','VR Headset.png','3D Glasses.png','Blink.png','Stern.png','Tears.gif'];
  const MOUTH   = ['Mmm.png','Simpleton.png','Stache.png','Creeper.png','Pierced.png','Fangs.png','Gold Teeth.png','Diamond Teeth.png','CandyGrill.png','Birdy.png','Panic.png','Sss.png','Ahh.png','Ehh.png','Uhh.png','LLL.png','Rrr.png','Fff.png','Ooo.png','Thh.png','Eee.png','Haha.png','Rofl.png','Bean Frown.png','Bean Smile.png','Smirk.png','Bored.png','Gas Mask.png','Scuba.png','Quacked.png'];
  const HEAD    = ['None.png','Antenna.png','Bandana Bro.png','Beanie.png','Blonde Beanie.png','Blonde Bun.png','Blue Bedhead.png','Brain Squid.png','Bravo.png','Brunette Beanie.png','Brunette Ponytail.png','Burger Crown.png','Captain Hat.png','Mullet.png','Cat Hat.png','Chad Bandana.png','Cherry Sundae.png','Clown Wig.png','Fancy Hat.png','Fireman.png','Flame Princess.png','Fossilized.png','Gamer Girl.png','Ginger Ponytail.png','Kpop.png','Yagami.png','Raven.png','Heated.png','Inferno.png','Horny Horns.png','Hunted.png','Jester.png','Kingly.png','Mad Hatter.png','Masked Up.png','Mohawk Blue.png','Mohawk Green.png','Mohawk Red.png','Mortricia.png','Outlaw.png','Overload.png','Patrol Cap.png','Pharaoh Hat.png','Pink Pigtails.png','Powdered Wig.png','Press Pass.png','Propeller.png','Rainbow Babe.png','Recon Helmet.png','Robin Hood.png','Santa Hat.png','Sewer Slime.png','Snapback Blue.png','Snapback Hippy.png','Snapback Red.png','Snapback Yellow.png','Sombrero.png','Spiritual.png','Surgeon.png','UwU Kitty.png','Valhalla Cap.png','Way Dizzy.png','FoxFamous.png','Unplugged.png'];
  const OUTFIT  = ['None.png','Blue Tee.png','Blueberry Dye.png','Degen Green.png','Degen Purple.png','Earthy Dye.png','Hodl Black.png','Hodl White.png','Locked Up.png','Moto-X.png','Orange Zip.png','Passion Dye.png','Pink Zip.png','Raider Ref.png','Red Tee.png','Smally Bigs.png','Yellow Tee.png','Blue Zip.png','Red Zip.png','White Zip.png','Hornet Zip.png','Ghostly Zip.png','Gold Jacket.png','Tuxedo.png','Thrashed.png','The Fuzz.png','Pin Striped.png','Designer Zip.png','Luxury Zip.png','Explorer.png','Power Armor.png','Shinobi.png','Thrilled.png','Trenches.png','Ski Jacket.png','Sled Jacket.png','Commando.png','Space Cadet.png','Burgler.png','Commandant.png','Golden Knight.png','Honey Bee.png','Necromancer.png','Paladin.png','Refined Suit.png','Sexy Jacket.png','Stoner Hoodie.png','The Duke.png','Rave Hoodie.png','Scuba suit temp.png','Burger Suit.png','Scrubs.png','FlaredUp.png','Shiller.png','MetalFan.png','BH-Tshirt.png','Uni-Fyed.png','SuperFlare.png','BoigaRed.png'];
  const TEXTURE = ['None.png','Blood.png','Acid.png','Ink.png','Dart Frog Blue.png','Dart Frog Red.png','Dart Frog Yellow.png','Magical.png','Puzzled.png','Rug Life Ink.png','Pulverized.png','FlaredInk.png'];
  const BODY    = ['Blank.png','Charcoal.png','High Voltage.png','Nebulous.png','Pinky.png','Shockwave.png','Tangerine.png','Turquoise.png','Woody.png','Frogger.png','Area 51.png','Dark Tone.png','Mid Tone.png','Light Tone.png','Jolly Roger.png','Cyber Punk.png','Talking Corpse.png','Day Tripper.png','Meat Lover.png','Golden God.png','Chrome Dome.png','Candy Gloss.png','Man On Fire.png','Water Boy.png','Icecream Man.png','Reptilian.png','Juiced Up.png','Toxic Waste.png','Love Potion.png','Pop Artist.png','Autopsy.png','Ghostly.png','Blue Screen.png','Networker.png','IceMan.png','TheLizard.png','Primal.png','PanduBeru.png'];
  const BG      = ['None.png','Natural.png','Mania.png','Regal.png','Lavish.png','Sunflower.png','Snowflake.png','Bleach.png','Vibes.png','Burst.png','Aquatic.png','Passionate.png','Envious.png','Enlightened.png','Haunted.png','Cursed.png','SolFlare.png','Tangerine.png','Navy.png','Crimson.png','Graphite.png','Eggshell.png','Slate.png','Kuwai.png','Velvet.png','Money.png','Sky.png'];

  const SUBSETS = [
    'EYES/SUBSET/alien-blink.png','EYES/SUBSET/alien-ouchy.png','EYES/SUBSET/alien-infuriated.png','EYES/SUBSET/alien-surprised.png','EYES/SUBSET/alien-stern.png','EYES/SUBSET/alien-joy.png','EYES/SUBSET/alien-curious.png',
    'EYES/SUBSET/sunglasses-blink.png','EYES/SUBSET/sunglasses-ouchy.png','EYES/SUBSET/sunglasses-infuriated.png','EYES/SUBSET/sunglasses-surprised.png','EYES/SUBSET/sunglasses-stern.png','EYES/SUBSET/sunglasses-joy.png','EYES/SUBSET/sunglasses-curious.png',
    'EYES/SUBSET/3dglasses-blink.png','EYES/SUBSET/3dglasses-ouchy.png','EYES/SUBSET/3dglasses-infuriated.png','EYES/SUBSET/3dglasses-surprised.png','EYES/SUBSET/3dglasses-stern.png','EYES/SUBSET/3dglasses-joy.png','EYES/SUBSET/3dglasses-curious.png',
    'EYES/SUBSET/spider-blink.png','EYES/SUBSET/spider-ouchy.png','EYES/SUBSET/spider-infuriated.png','EYES/SUBSET/spider-surprised.png','EYES/SUBSET/spider-stern.png','EYES/SUBSET/spider-joy.png','EYES/SUBSET/spider-curious.png',
    'EYES/SUBSET/diamond-blink.png','EYES/SUBSET/diamond-ouchy.png','EYES/SUBSET/diamond-infuriated.png','EYES/SUBSET/diamond-surprised.png','EYES/SUBSET/diamond-stern.png','EYES/SUBSET/diamond-joy.png','EYES/SUBSET/diamond-curious.png',
    'EYES/SUBSET/ruby-blink.png','EYES/SUBSET/ruby-ouchy.png','EYES/SUBSET/ruby-infuriated.png','EYES/SUBSET/ruby-surprised.png','EYES/SUBSET/ruby-stern.png','EYES/SUBSET/ruby-joy.png','EYES/SUBSET/ruby-curious.png',
    'EYES/SUBSET/hypnotized-blink.png','EYES/SUBSET/hypnotized-ouchy.png','EYES/SUBSET/hypnotized-infuriated.png','EYES/SUBSET/hypnotized-surprised.png','EYES/SUBSET/hypnotized-stern.png','EYES/SUBSET/hypnotized-joy.png','EYES/SUBSET/hypnotized-curious.png',
    'EYES/SUBSET/monocle-blink.png','EYES/SUBSET/monocle-ouchy.png','EYES/SUBSET/monocle-infuriated.png','EYES/SUBSET/monocle-surprised.png','EYES/SUBSET/monocle-stern.png','EYES/SUBSET/monocle-joy.png','EYES/SUBSET/monocle-curious.png',
    'EYES/SUBSET/demonic-blink.png','EYES/SUBSET/demonic-ouchy.png','EYES/SUBSET/demonic-infuriated.png','EYES/SUBSET/demonic-surprised.png','EYES/SUBSET/demonic-stern.png','EYES/SUBSET/demonic-joy.png','EYES/SUBSET/demonic-curious.png',
    'EYES/SUBSET/lightbright-blink.png','EYES/SUBSET/lightbright-ouchy.png','EYES/SUBSET/lightbright-infuriated.png','EYES/SUBSET/lightbright-surprised.png','EYES/SUBSET/lightbright-stern.png','EYES/SUBSET/lightbright-joy.png','EYES/SUBSET/lightbright-curious.png',
    'EYES/SUBSET/possesed-blink.png','EYES/SUBSET/possesed-ouchy.png','EYES/SUBSET/possesed-infuriated.png','EYES/SUBSET/possesed-surprised.png','EYES/SUBSET/possesed-stern.png','EYES/SUBSET/possesed-joy.png','EYES/SUBSET/possesed-curious.png',
    'EYES/SUBSET/dots-blink.png','EYES/SUBSET/dots-ouchy.png','EYES/SUBSET/dots-infuriated.png','EYES/SUBSET/dots-surprised.png','EYES/SUBSET/dots-stern.png','EYES/SUBSET/dots-joy.png','EYES/SUBSET/dots-curious.png',
    'EYES/SUBSET/stoneyeyes-blink.png','EYES/SUBSET/stoneyeyes-ouchy.png','EYES/SUBSET/stoneyeyes-infuriated.png','EYES/SUBSET/stoneyeyes-surprised.png','EYES/SUBSET/stoneyeyes-stern.png','EYES/SUBSET/stoneyeyes-joy.png','EYES/SUBSET/stoneyeyes-curious.png',
    'EYES/SUBSET/vrheadset.png',
    'EYES/SUBSET/toochill.png','EYES/SUBSET/toochill-blink.png',
    'EYES/SUBSET/deceased.png','EYES/SUBSET/deceased-blink.png','EYES/SUBSET/deceased-ouchy.png',
    'EYES/SUBSET/grumpy.png','EYES/SUBSET/grumpy-ouchy.png',
    'EYES/SUBSET/paranoid.png','EYES/SUBSET/paranoid-ouchy.png',
    'EYES/SUBSET/insect.png','EYES/SUBSET/insect-ouchy.png',
    'EYES/SUBSET/annoyed.png','EYES/SUBSET/annoyed-blink.png',
  ];

  const entries = [];
  const addCat  = (cat, files) => files.forEach(f =>
    entries.push({ rel: `${cat}/${f}`, url: `${LIVE_CDN_BASE}/${cat}/${encodeURIComponent(f)}` })
  );

  addCat('EYES',        EYES);
  addCat('MOUTH',       MOUTH);
  addCat('HEAD',        HEAD);
  addCat('OUTFIT',      OUTFIT);
  addCat('TEXTURE',     TEXTURE);
  addCat('BODY',        BODY);
  addCat('BACKGROUNDS', BG);

  entries.push({ rel: 'GIRL/Eyelashes.png', url: `${LIVE_CDN_BASE}/GIRL/Eyelashes.png` });
  entries.push({ rel: 'GIRL/Breasts.png',   url: `${LIVE_CDN_BASE}/GIRL/Breasts.png`   });

  SUBSETS.forEach(rel => entries.push({ rel, url: `${LIVE_CDN_BASE}/${rel}` }));

  for (let i = 1; i <= 88; i++) {
    entries.push({ rel: `SCENES/bg${i}.png`, url: `${LIVE_CDN_BASE}/SCENES/bg${i}.png` });
  }

  return entries;
}

function liveAssetsReady() {
  try {
    if (!fs.existsSync(LIVE_MANIFEST)) return false;
    const m = JSON.parse(fs.readFileSync(LIVE_MANIFEST, 'utf8'));
    return m.complete === true && m.version === 2;
  } catch { return false; }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const get = (u, hops = 0) => {
      if (hops > 5) return reject(new Error('Too many redirects'));
      const mod = u.startsWith('https') ? https : http;
      const req = mod.get(u, { timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); return get(res.headers.location, hops + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const tmp = destPath + '.tmp';
        const out = fs.createWriteStream(tmp);
        res.pipe(out);
        out.on('finish', () => out.close(() => {
          try { fs.renameSync(tmp, destPath); resolve(); }
          catch (e) { reject(e); }
        }));
        out.on('error', (e) => { try { fs.unlinkSync(tmp); } catch (_) {} reject(e); });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    };
    get(url);
  });
}

ipcMain.handle('check-assets-ready', () => liveAssetsReady());
ipcMain.handle('get-asset-count',    () => buildLiveAssetManifest().length);

ipcMain.handle('download-all-assets', async (event) => {
  const entries     = buildLiveAssetManifest();
  const total       = entries.length;
  let   done        = 0, failed = 0, idx = 0;
  const CONCURRENCY = 8;

  const worker = async () => {
    while (idx < total) {
      const entry = entries[idx++];
      const dest  = path.join(LIVE_ASSETS, entry.rel);
      if (fs.existsSync(dest)) {
        done++;
        event.sender.send('asset-progress', { done, total, failed, file: entry.rel, skipped: true });
        continue;
      }
      try { await downloadFile(entry.url, dest); }
      catch (e) { failed++; console.warn(`[BHB Live] asset failed [${entry.rel}]: ${e.message}`); }
      done++;
      event.sender.send('asset-progress', { done, total, failed, file: entry.rel });
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  if ((done - failed) / total >= 0.9) {
    fs.mkdirSync(LIVE_ASSETS, { recursive: true });
    fs.writeFileSync(LIVE_MANIFEST, JSON.stringify({
      complete: true, version: 2, downloadedAt: new Date().toISOString(), total, failed,
    }));
    return { ok: true, done, total, failed };
  }
  return { ok: false, done, total, failed, error: 'Too many failed downloads — check your connection and try again.' };
});

ipcMain.handle('reset-asset-cache', () => {
  try {
    if (fs.existsSync(LIVE_MANIFEST)) fs.unlinkSync(LIVE_MANIFEST);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});


// ══════════════════════════════════════════════════════════════════════════
//  IPC — ELEVENLABS  (Agent Studio)
// ══════════════════════════════════════════════════════════════════════════

function getElevenLabs(apiKey) {
  const { ElevenLabsClient } = require('@elevenlabs/elevenlabs-js');
  return new ElevenLabsClient({ apiKey });
}

ipcMain.handle('elevenlabs:voices', async (_, apiKey) => {
  const res = await getElevenLabs(apiKey).voices.getAll();
  return res.voices.map(v => ({
    voice_id: v.voiceId, name: v.name, category: v.category,
    labels: v.labels || {}, preview_url: v.previewUrl || null, description: v.description || '',
  }));
});

ipcMain.handle('elevenlabs:tts', async (_, { apiKey, voiceId, text, settings }) => {
  const stream = await getElevenLabs(apiKey).textToSpeech.convert(voiceId, {
    text, modelId: 'eleven_turbo_v2', outputFormat: 'mp3_44100_128',
    voiceSettings: {
      stability:       settings.stability        ?? 0.45,
      similarityBoost: settings.similarity_boost ?? 0.75,
      style:           settings.style            ?? 0.30,
      useSpeakerBoost: settings.speaker_boost    ?? true,
    },
  });
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const file = path.join(AUDIO_TMP, `tts_${Date.now()}.mp3`);
  fs.writeFileSync(file, Buffer.concat(chunks));
  return file;
});


// ══════════════════════════════════════════════════════════════════════════
//  IPC — AI CHAT  (Agent Studio)
// ══════════════════════════════════════════════════════════════════════════

ipcMain.handle('ai:chat', async (_, { provider, apiKey, model, messages, systemPrompt }) => {
  const fetch = (await import('node-fetch')).default;

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: model || 'claude-opus-4-5', max_tokens: 1024, system: systemPrompt, messages }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    return (await res.json()).content[0]?.text || '';
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'gpt-4o', messages: [{ role: 'system', content: systemPrompt }, ...messages] }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    return (await res.json()).choices[0]?.message?.content || '';
  }

  throw new Error(`Unknown provider: ${provider}`);
});


// ══════════════════════════════════════════════════════════════════════════
//  IPC — WEBVIEW BRIDGE  (Agent Studio)
// ══════════════════════════════════════════════════════════════════════════

ipcMain.handle('webview:send', (_, { webContentsId, channel, data }) => {
  const wc = require('electron').webContents.fromId(webContentsId);
  if (!wc) throw new Error(`No webContents id ${webContentsId}`);
  wc.send(channel, data);
  return { ok: true };
});


// ══════════════════════════════════════════════════════════════════════════
//  IPC — BHB LIVE WINDOW
// ══════════════════════════════════════════════════════════════════════════

ipcMain.handle('open-live-window',       async (_, o) => { createLiveWindow(o); return { ok: true }; });
ipcMain.handle('close-live-window',      ()           => { if (liveWin && !liveWin.isDestroyed()) liveWin.close(); return { ok: true }; });
ipcMain.handle('is-live-open',           ()           => !!(liveWin && !liveWin.isDestroyed()));
ipcMain.handle('set-live-always-on-top', (_, f)       => { liveWin?.setAlwaysOnTop(f); });
ipcMain.handle('set-live-size',          (_, { w, h }) => { liveWin?.setSize(Math.max(200, w), Math.max(200, h)); });
ipcMain.handle('update-live-state',      (_, s)       => { liveWin?.webContents.send('state-update', s); return { ok: true }; });


// ══════════════════════════════════════════════════════════════════════════
//  IPC — GLOBAL SHORTCUTS  (BHB Live expression hotkeys)
// ══════════════════════════════════════════════════════════════════════════

ipcMain.handle('register-shortcut', (_, { accelerator, expression }) => {
  // Remove any existing binding for this accelerator or expression
  if (shortcutMap.has(accelerator)) {
    try { globalShortcut.unregister(accelerator); } catch (_) {}
    shortcutMap.delete(accelerator);
  }
  for (const [k, expr] of shortcutMap.entries()) {
    if (expr === expression && k !== accelerator) {
      try { globalShortcut.unregister(k); } catch (_) {}
      shortcutMap.delete(k); break;
    }
  }
  try {
    const ok = globalShortcut.register(accelerator, () => {
      liveWin?.webContents.send('expression-activate', expression);
      mainWin?.webContents.send('expression-activate', expression);
    });
    if (ok) { shortcutMap.set(accelerator, expression); return { ok: true }; }
    return { ok: false, error: 'Key already in use by another application' };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('unregister-shortcut',      (_, a) => {
  try { globalShortcut.unregister(a); shortcutMap.delete(a); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('unregister-all-shortcuts', () => {
  globalShortcut.unregisterAll(); shortcutMap.clear(); return { ok: true };
});
ipcMain.handle('get-shortcuts', () => Object.fromEntries(shortcutMap));


// ══════════════════════════════════════════════════════════════════════════
//  IPC — AUTO-UPDATER
// ══════════════════════════════════════════════════════════════════════════

ipcMain.handle('install-update',    () => { autoUpdater?.quitAndInstall(false, true); });
ipcMain.handle('check-for-updates', () => {
  if (!autoUpdater) return { ok: false, reason: 'updater not available' };
  autoUpdater.checkForUpdates().catch(() => {});
  return { ok: true };
});
