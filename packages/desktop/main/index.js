// Electron main process — entry point.
//
// Thin adapter over `runtime.js`: wires Electron's lifecycle events to
// the pure-JS runtime state machine. Keeping Electron-specific code
// confined to this file means the IPC dispatch + auto-unlock logic is
// testable under plain Node (see `desktop-keychain.smoke.js`).
//
// Security posture (§9.3.2):
//   - Renderer runs with nodeIntegration=false, contextIsolation=true.
//   - Preload is the only bridge; it exposes a single
//     `sendMessage(message)` function via contextBridge.
//   - Vault + signers live in main; the master key never crosses IPC.
//   - All IPC traffic returns structured `{ ok, result } | { ok, error }`
//     envelopes — same shape the extension background uses, so shared
//     renderer code doesn't need to branch on shell.
//
// OS keychain integration (§40.12, Step 17):
//   - After first-launch unlock, the master key is cached in the OS
//     keychain via Electron `safeStorage` (macOS Keychain / Windows DPAPI
//     / Linux libsecret). The ciphertext is written to `session.bin`;
//     the key material stays inside the OS keychain.
//   - On subsequent launches, `app.whenReady` probes the keychain; if
//     the master key is readable, the vault opens and the renderer's
//     first `session.status` call returns `unlocked` — the password
//     prompt is skipped until the user explicitly locks (or the keychain
//     becomes unreadable, e.g. OS logout, keychain reset).
//   - If `safeStorage.isEncryptionAvailable()` is false, the session
//     cache is silently disabled — the user re-enters their password
//     every launch rather than having the key written insecurely.

import { app, BrowserWindow, Menu, ipcMain, safeStorage, session } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry as registryLib, sdk as sdkLib } from '@xchain-wallet/core';
import { createDevMockSdk } from '@xchain-wallet/extension/src/background/sdkFactory.js';

import { IPC_CHANNEL } from './messageHost.js';
// Pre-host + runtime helpers live in the pure-JS runtime module so the
// IPC dispatch logic is testable without importing `electron`.
import { FileStorageBackend, vaultPathFor } from './storage.js';
import { FileMetaBackend, metaPathFor } from './meta.js';
import { KeychainSessionBackend, sessionKeyPathFor } from './keychain.js';
import { attachHidPermissions } from './permissions.js';
import {
    attachDeepLinkHandlers,
    registerProtocolClients,
} from './protocol.js';
import { attachSignerBridgeListener } from './signerBridgeListener.js';
import { attachUpdater } from './updater.js';
import {
    createRuntime,
    ensureHost,
    handleIpcMessage,
    tearDownHost,
} from './runtime.js';

const here = dirname(fileURLToPath(import.meta.url));

// §24.6 / G057 — multi-window: instead of a singleton mainWindow, the
// main process keeps a Set of every open BrowserWindow so File → New
// Window can open additional renderers that share the same vault +
// signer state via the main-process MessageHost. Existing logic
// (deep-link forward, updater broadcast) targets the focused window
// when one exists, otherwise the most-recently-created.
const windows = /** @type {Set<BrowserWindow>} */ (new Set());
let runtime = /** @type {ReturnType<typeof createRuntime> | null} */ (null);

/** @type {{ scheme: string, raw: string, parsed: any } | null} */
let pendingDeepLink = null;

function liveWindows() {
    return [...windows].filter((w) => !w.isDestroyed());
}

function pickFocusWindow() {
    const live = liveWindows();
    if (live.length === 0) return null;
    return BrowserWindow.getFocusedWindow() || live[live.length - 1];
}

function broadcastToWindows(channel, payload) {
    for (const w of liveWindows()) {
        w.webContents.send(channel, payload);
    }
}

function forwardDeepLink(event) {
    // Renderer may not exist yet at app start; queue the first one and
    // replay when a window is ready. Multi-window: the deep link goes
    // to the focused window so the user's current context wins.
    const target = pickFocusWindow();
    if (!target) {
        pendingDeepLink = event;
        return;
    }
    target.webContents.send('xchain:uri', event);
    if (!target.isFocused()) target.focus();
}

function buildRuntime() {
    const userData = app.getPath('userData');
    const chainRegistry = registryLib.defaultRegistry();
    return createRuntime({
        storageBackend: new FileStorageBackend(vaultPathFor(userData)),
        metaBackend: new FileMetaBackend(metaPathFor(userData)),
        sessionBackend: new KeychainSessionBackend({
            safeStorage,
            filePath: sessionKeyPathFor(userData),
        }),
        chainRegistry,
        sdkRegistry: new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: createDevMockSdk,
        }),
    });
}

/**
 * Open a renderer window. Safe to call repeatedly — every call returns
 * a fresh `BrowserWindow` connected to the same main-process MessageHost
 * (vault + signers stay singleton). Each window registers itself with
 * the `windows` set and unregisters on `closed`.
 *
 * §24.6 / G057 — File → New Window invokes this for additional
 * windows; the first call from `app.whenReady` opens the primary one.
 */
function createWindow() {
    const win = new BrowserWindow({
        width: 420,
        height: 720,
        minWidth: 360,
        minHeight: 600,
        webPreferences: {
            preload: join(here, '..', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
        show: false,
    });

    // Renderer is built into packages/desktop/renderer/dist by Step 19's
    // packaging pipeline (vite build). In packaged mode that's what
    // `loadFile` points at; in dev the same path works because
    // `pnpm run start` runs vite first.
    win.loadFile(join(here, '..', 'renderer', 'dist', 'index.html'));
    win.once('ready-to-show', () => {
        if (!win.isDestroyed()) win.show();
        // Replay any deep link that arrived before the first window
        // came up. Subsequent windows ignore the queue — once one
        // renderer has consumed it, additional renderers shouldn't
        // double-handle the same URI.
        if (pendingDeepLink) {
            const event = pendingDeepLink;
            pendingDeepLink = null;
            forwardDeepLink(event);
        }
    });
    win.on('closed', () => { windows.delete(win); });

    windows.add(win);
    return win;
}

/**
 * Wire the macOS-style application menu. The custom slot we care about
 * is `File → New Window` (Cmd+N / Ctrl+N) which calls `createWindow()`.
 * The rest of the menu uses Electron's `role: ...` defaults so standard
 * editing / window-management behaviors stay native to each platform.
 *
 * §24.6 / G057.
 */
function buildApplicationMenu() {
    const isMac = process.platform === 'darwin';
    /** @type {Electron.MenuItemConstructorOptions[]} */
    const template = [
        ...(isMac ? [{
            label: app.name,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
            ],
        }] : []),
        {
            label: '&File',
            submenu: [
                {
                    label: 'New Window',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => { createWindow(); },
                },
                { type: 'separator' },
                isMac ? { role: 'close' } : { role: 'quit' },
            ],
        },
        {
            label: '&Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
        {
            label: '&View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' },
            ],
        },
        {
            label: '&Window',
            submenu: [
                { role: 'minimize' },
                { role: 'zoom' },
                ...(isMac ? [
                    { type: 'separator' },
                    { role: 'front' },
                ] : [
                    { role: 'close' },
                ]),
            ],
        },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// §40.12 Step 19: single-instance lock + deep-link dispatch must run
// BEFORE whenReady so a second invocation (e.g. a `bitcoin:` click
// while the app is already running) routes correctly. `requestSingleInstanceLock`
// is idempotent and safe to call early.
const deepLinkCtx = attachDeepLinkHandlers(app, { onDeepLink: forwardDeepLink });
if (!deepLinkCtx.gotLock) {
    // Another instance is already running. Quit cleanly; the running
    // instance will pick up our URL from `second-instance`.
    app.quit();
}

app.whenReady().then(async () => {
    runtime = buildRuntime();
    // Best-effort auto-unlock. Failure here is logged but doesn't block
    // startup — the renderer will see `state: 'locked'` and prompt for
    // the password.
    try {
        await ensureHost(runtime);
    } catch (err) {
        console.error('[xchain] desktop auto-unlock failed:', err);
    }

    // §40.12 / Step 18: allow WebHID access for Ledger + Trezor vendor
    // IDs so PairSignerForm can reach the device picker. Without these
    // handlers Electron returns an empty device list under
    // `contextIsolation: true`.
    attachHidPermissions(session.defaultSession);

    // §40.12 Step 19: claim `xchain:` unconditionally. Tier-2 coin
    // schemes (bitcoin / litecoin / dogecoin) stay unclaimed until a
    // future settings toggle opts in — we don't silently override the
    // user's primary BTC wallet.
    registerProtocolClients(app, { optedInSchemes: [] });

    // electron-updater — only active in packaged builds (isUpdaterActive
    // returns false in dev). Events relay to every open renderer via
    // IPC so any window can surface the "update available" toast.
    try {
        const { checkForUpdates } = await attachUpdater({
            onEvent: (event) => {
                broadcastToWindows('xchain:updater', event);
            },
        });
        // Kick a check on launch. User-triggered re-checks land later
        // via a "Check for updates" menu item (future step).
        void checkForUpdates();
    } catch (err) {
        console.error('[xchain] updater wiring failed:', err);
    }

    ipcMain.handle(IPC_CHANNEL, async (_event, message) => {
        if (!runtime) {
            return {
                ok: false,
                error: { name: 'Error', message: 'desktop: runtime not initialized' },
            };
        }
        return handleIpcMessage(runtime, message);
    });

    // Wire the signer-bridge ipc listener so renderer-hosted HW
    // signers (paired via PairSignerForm) become reachable from the
    // main-process MessageHost. `action.*.hw` handlers consult the
    // same process-wide `signerBridge` registry this listener feeds.
    attachSignerBridgeListener({ ipcMain });

    // §24.6 / G057 — install the application menu (File → New Window)
    // before opening the primary window so the accelerator is live the
    // moment the renderer focuses.
    buildApplicationMenu();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    // Zero the master key + close the encrypted doc. The OS already
    // treats process-exit memory as freed, but explicit zeroing catches
    // cases where a GC'd buffer might otherwise linger until
    // reallocation. The session-backend ciphertext stays on disk — the
    // next launch reuses it via the keychain.
    if (runtime) tearDownHost(runtime);
});

