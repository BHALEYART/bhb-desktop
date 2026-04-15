# BHB Desktop — Migration Guide

## Folder structure

```
bhb-desktop/
├── src/
│   ├── main.js          ← unified main process (this file)
│   └── preload.js       ← unified preload (all three apps merged)
├── launcher/
│   └── index.html       ← home menu UI
├── apps/
│   ├── studio/          ← copy from BHB-Studio/renderer/
│   │   ├── customizer/
│   │   │   └── index.html
│   │   └── animator/
│   │       └── index.html
│   ├── live/            ← copy from bhb-obs-plugin/
│   │   ├── control.html
│   │   └── live.html
│   └── agent/           ← copy from bhb-agent-studio/renderer/
│       └── renderer/
│           ├── index.html
│           └── webviews/
│               ├── customizer-preload.js
│               └── animator-preload.js
├── build/               ← shared build assets
│   ├── icon.icns
│   ├── icon.ico
│   ├── icon.png
│   ├── dmg-bg.png
│   └── entitlements.mac.plist
├── package.json
└── MIGRATION.md
```

---

## Step 1 — Copy renderer files

### BHB Studio
```
BHB-Studio/renderer/customizer/  →  bhb-desktop/apps/studio/customizer/
BHB-Studio/renderer/animator/    →  bhb-desktop/apps/studio/animator/
```

### BHB Live
```
bhb-obs-plugin/control.html  →  bhb-desktop/apps/live/control.html
bhb-obs-plugin/live.html     →  bhb-desktop/apps/live/live.html
```

### BHB Agent Studio
```
bhb-agent-studio/renderer/  →  bhb-desktop/apps/agent/renderer/
```

---

## Step 2 — Update preload references in each renderer

Each renderer's HTML files call `window.electronAPI.*` via the preload. The
unified preload exposes the same method names as before, so **most renderers
will work without changes**. One thing to verify per section:

### BHB Studio
The Studio renderer fires `ipcRenderer.send('navigate', page)` directly
through its own preload. In the unified app this still works — the unified
`main.js` handles the `'navigate'` ipcMain.on listener. No change needed.

### BHB Live
The Live renderer's `control.html` calls methods like `openLiveWindow`,
`registerShortcut`, `checkAssetsReady`, etc. These are all exposed on
`window.electronAPI` in the unified preload with the same names.

If the original `bhb-obs-plugin/preload.js` exposed these under a different
property (e.g. `window.bhbAPI`), update `control.html` and `live.html` to
use `window.electronAPI` instead, or add a compatibility alias in
`preload.js`:
```js
// Backward-compat alias — add to bottom of preload.js if needed
contextBridge.exposeInMainWorld('bhbAPI', window.electronAPI);
```

### BHB Agent Studio
The Agent renderer uses `webviewTag: true` and preloads
`customizer-preload.js` / `animator-preload.js`. These are mapped in
`src/main.js` via the `will-attach-webview` handler. Verify the paths to
these files are correct after copying.

---

## Step 3 — Build assets

Copy shared build assets from any of the three apps into `build/`:
```
icon.icns / icon.ico / icon.png   (use BHB Desktop branding if different)
dmg-bg.png
entitlements.mac.plist
```

The `entitlements.mac.plist` must include microphone access for BHB Live:
```xml
<key>com.apple.security.device.audio-input</key>
<true/>
```

---

## Step 4 — userData coexistence

The unified app uses `app.getPath('userData')` which resolves to:
- Mac: `~/Library/Application Support/BHB Desktop/`
- Win: `%APPDATA%\BHB Desktop\`

This is **separate** from the individual apps' userData folders
(`BHB Studio`, `BHB Live`, `BHB Agent Studio`). Users who previously used
the separate apps will not automatically see their existing save slots or
downloaded assets. If you want to migrate their data on first launch, add a
one-time migration in `app.whenReady()` that copies from the old folders.

---

## Step 5 — GitHub Actions CI/CD

Update your existing workflows to point to the new repo. The build config
in `package.json` already has:
```json
"publish": {
  "provider": "github",
  "owner": "BHALEYART",
  "repo": "bhb-desktop"
}
```

Create a new repo `BHALEYART/bhb-desktop` and push. Your existing
`.github/workflows/build.yml` from any of the three apps can be adapted —
the key change is the repo name in the publish step.

---

## Back button

The unified `preload.js` automatically injects a floating `← Home` button
into every non-launcher page. No changes to the original renderer HTML files
are needed. The button:
- Appears fixed at top-left with a dark glass style
- Adapts color for light-themed pages (BHB Studio)
- Calls `app:go-home` IPC which triggers `loadSection('launcher')`

To hide it on a specific page, add this CSS to that page:
```css
#bhb-back-btn { display: none !important; }
```

---

## Notes on window sizing

Each section loads at its preferred size (set in `SECTION_CONFIG` in
`main.js`). The window smoothly resizes and re-centers when navigating.
BHB Studio and Animator use `theme: 'light'`; Live and Agent use
`theme: 'dark'`. The launcher is fixed-size (non-resizable).

---

## Known difference: BHB Live asset download IPC channel

The original `bhb-obs-plugin` used channel `download-all-assets` with
progress event `asset-progress`. The unified app preserves these exact
channel names — Live's `control.html` should work without changes.

The Agent Studio uses `assets:download` with progress event
`assets:progress` (different names). Both coexist with no conflict.
