// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Electron main process: entry point.
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
//     envelopes; same shape the extension background uses, so shared
//     renderer code doesn't need to branch on shell.
//
// OS keychain integration (§40.12, Step 17):
//   - After first-launch unlock, the master key is cached in the OS
//     keychain via Electron `safeStorage` (macOS Keychain / Windows DPAPI
//     / Linux libsecret). The ciphertext is written to `session.bin`;
//     the key material stays inside the OS keychain.
//   - On subsequent launches, `app.whenReady` probes the keychain; if
//     the master key is readable, the vault opens and the renderer's
//     first `session.status` call returns `unlocked`; the password
//     prompt is skipped until the user explicitly locks (or the keychain
//     becomes unreadable, e.g. OS logout, keychain reset).
//   - If `safeStorage.isEncryptionAvailable()` is false, the session
//     cache is silently disabled; the user re-enters their password
//     every launch rather than having the key written insecurely.

import { app, BrowserWindow, Menu, ipcMain, safeStorage, session, shell, Notification } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry as registryLib, sdk as sdkLib, flows as flowsLib } from '@xchain-wallet/core';
import { WALLET_VERSION } from '@xchain-wallet/core/buildInfo.js';
import * as sdkModule from 'xchain-sdk';

import { IPC_CHANNEL } from './messageHost.js';
// Pre-host + runtime helpers live in the pure-JS runtime module so the
// IPC dispatch logic is testable without importing `electron`.
import { FileStorageBackend, vaultPathFor } from './storage.js';
import { FileMetaBackend, metaPathFor } from './meta.js';
import { KeychainSessionBackend, sessionKeyPathFor } from './keychain.js';
import { FileUnlockThrottleStore, unlockThrottlePathFor } from './unlockThrottle.js';
import { isHttpUrl, shouldBlockNavigation, isTrustedSenderEvent } from './security.js';
import { attachHidPermissions } from './permissions.js';
import {
    attachDeepLinkHandlers,
    registerProtocolClients,
} from './protocol.js';
import { attachSignerBridgeListener } from './signerBridgeListener.js';
import { attachUpdater } from './updater.js';
import { applyTorRouting } from './torRouting.js';
import {
    createRuntime,
    ensureHost,
    handleIpcMessage,
    tearDownHost,
    wipeRuntimeStores,
} from './runtime.js';

const here = dirname(fileURLToPath(import.meta.url));

// §24.6 / G057: multi-window: instead of a singleton mainWindow, the
// main process keeps a Set of every open BrowserWindow so File → New
// Window can open additional renderers that share the same vault +
// signer state via the main-process MessageHost. Existing logic
// (deep-link forward, updater broadcast) targets the focused window
// when one exists, otherwise the most-recently-created.
const windows = /** @type {Set<BrowserWindow>} */ (new Set());
let runtime = /** @type {ReturnType<typeof createRuntime> | null} */ (null);

/** @type {{ scheme: string, raw: string, parsed: any } | null} */
let pendingDeepLink = null;

// §9.7 / G007: boot-time chain-registry sync promise. Main owns the
// network fetch (the renderer CSP pins connect-src 'self'); the verified
// descriptor batch is re-served to every renderer realm via the
// `xchain:chain-registry` IPC handler, which awaits this promise so a
// renderer that boots before the sync settles still gets the result.
/** @type {Promise<{ ok: boolean, descriptors?: object[], generatedAt?: string, reason?: string }> | null} */
let chainRegistrySync = null;

// §9.3.2 navigation lockdown. Every BrowserWindow loads the local
// renderer with the preload attached, and the preload exposes the
// privileged `xchainWalletBridge.sendMessage` (unlock / send / sign over
// an auto-unlocked vault). Electron's defaults would let a renderer
// `window.open` a child window that INHERITS the preload, or navigate the
// top-level frame to a remote origin that KEEPS the preload; either puts
// the bridge in front of non-app content (the desktop analog of the
// extension's BRIDGE-1 drain). This guard, applied to every webContents
// the app ever creates, denies all `window.open` (routing http(s) links
// to the OS browser), blocks any navigation away from the local app, and
// refuses `<webview>` embedding. See security.js for the pure predicates.
function hardenWebContents(contents) {
    if (!contents || typeof contents.setWindowOpenHandler !== 'function') return;
    contents.setWindowOpenHandler(({ url }) => {
        // Open real external links in the user's browser, never in a
        // preload-bearing Electron window.
        if (isHttpUrl(url)) {
            shell.openExternal(url).catch((err) => {
                console.error('[xchain] shell.openExternal failed:', err);
            });
        }
        return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
        if (shouldBlockNavigation(url)) {
            event.preventDefault();
            if (isHttpUrl(url)) {
                shell.openExternal(url).catch(() => { /* best-effort */ });
            }
        }
    });
    contents.on('will-attach-webview', (event) => {
        // The wallet never embeds a <webview>; refuse any attempt.
        event.preventDefault();
    });
}

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

// THE SDK THIS SHELL ACTUALLY USES, and it was the dev mock until .
//
// The extension and the web shell both build their registry on
// `createDevMockSdk` synchronously - a service worker has to register its
// handlers before anything can be awaited - and then REPLACE it with the real
// factory once `resolveSdkFactory` settles. This shell only ever did the
// first half. Nothing swapped, `SDKRegistry` has no fallback of its own, and
// so every SDK instance the main process handed out was the stub: fabricated
// addresses out of `mockDeriveAddress`, and `signPsbt` / `importWIF` /
// `signMessage` / `broadcastTx` throwing "Dev SDK stub". It shipped that way.
//
// There is no reason for the two-step here. A main process is not a service
// worker: nothing forces a synchronous registry, so the real SDK is imported
// statically and adapted once, the way `sdkStatic.js` does it for the shell
// that genuinely cannot. That removes the mock from this shell entirely
// rather than racing it.
//
// FAILING HERE IS THE POINT. A wallet whose SDK did not load cannot derive,
// sign or broadcast, and the one behaviour that must never happen is
// continuing on a mock that answers every call with plausible nonsense. The
// other two shells say this in as many words in their own resolver; on this
// path a bad export shape stops the app at startup instead.
const XChainSDK = sdkModule?.XChainSDK
    ?? sdkModule?.default?.XChainSDK
    ?? sdkModule?.default;
if (typeof XChainSDK !== 'function') {
    throw new Error(
        '[xchain-wallet/desktop] xchain-sdk did not expose an `XChainSDK` class; '
        + 'refusing to start rather than fall back to a mock SDK (it serves fake data).',
    );
}
const REAL_SDK_FACTORY = sdkLib.adaptXChainSDK(XChainSDK);

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
        // §26: file-backed unlock-attempt throttle so desktop wallet.unlock
        // enforces the same pre-KDF lockout the extension ships (persisted
        // under userData; survives restart so a relaunch can't reset it).
        unlockThrottleStore: new FileUnlockThrottleStore(unlockThrottlePathFor(userData)),
        chainRegistry,
        sdkRegistry: new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: REAL_SDK_FACTORY,
        }),
        // : Tor routing has to take effect on the next request,
        // not the next launch. The shared host calls this after any
        // settings.update whose patch touches `privacy`.
        onPrivacySettingsChanged: async (settings, { sdkRegistry }) => {
            await applyTorRouting({
                settings,
                sdkRegistry,
                session: session.defaultSession,
                log: (m) => console.info(m),
            });
        },
        // §46: OS-notification adapter (main process owns the `electron`
        // import; the runtime stays Electron-free for unit testing).
        notify: ({ title, body }) => {
            try {
                if (Notification.isSupported && Notification.isSupported()) {
                    new Notification({ title, body }).show();
                }
            } catch (err) {
                console.error('[xchain] desktop notification failed:', err);
            }
        },
        // §50 / Cluster L FOLLOWUP 4: desktop diagnostic env + build.
        // Electron version + OS + Chromium UA help support narrow down
        // whether a bug is shell-specific.
        getDiagnosticContext: async () => ({
            env: {
                shell: 'desktop',
                userAgent: `Electron/${process.versions.electron} Chrome/${process.versions.chrome} Node/${process.versions.node}`,
                platform: `${process.platform} ${process.arch}`,
            },
            build: {
                walletVersion: WALLET_VERSION,
                target: app.getVersion(),
            },
        }),
    });
}

/**
 * Open a renderer window. Safe to call repeatedly; every call returns
 * a fresh `BrowserWindow` connected to the same main-process MessageHost
 * (vault + signers stay singleton). Each window registers itself with
 * the `windows` set and unregisters on `closed`.
 *
 * §24.6 / G057: File → New Window invokes this with no args.
 * §24.6 / Cluster Y FOLLOWUP 4: `xchain:open-window` IPC invokes this
 * with `{ initialView, initialContext }` to detach a pending tx detail
 * (or any other view) into its own window. The route prefill rides
 * through the URL search string so the renderer can pick it up on
 * mount via `window.location.search` and clear it via
 * `history.replaceState`.
 *
 * @param {{ initialView?: string, initialContext?: any }} [opts]
 */
function createWindow(opts = {}) {
    const win = new BrowserWindow({
        width: 420,
        height: 720,
        minWidth: 360,
        minHeight: 600,
        webPreferences: {
            preload: join(here, '..', 'preload.cjs'),
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
    const loadOpts = buildLoadOptions(opts);
    win.loadFile(join(here, '..', 'renderer', 'dist', 'index.html'), loadOpts);
    win.once('ready-to-show', () => {
        if (!win.isDestroyed()) win.show();
        // Replay any deep link that arrived before the first window
        // came up. Subsequent windows ignore the queue; once one
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
 * Build the loadFile options carrying the optional initialView /
 * initialContext route prefill. Encoded as a single
 * `xc-init-route=<base64-json>` search-string entry so the renderer
 * can pick it up via `window.location.search`. Base64 keeps the URL
 * tidy when the context object has nested fields (chainId / actionIndex
 * / txid for a detached pending tx).
 *
 * @param {{ initialView?: string, initialContext?: any }} opts
 * @returns {{ search?: string }}
 */
function buildLoadOptions(opts) {
    if (!opts || (!opts.initialView && !opts.initialContext)) return {};
    const payload = {};
    if (opts.initialView) payload.initialView = String(opts.initialView);
    if (opts.initialContext != null) payload.initialContext = opts.initialContext;
    try {
        const json = JSON.stringify(payload);
        const b64 = Buffer.from(json, 'utf8').toString('base64');
        return { search: `xc-init-route=${encodeURIComponent(b64)}` };
    } catch {
        return {};
    }
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
// §9.3.2: harden every webContents the app creates (main windows,
// detached windows, devtools, any future child) the moment it exists, so
// no preload-bearing frame can be navigated to, or spawn a window loading,
// remote content. Registered before whenReady so the very first window is
// covered.
app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents);
});

const deepLinkCtx = attachDeepLinkHandlers(app, { onDeepLink: forwardDeepLink });
if (!deepLinkCtx.gotLock) {
    // Another instance is already running. Quit cleanly; the running
    // instance will pick up our URL from `second-instance`.
    app.quit();
}

app.whenReady().then(async () => {
    runtime = buildRuntime();

    // §9.7 / G007: refresh chain descriptors from the hub's signed public
    // registry snapshot. Same soft-enhancement contract as the web +
    // extension shells: the signature must verify against the pinned
    // federation key or nothing changes, and any failure (offline,
    // tampered, unsigned) leaves the bundled descriptors serving. The
    // main-realm defaultRegistry() singleton is the one buildRuntime()
    // handed to the SDKRegistry, so a successful apply reaches the host
    // side immediately; renderer realms pull the same verified batch via
    // `xchain:chain-registry` below. Never blocks boot.
    try {
        chainRegistrySync = registryLib
            .syncChainRegistryFromHub({ registry: registryLib.defaultRegistry() })
            .then((r) => {
                if (!r.ok) console.info('[xchain] desktop: chain-registry sync skipped:', r.reason);
                return r;
            })
            .catch((err) => ({ ok: false, reason: String(err?.message ?? err) }));
    } catch { /* soft enhancement; bundled descriptors keep serving */ }

    // Best-effort auto-unlock. Failure here is logged but doesn't block
    // startup; the renderer will see `state: 'locked'` and prompt for
    // the password.
    try {
        await ensureHost(runtime);
    } catch (err) {
        console.error('[xchain] desktop auto-unlock failed:', err);
    }

    // : re-apply Tor routing as soon as settings are readable.
    // Without this, a user who turned it on, quit, and relaunched would
    // run direct until they happened to toggle it again, with the UI
    // showing it on the whole time. That is the same lie in a new place.
    // Settings live in the vault, so this only works once unlocked; a
    // still-locked wallet has made no requests yet either.
    try {
        const settings = await flowsLib.getSettings(runtime.vault);
        await applyTorRouting({
            settings,
            sdkRegistry: runtime.sdkRegistry,
            session: session.defaultSession,
            log: (m) => console.info(m),
        });
    } catch (err) {
        console.info('[xchain] Tor routing not applied at boot (vault locked?):',
            String(err?.message ?? err));
    }

    // §40.12 / Step 18: allow WebHID access for Ledger + Trezor vendor
    // IDs so PairSignerForm can reach the device picker. Without these
    // handlers Electron returns an empty device list under
    // `contextIsolation: true`.
    attachHidPermissions(session.defaultSession);

    // §40.12 Step 19: claim `xchain:` unconditionally. Tier-2 coin
    // schemes (bitcoin / litecoin / dogecoin) stay unclaimed until a
    // future settings toggle opts in; we don't silently override the
    // user's primary BTC wallet.
    registerProtocolClients(app, { optedInSchemes: [] });

    // electron-updater: only active in packaged builds (isUpdaterActive
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

    ipcMain.handle(IPC_CHANNEL, async (event, message) => {
        // Sender trust boundary (belt-and-suspenders behind the navigation
        // lockdown): reject a call whose frame is a positively-remote
        // origin. A legitimate local renderer always passes.
        if (!isTrustedSenderEvent(event)) {
            return {
                ok: false,
                error: { name: 'ForbiddenSenderError', message: 'desktop: message rejected from untrusted frame' },
            };
        }
        if (!runtime) {
            return {
                ok: false,
                error: { name: 'Error', message: 'desktop: runtime not initialized' },
            };
        }
        return handleIpcMessage(runtime, message);
    });

    // §24.6 / Cluster Y FOLLOWUP 4: detach a pending tx (or any
    // other view) into a fresh BrowserWindow. The renderer dispatches
    // through `xchainWalletWindow.openDetached` (preload), which
    // invokes this channel; main creates a window pre-routed via
    // search-string prefill. Validates shape so a misbehaving
    // renderer can't pass non-serializable junk.
    ipcMain.handle('xchain:open-window', async (event, args) => {
        if (!isTrustedSenderEvent(event)) {
            return { ok: false, error: 'open-window: rejected from untrusted frame' };
        }
        const initialView = typeof args?.initialView === 'string' ? args.initialView : '';
        const initialContext = args?.initialContext && typeof args.initialContext === 'object'
            ? args.initialContext
            : null;
        if (!initialView && !initialContext) {
            return { ok: false, error: 'open-window: initialView or initialContext required' };
        }
        try {
            const win = createWindow({ initialView, initialContext });
            return { ok: true, windowId: win.id };
        } catch (err) {
            return { ok: false, error: String(err?.message ?? err) };
        }
    });

    // : renderer-driven wipe of the shell's own stores. The
    // renderer's wipeWalletStorage clears localStorage + IndexedDB,
    // neither of which this shell uses, so without this channel both
    // wipe paths (demo exit, Locked "forgot password") are silent
    // no-ops and the user is handed an unlock screen for the vault
    // they just destroyed. Same trusted-sender gate as every other
    // channel: a remote frame cannot nuke someone's wallet.
    ipcMain.handle('xchain:wipe-storage', async (event) => {
        if (!isTrustedSenderEvent(event)) {
            return { ok: false, error: 'wipe-storage: rejected from untrusted frame' };
        }
        if (!runtime) {
            return { ok: false, error: 'wipe-storage: runtime not initialized' };
        }
        try {
            const result = await wipeRuntimeStores(runtime);
            if (result.ok) return { ok: true, cleared: result.cleared };
            return {
                ok: false,
                cleared: result.cleared,
                error: result.errors.map((e) => `${e.store}: ${e.message}`).join('; '),
            };
        } catch (err) {
            return { ok: false, error: String(err?.message ?? err) };
        }
    });

    // §9.7 / G007: hand the verified registry batch to renderer realms.
    // Awaits the boot sync so early callers don't race it; a failed or
    // skipped sync resolves { ok: false } and the renderer keeps its
    // bundled descriptors. Descriptors are already signature-verified
    // and schema-validated here in main; the renderer still re-validates
    // inside applyRemoteDescriptors.
    ipcMain.handle('xchain:chain-registry', async (event) => {
        if (!isTrustedSenderEvent(event)) {
            return { ok: false, reason: 'chain-registry: rejected from untrusted frame' };
        }
        if (!chainRegistrySync) return { ok: false, reason: 'registry sync not started' };
        const r = await chainRegistrySync;
        return r.ok
            ? { ok: true, descriptors: r.descriptors, generatedAt: r.generatedAt }
            : { ok: false, reason: r.reason };
    });

    // Wire the signer-bridge ipc listener so renderer-hosted HW
    // signers (paired via PairSignerForm) become reachable from the
    // main-process MessageHost. `action.*.hw` handlers consult the
    // same process-wide `signerBridge` registry this listener feeds.
    attachSignerBridgeListener({ ipcMain, isTrustedSender: isTrustedSenderEvent });

    // §24.6 / G057: install the application menu (File → New Window)
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
    // reallocation. The session-backend ciphertext stays on disk; the
    // next launch reuses it via the keychain.
    if (runtime) tearDownHost(runtime);
});

