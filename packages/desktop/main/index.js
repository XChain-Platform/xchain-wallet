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
//   - Preload is the only bridge; the surface it exposes via contextBridge is
//     exactly the worlds pinned in BRIDGE_WORLDS
//     (test/integration/shells/desktop-preload-contract.test.js), all of them
//     functions, headed by `xchainWalletBridge.sendMessage(message)`.
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

// First import on purpose: the test network guard must be in place before
// any other module evaluates (see networkGuardBoot.js). Off unless a test
// harness sets XCHAIN_TEST_NETWORK_GUARD or --xchain-test-network-guard.
import { networkGuard, runNetworkGuardProbeAndExit } from './networkGuardBoot.js';
import { app, BrowserWindow, dialog, Menu, ipcMain, powerMonitor, safeStorage, screen, session, shell, Notification, Tray } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registry as registryLib, sdk as sdkLib } from '@xchain-wallet/core';
import { WALLET_VERSION } from '@xchain-wallet/core/buildInfo.js';
import { logConsole } from '@xchain-wallet/core/shared/utils/logConsole.js';
import * as sdkModule from 'xchain-sdk';

import { IPC_CHANNEL } from './messageHost.js';
// Pre-host + runtime helpers live in the pure-JS runtime module so the
// IPC dispatch logic is testable without importing `electron`.
import { FileStorageBackend, vaultPathFor } from './storage.js';
import { FileMetaBackend, metaPathFor } from './meta.js';
import { KeychainSessionBackend, sessionKeyPathFor } from './keychain.js';
import { FileUnlockThrottleStore, unlockThrottlePathFor } from './unlockThrottle.js';
import { FileAutoLockStore, autoLockStatePathFor } from './autoLockState.js';
import { FilePanicModeStore, panicModeStatePathFor } from './panicModeState.js';
import { applyScreenProtection } from './screenProtection.js';
import {
    attachRendererCspHeaders,
    allowlistedExternalUrl,
    hasNoIpcArguments,
    isValidDesktopIpcMessage,
    normalizeOpenWindowArgs,
    shouldBlockNavigation,
    isTrustedSenderEvent,
    shouldIgnoreBeforeUnload,
} from './security.js';
import { attachHidPermissions, attachHidDenial, observeHidFrames } from './permissions.js';
import {
    attachDeepLinkHandlers,
    createDeepLinkSlot,
    pickDeepLinkTarget,
    registerProtocolClients,
} from './protocol.js';
import { attachSignerBridgeListener } from './signerBridgeListener.js';
import { createTrezorBridge } from './trezorBridgeWindow.js';
import { attachUpdater } from './updater.js';
import { applyTorRouting, applyProxyToSession } from './torRouting.js';
import {
    installProcessErrorHandlers,
    reportMainFailure,
    runMainCallback,
    runMainTask,
} from './errorBoundary.js';
import { stateChangeForMessage } from './multiWindowState.js';
import { saveBackupFile } from './backupSave.js';
import { writeFile as writeFileAsync } from 'node:fs/promises';
import { createQuitDeferral, isQuitDeferringMessage } from './quitGuard.js';
import {
    applyTestMockKeychain,
    applyTestNoFocusPolicy,
    focusWindow,
    noFocusEnabled,
    showWindow,
} from './testFocus.js';
import {
    FileWindowBoundsStore,
    MIN_WINDOW_BOUNDS,
    cascadeWindowBounds,
    firstLaunchWindowBounds,
    normalizeWindowBounds,
    restoreWindowBounds,
    windowBoundsPathFor,
} from './windowBounds.js';
import {
    DESKTOP_ABOUT_PANEL_OPTIONS,
    DESKTOP_PRODUCT_NAME,
    DESKTOP_WINDOW_TITLE,
    createUpdateCheckMenuItem,
} from './desktopPresentation.js';
import {
    createRuntime,
    enforceIdleAutoLock,
    enforceLaunchAutoLock,
    enforceSystemAutoLock,
    ensureHost,
    handleIpcMessage,
    installPanicModePersistence,
    tearDownHost,
    wipeRuntimeStores,
} from './runtime.js';
import { createOsNotifier } from './osNotification.js';

logConsole.attach();

const here = dirname(fileURLToPath(import.meta.url));
installProcessErrorHandlers();

// §9.3.2: the packaged renderer directory, and the whole definition of
// "our own app" for the trust predicates below. Must stay the base of the
// `win.loadFile(...)` target in createWindow: they are the same directory
// said twice, and a drift between them locks the app out of its own IPC.
const APP_ROOT = join(here, '..', 'renderer', 'dist');
// Pinch zoom may magnify but never shrink below 1: a lower floor lets
// Chromium show the page at that scale, which widens the layout viewport past
// the window so the fixed-height shell fills only part of it and the whole
// document scrolls.
const MIN_VISUAL_ZOOM_LEVEL = 1;
const MAX_VISUAL_ZOOM_LEVEL = 3;

/**
 * Sender-trust gate for the privileged IPC channels, bound to this app's
 * renderer directory. Threaded rather than global so security.js stays
 * pure; every privileged handler below calls THIS, never the raw import.
 *
 * @param {{ senderFrame?: { url?: string }, sender?: { getURL?: () => string } }} event
 * @returns {boolean}
 */
function isTrustedSender(event) {
    return isTrustedSenderEvent(event, APP_ROOT);
}

// §24.6 / G057: multi-window: instead of a singleton mainWindow, the
// main process keeps a Set of every open BrowserWindow so File → New
// Window can open additional renderers that share the same vault +
// signer state via the main-process MessageHost. Updater events go to
// every window; a deep link goes to the focused window that is not
// detached, otherwise the most-recently-created one (pickDeepLinkTarget).
const windows = /** @type {Set<BrowserWindow>} */ (new Set());
let runtime = /** @type {ReturnType<typeof createRuntime> | null} */ (null);
let windowBoundsStore = /** @type {FileWindowBoundsStore | null} */ (null);
let rememberedWindowBounds = /** @type {{ x?: number, y?: number, width: number, height: number } | null} */ (null);
let windowBoundsSaveTimer = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
let isQuitting = false;
let canCreateWindows = false;
let tray = /** @type {Tray | null} */ (null);

// The latest deep link no renderer has claimed yet (see forwardDeepLink).
const deepLinkSlot = createDeepLinkSlot();
// A warm deep link belongs to the primary window selected when it arrives.
// Pinning the webContents keeps another primary or a detached window from
// consuming the process-wide one-shot slot first.
let deepLinkRecipient = null;
// Windows opened on a pinned view (open-window), which never take a deep link.
const detachedWindows = /** @type {WeakSet<BrowserWindow>} */ (new WeakSet());
// Windows whose close is under way. Electron tears a closing window down
// after its 'close' event, and showing it in that gap (a renderer load the
// close aborted reports failure there) crashes the main process.
const closingWindows = /** @type {WeakSet<BrowserWindow>} */ (new WeakSet());

// §9.7 / G007: boot-time chain-registry sync promise. Main owns the
// network fetch (the renderer CSP pins connect-src 'self'); the verified
// descriptor batch is re-served to every renderer realm via the
// `xchain:chain-registry` IPC handler, which awaits this promise so a
// renderer that boots before the sync settles still gets the result.
/** @type {Promise<{ ok: boolean, descriptors?: object[], generatedAt?: string, reason?: string }> | null} */
let chainRegistrySync = null;

/**
 * §9.7 / G007: refresh chain descriptors from the hub's signed public
 * registry snapshot, once per launch. Same soft-enhancement contract as the
 * web + extension shells: the signature must verify against the pinned
 * federation key or nothing changes, and any failure (offline, tampered,
 * unsigned) leaves the bundled descriptors serving. The main-realm
 * defaultRegistry() singleton is the one buildRuntime() handed to the
 * SDKRegistry, so a successful apply reaches the host side immediately;
 * renderer realms pull the same verified batch via `xchain:chain-registry`.
 * Never blocks boot.
 *
 * Called only once the egress policy is in force. Kicking it at whenReady
 * sent the first request of every launch out on the direct dispatcher (real
 * IP and a local DNS lookup) ahead of the SOCKS swap. A wallet that never
 * unlocks therefore never syncs: the IPC handler below already answers
 * "registry sync not started" and the bundled descriptors keep serving.
 */
function kickChainRegistrySync() {
    if (chainRegistrySync) return;
    try {
        chainRegistrySync = registryLib
            .syncChainRegistryFromHub({ registry: registryLib.defaultRegistry() })
            .then((r) => {
                if (!r.ok) console.info('[xchain] desktop: chain-registry sync skipped');
                return r;
            })
            .catch((err) => {
                reportMainFailure('chain-registry sync', err);
                return { ok: false, reason: 'registry sync failed' };
            });
    } catch (err) {
        reportMainFailure('chain-registry sync start', err);
    }
}

// §9.3.2 navigation lockdown. Every BrowserWindow loads the local
// renderer with the preload attached, and the preload exposes the
// privileged `xchainWalletBridge.sendMessage` (unlock / send / sign over
// an auto-unlocked vault). Electron's defaults would let a renderer
// `window.open` a child window that INHERITS the preload, or navigate the
// top-level frame to a remote origin that KEEPS the preload; either puts
// the bridge in front of non-app content (the desktop analog of the
// extension's BRIDGE-1 drain). This guard, applied to every webContents
// the app ever creates, denies all `window.open` (routing http(s) links
// to the OS browser), blocks any navigation outside APP_ROOT (the
// packaged renderer directory, not merely the file:// scheme), and
// refuses `<webview>` embedding. See security.js for the pure predicates.
//
// §40.12: dedicated, non-default Electron session for the
// hosted Trezor Connect script (see trezorBridgeWindow.js, the window
// main builds on it). Created lazily on first
// pairing/sign attempt and explicitly wired to `attachHidDenial` below -
// never to `attachHidPermissions` - so `hid` is refused through every
// handler Electron offers, regardless of what origin the hosted script
// reports. A bare (non-`persist:`) partition name is in-memory only:
// nothing the hosted script does here survives a relaunch.
let trezorConnectSession = null;
function getTrezorConnectSession() {
    if (!trezorConnectSession) {
        trezorConnectSession = session.fromPartition('trezor-connect-isolated');
        attachHidDenial(trezorConnectSession);
        // The hosted script fetches from the internet, so it follows the Tor
        // routing in force instead of connecting directly.
        void applyProxyToSession(trezorConnectSession).catch((err) => reportMainFailure('trezor session proxy', err));
    }
    return trezorConnectSession;
}

// §40.12: the Trezor Connect bridge window. Main builds it itself on the
// session above, because a window.open child keeps its opener's session,
// and relays the app renderer's Connect calls to it (see
// trezorBridgeWindow.js and the xchain:trezor-bridge-* handlers below).
const trezorBridge = createTrezorBridge({
    BrowserWindow,
    getSession: getTrezorConnectSession,
    preloadPath: join(here, 'trezorBridge', 'preload.cjs'),
    documentPath: join(here, 'trezorBridge', 'connect.html'),
    devTools: !app.isPackaged,
});

function hardenWebContents(contents) {
    if (!contents || typeof contents.setWindowOpenHandler !== 'function') return;
    contents.on('context-menu', (_event, params) => {
        const template = params.isEditable
            ? [
                { role: 'cut', enabled: params.editFlags.canCut },
                { role: 'copy', enabled: params.editFlags.canCopy },
                { role: 'paste', enabled: params.editFlags.canPaste },
                { type: 'separator' },
                { role: 'selectAll', enabled: params.editFlags.canSelectAll },
            ]
            : params.selectionText
                ? [{ role: 'copy', enabled: params.editFlags.canCopy }]
                : [];
        if (template.length === 0) return;
        Menu.buildFromTemplate(template).popup({
            window: BrowserWindow.fromWebContents(contents) ?? undefined,
        });
    });
    contents.setWindowOpenHandler(({ url }) => {
        // Every window.open is denied, the Trezor Connect bridge included:
        // main builds that window itself (trezorBridgeWindow.js).
        // Open real external links in the user's browser, never in a
        // preload-bearing Electron window.
        const externalUrl = allowlistedExternalUrl(url);
        if (externalUrl) {
            void runMainTask(() => shell.openExternal(externalUrl), 'external link open');
        }
        return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
        if (shouldBlockNavigation(url, APP_ROOT)) {
            event.preventDefault();
            const externalUrl = allowlistedExternalUrl(url);
            if (externalUrl) {
                void runMainTask(() => shell.openExternal(externalUrl), 'external navigation open');
            }
        }
    });
    // A form with unsent input registers a beforeunload handler. Without this
    // listener Electron blocks the reload, the window close and the app quit
    // it guards without a word, so quitting hangs behind an open form.
    contents.on('will-prevent-unload', (event) => {
        let ignore = false;
        runMainCallback(() => {
            ignore = shouldIgnoreBeforeUnload({
                quitting: isQuitting,
                testMode: noFocusEnabled(),
                confirmLeave: () => dialog.showMessageBoxSync(BrowserWindow.fromWebContents(contents) ?? undefined, {
                    type: 'question',
                    buttons: ['Stay', 'Leave'],
                    defaultId: 0,
                    cancelId: 0,
                    title: 'Leave this page?',
                    message: 'Leave this page?',
                    detail: 'Changes you made may not be saved.',
                }) === 1,
            });
        }, 'unload guard');
        if (ignore) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => {
        // The wallet never embeds a <webview>; refuse any attempt.
        event.preventDefault();
    });
    // A <webview> is refused above and a top-level navigation is
    // refused higher up, but an <iframe> is neither, and every frame in
    // this window reports the window's own `file://` origin to the WebHID
    // device-permission handler. That handler is given no frame, so it
    // cannot tell the app's renderer from something the renderer embeds.
    // Watching for the subframe here is what lets it: the packaged
    // renderer has no iframes, so one appearing switches the HID grant off
    // for as long as this webContents lives.
    //
    // §40.12: the Trezor Connect bridge's own session (above) is
    // explicitly denied `hid` via `attachHidDenial`, so there is no
    // HID-granted session here for a subframe to poison. observeHidFrames'
    // guard is a single module-level singleton shared by every webContents
    // (permissions.js); feeding it the bridge's own legitimate internal
    // Trezor iframe would switch off Ledger HID access in the MAIN window
    // too, as a side effect of merely pairing a Trezor. Skip it for
    // exactly the bridge session.
    if (contents.session !== trezorConnectSession) {
        observeHidFrames(contents);
    }
}

function liveWindows() {
    return [...windows].filter((w) => !w.isDestroyed());
}

function windowToReveal() {
    const live = liveWindows();
    return pickDeepLinkTarget(live, BrowserWindow.getFocusedWindow(), (w) => detachedWindows.has(w))
        ?? live[live.length - 1]
        ?? null;
}

/**
 * Reveal and focus an existing window after an OS-level activation.
 *
 * @param {BrowserWindow | null} win
 * @returns {boolean}
 */
export function revealWindow(win) {
    if (!win || win.isDestroyed()) return false;
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) showWindow(win);
    focusWindow(win);
    return true;
}

function hasVisibleWindow() {
    return liveWindows().some((win) => win.isVisible());
}

/**
 * Apply the native close-button convention without interfering with an
 * explicit application quit. Only the last visible primary window hides,
 * which keeps the app in the dock or tray; any other window closes for
 * real, because a hidden one would stay alive with its renderer running
 * until quit and could later be revealed after the user dismissed it.
 *
 * @param {BrowserWindow} win
 * @param {{ preventDefault: () => void }} event
 * @param {{ platform?: string, quitting?: boolean, otherVisible?: boolean, detached?: boolean }} [options]
 * @returns {boolean} true when the close becomes a hide
 */
export function applyWindowCloseConvention(win, event, options = {}) {
    const platform = options.platform ?? process.platform;
    const quitting = options.quitting ?? isQuitting;
    if (!['darwin', 'win32', 'linux'].includes(platform) || quitting) return false;
    const otherVisible = options.otherVisible
        ?? liveWindows().some((other) => other !== win && other.isVisible());
    const detached = options.detached ?? detachedWindows.has(win);
    if (otherVisible || detached) return false;
    event.preventDefault();
    win.hide();
    return true;
}

function broadcastToWindows(channel, payload, excludedContents = null) {
    for (const w of liveWindows()) {
        if (w.webContents === excludedContents) continue;
        sendToWindow(w, channel, payload);
    }
}

function sendToWindow(win, channel, payload) {
    if (!win || win.isDestroyed() || win.webContents?.isDestroyed?.()) return false;
    try {
        win.webContents.send(channel, payload);
        return true;
    } catch {
        // A window can close after liveWindows() snapshots it. Notification
        // delivery must not turn a completed wallet operation into an error.
        return false;
    }
}

function forwardDeepLink(event) {
    // Park the link, then nudge the focused window to claim it. A renderer
    // that does not exist yet, or has not mounted its listener, claims it on
    // mount through 'xchain:deep-link-take', so a cold-start link is not lost.
    deepLinkSlot.offer(event);
    deepLinkRecipient = null;
    const live = liveWindows();
    if (live.length === 0) return;
    const target = pickDeepLinkTarget(live, BrowserWindow.getFocusedWindow(), (w) => detachedWindows.has(w));
    // Only detached windows are open: a fresh window claims the link on mount
    if (!target) {
        if (canCreateWindows) {
            // A dock or tray restore already in flight owns the next window;
            // hand the link to it instead of racing a second window open.
            const pendingRestore = reopenInFlight;
            if (!pendingRestore) {
                void runMainTask(openWindowAfterIdleCheck, 'deep-link window open');
            } else {
                void runMainTask(() => pendingRestore.then(() => {
                    const current = pickDeepLinkTarget(
                        liveWindows(),
                        BrowserWindow.getFocusedWindow(),
                        (w) => detachedWindows.has(w),
                    );
                    if (!current) return openWindowAfterIdleCheck();
                    current.webContents.send('xchain:uri', event);
                    revealWindow(current);
                    return undefined;
                }), 'deep-link window open');
            }
        }
        return;
    }
    deepLinkRecipient = target.webContents;
    if (!target.isVisible()) {
        void runMainTask(async () => {
            await restoreWindowAfterIdleCheck();
            sendToWindow(target, 'xchain:uri', event);
        }, 'deep-link window restore');
        return;
    }
    sendToWindow(target, 'xchain:uri', event);
    revealWindow(target);
}

// The real SDK, adapted once at load. The extension and the web shell start
// their registry on the dev mock and swap in the factory `resolveSdkFactory`
// returns, because a service worker must register its handlers before
// anything can be awaited. A main process has no such constraint, so it
// imports the SDK statically (as `sdkStatic.js` does for the worker) and the
// dev mock is not reachable from this shell at all. That matters here more
// than anywhere: `main/` ships in app.asar as unbundled source, so nothing
// tree-shakes a mock out of it. sdk-wiring.smoke.js walks this file's import
// graph and fails if any module in it carries the mock implementation.
//
// A missing or reshaped SDK export stops the app at startup. A wallet that
// cannot derive, sign or broadcast must not carry on against a mock that
// answers every call with plausible fake data; the other two shells enforce
// the same rule inside their resolver.
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
        // §26: restart-surviving auto-lock record. The renderer arms it via the
        // `session.autolock` message (AUTO_LOCK_REPORT_TYPE in runtime.js);
        // enforceLaunchAutoLock below reads it before the boot auto-unlock, so
        // the configured window bounds the cached key.
        autoLockStore: new FileAutoLockStore(autoLockStatePathFor(userData)),
        // The panic-mode freeze main's signers read (main/panicModeState.js).
        panicModeStore: new FilePanicModeStore(panicModeStatePathFor(userData)),
        chainRegistry,
        sdkRegistry: new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: REAL_SDK_FACTORY,
        }),
        // Apply the egress policy for the current settings. ensureHost calls
        // this the moment the vault opens (boot or password unlock), and the
        // shared host calls it after any settings.update touching `privacy`,
        // so routing takes effect on the next request, not the next launch.
        onPrivacySettingsChanged: async (settings, { sdkRegistry }) => {
            await applyTorRouting({
                settings,
                sdkRegistry,
                session: session.defaultSession,
                extraSessions: () => (trezorConnectSession ? [trezorConnectSession] : []),
                log: (m) => console.info(m),
            });
            // Routing is now in force, so the first hub request may leave.
            kickChainRegistrySync();
        },
        // §46: OS-notification adapter (main process owns the `electron`
        // import; the runtime stays Electron-free for unit testing).
        notify: createOsNotifier({ Notification, reportFailure: reportMainFailure }),
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
export function createWindow(opts = {}) {
    // A live window hands idle tracking back to its renderer's timer.
    stopWindowlessIdleLock();
    const displays = screen.getAllDisplays();
    const savedBounds = liveWindows().length > 0
        ? cascadeWindowBounds(rememberedWindowBounds, displays)
        : restoreWindowBounds(rememberedWindowBounds, displays);
    const initialBounds = savedBounds
        ?? firstLaunchWindowBounds(screen.getPrimaryDisplay().workArea);
    const win = new BrowserWindow({
        title: DESKTOP_WINDOW_TITLE,
        ...initialBounds,
        minWidth: MIN_WINDOW_BOUNDS.width,
        minHeight: MIN_WINDOW_BOUNDS.height,
        // Linux and Windows hide the File/Edit/View/Window/Help bar until
        // Alt is pressed; macOS uses the global menu bar and ignores this.
        autoHideMenuBar: process.platform !== 'darwin',
        webPreferences: {
            preload: join(here, '..', 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            zoomFactor: 1,
            // A console in the shipped wallet invites "paste this to fix
            // your wallet" scams against a page that holds unlocked keys;
            // the mobile shells ship with WebView debugging off for the
            // same reason. Unpackaged dev and test runs keep the tools.
            devTools: !app.isPackaged,
        },
        show: false,
    });
    void runMainTask(
        () => win.webContents.setVisualZoomLevelLimits(
            MIN_VISUAL_ZOOM_LEVEL,
            MAX_VISUAL_ZOOM_LEVEL,
        ),
        'window zoom limits',
    );

    // Renderer is built into packages/desktop/renderer/dist by Step 19's
    // packaging pipeline (vite build). In packaged mode that's what
    // `loadFile` points at; in dev the same path works because
    // `pnpm run start` runs vite first.
    const loadOpts = buildLoadOptions(opts);
    void runMainTask(
        () => win.loadFile(join(APP_ROOT, 'index.html'), loadOpts),
        'renderer load',
        { recover: () => { if (!win.isDestroyed() && !closingWindows.has(win)) showWindow(win); } },
    );
    win.once('ready-to-show', () => {
        runMainCallback(() => { if (!win.isDestroyed() && !closingWindows.has(win)) showWindow(win); }, 'renderer reveal');
    });
    win.on('move', () => { runMainCallback(() => rememberWindowBounds(win), 'window move'); });
    win.on('resize', () => { runMainCallback(() => rememberWindowBounds(win), 'window resize'); });
    win.on('close', (event) => {
        runMainCallback(() => {
            rememberWindowBounds(win);
            // Synchronous: on quit the process can exit before an async write
            // lands, which left window-bounds.json holding stale values.
            flushWindowBoundsSync();
            if (!applyWindowCloseConvention(win, event)) closingWindows.add(win);
            // Hidden or closing, this window no longer counts as one in use.
            // A hidden window elsewhere keeps window-all-closed from firing,
            // so the windowless idle check starts here.
            if (!isQuitting && !liveWindows().some((other) => other !== win && other.isVisible())) {
                startWindowlessIdleLock();
            }
        }, 'window close');
    });
    win.on('closed', () => { windows.delete(win); });

    windows.add(win);
    if (opts.initialView || opts.initialContext) detachedWindows.add(win);
    return win;
}

function rememberWindowBounds(win) {
    if (!win || win.isDestroyed()) return;
    const bounds = normalizeWindowBounds(win.getNormalBounds());
    if (!bounds) return;
    rememberedWindowBounds = bounds;
    if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer);
    windowBoundsSaveTimer = setTimeout(() => {
        void runMainTask(flushWindowBounds, 'window bounds save');
    }, 250);
    windowBoundsSaveTimer.unref?.();
}

async function flushWindowBounds() {
    if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer);
    windowBoundsSaveTimer = null;
    if (!windowBoundsStore || !rememberedWindowBounds) return;
    try {
        await windowBoundsStore.save(rememberedWindowBounds);
    } catch (err) {
        reportMainFailure('desktop window bounds save', err);
    }
}

// Close and quit write the bounds before returning; moves and resizes keep
// the debounced async save above.
function flushWindowBoundsSync() {
    if (windowBoundsSaveTimer) clearTimeout(windowBoundsSaveTimer);
    windowBoundsSaveTimer = null;
    if (!windowBoundsStore || !rememberedWindowBounds) return;
    try {
        windowBoundsStore.saveSync(rememberedWindowBounds);
    } catch (err) {
        reportMainFailure('desktop window bounds save', err);
    }
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

// How often the windowless idle check runs. A sleeping machine fires it on
// wake, and the check reads wall-clock time, so a lapse during sleep locks.
const WINDOWLESS_IDLE_CHECK_MS = 30 * 1000;
let windowlessIdleTimer = /** @type {ReturnType<typeof setInterval> | null} */ (null);
let reopenInFlight = /** @type {Promise<void> | null} */ (null);
let runUpdaterCheck = /** @type {null | (() => Promise<void>)} */ (null);
let updaterCheckInFlight = /** @type {Promise<void> | null} */ (null);
let updateCheckVisible = false;
// Sends that sign and then broadcast or persist; reads are never counted.
let activeSendOperations = 0;
let activeUpdateDownloads = 0;
const quitDeferral = createQuitDeferral({
    isBusy: () => activeSendOperations > 0 || activeUpdateDownloads > 0,
    quit: () => app.quit(),
});

function requestUpdateCheck({ visible = false } = {}) {
    if (!runUpdaterCheck) return Promise.resolve();
    if (visible) updateCheckVisible = true;
    if (updaterCheckInFlight) return updaterCheckInFlight;
    updaterCheckInFlight = Promise.resolve(runUpdaterCheck())
        .finally(() => {
            updaterCheckInFlight = null;
            updateCheckVisible = false;
        });
    return updaterCheckInFlight;
}

/**
 * Enforce the configured auto-lock while the app runs with no window. Only
 * then: user activity is tracked in the renderer and never reaches main, so
 * with a window open this would lock someone who is using it.
 */
function startWindowlessIdleLock() {
    if (windowlessIdleTimer) return;
    windowlessIdleTimer = setInterval(() => {
        if (!runtime || hasVisibleWindow()) return;
        void runMainTask(async () => {
            const res = await enforceIdleAutoLock(runtime);
            if (res.locked) console.info(`[xchain] auto-lock: windowless session locked (${res.reason})`);
        }, 'windowless auto-lock check');
    }, WINDOWLESS_IDLE_CHECK_MS);
    windowlessIdleTimer.unref?.();
}

// Stop the windowless check; a live window's renderer timer governs again.
function stopWindowlessIdleLock() {
    if (!windowlessIdleTimer) return;
    clearInterval(windowlessIdleTimer);
    windowlessIdleTimer = null;
}

function runWindowlessIdleGate(action, logAction) {
    if (reopenInFlight) return reopenInFlight;
    reopenInFlight = (async () => {
        try {
            if (runtime) {
                const res = await enforceIdleAutoLock(runtime);
                if (res.locked) console.info(`[xchain] auto-lock: ${logAction} window locked (${res.reason})`);
            }
        } catch (err) {
            // Cannot decide, so it costs a password prompt rather than an unlock.
            reportMainFailure(`auto-lock check before ${logAction}`, err);
            if (runtime) {
                tearDownHost(runtime);
                try { await runtime.sessionBackend.clear(); } catch { /* logged by the check */ }
            }
        }
        runMainCallback(() => { action(); }, `${logAction} window`);
    })().finally(() => { reopenInFlight = null; });
    return reopenInFlight;
}

function runSystemAutoLock(eventName) {
    if (!runtime) return Promise.resolve();
    return enforceSystemAutoLock(runtime).then((res) => {
        if (!res.locked) return;
        console.info(`[xchain] auto-lock: wallet locked on ${eventName}`);
        broadcastToWindows('xchain:state-changed', { kind: 'session' });
    });
}

/**
 * Open a window from File > New Window or for a deep link with no primary
 * window. With no window visible, the
 * idle check runs and is awaited BEFORE the renderer exists, because its
 * first message and its mount-time report both re-stamp the idle clock.
 * Two quick clicks share one check and open one window.
 *
 * @returns {Promise<void>}
 */
function openWindowAfterIdleCheck() {
    return runMainTask(() => {
        if (hasVisibleWindow()) {
            createWindow();
            return undefined;
        }
        return runWindowlessIdleGate(() => {
            if (!hasVisibleWindow()) createWindow();
        }, 'reopening');
    }, 'window open');
}

/**
 * Raise a hidden window after applying the same idle gate that guards creating a
 * window from a windowless application state.
 *
 * @returns {Promise<void>}
 */
function restoreWindowAfterIdleCheck() {
    const existing = windowToReveal();
    if (existing?.isVisible()) {
        revealWindow(existing);
        return Promise.resolve();
    }
    return runWindowlessIdleGate(() => {
        const target = windowToReveal();
        if (target) revealWindow(target);
        else createWindow();
    }, 'restoring');
}

/**
 * Keep a Windows or Linux app reachable after its last window is hidden.
 * macOS uses the dock's activate event for the same transition.
 *
 * @param {{ platform?: string }} [options]
 * @returns {Tray | null}
 */
export function installTray({ platform = process.platform } = {}) {
    if (platform === 'darwin' || tray) return tray;
    tray = new Tray(join(here, '..', 'build', 'icon.png'));
    tray.setToolTip(DESKTOP_PRODUCT_NAME);
    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: `Show ${DESKTOP_PRODUCT_NAME}`,
            click: () => { void restoreWindowAfterIdleCheck(); },
        },
        { type: 'separator' },
        { role: 'quit' },
    ]));
    tray.on('click', () => { void restoreWindowAfterIdleCheck(); });
    return tray;
}

/**
 * Reload only the focused renderer so the main-process vault, signer pool, and
 * cached session keep the same unlocked state across Cmd/Ctrl+R.
 *
 * @param {BrowserWindow | undefined} menuWindow
 * @param {boolean} [ignoreCache]
 * @returns {boolean}
 */
export function reloadRendererWindow(menuWindow, ignoreCache = false) {
    const target = menuWindow ?? BrowserWindow.getFocusedWindow();
    const contents = target?.webContents;
    if (!contents || contents.isDestroyed?.()) return false;
    if (ignoreCache) contents.reloadIgnoringCache();
    else contents.reload();
    return true;
}

/**
 * Wire the application menu. File > New Window runs the idle-lock gate;
 * direct-download builds also expose a visible update check, and every
 * platform can open the version-pinned native About panel.
 * The rest of the menu uses Electron's `role: ...` defaults so standard
 * editing / window-management behaviors stay native to each platform.
 *
 * §24.6 / G057.
 */
export function installApplicationMenu({
    isMac = process.platform === 'darwin',
} = {}) {
    const updateItem = runUpdaterCheck
        ? createUpdateCheckMenuItem(() => {
            void runMainTask(() => requestUpdateCheck({ visible: true }), 'menu update check');
        })
        : null;
    /** @type {Electron.MenuItemConstructorOptions[]} */
    const template = [
        ...(isMac ? [{
            label: DESKTOP_PRODUCT_NAME,
            submenu: [
                { role: 'about' },
                ...(updateItem ? [updateItem] : []),
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
                    accelerator: 'CmdOrCtrl+Shift+N',
                    click: () => { void openWindowAfterIdleCheck(); },
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
                {
                    label: 'Reload',
                    accelerator: 'CmdOrCtrl+R',
                    click: (_item, win) => { reloadRendererWindow(win); },
                },
                {
                    label: 'Force Reload',
                    accelerator: 'CmdOrCtrl+Shift+R',
                    click: (_item, win) => { reloadRendererWindow(win, true); },
                },
                ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
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
                ...(isMac ? [
                    { role: 'zoom' },
                    { type: 'separator' },
                    { role: 'front' },
                ] : [
                    { role: 'close' },
                ]),
            ],
        },
        ...(!isMac ? [{
            label: '&Help',
            submenu: [
                ...(updateItem ? [updateItem, { type: 'separator' }] : []),
                {
                    label: `About ${DESKTOP_PRODUCT_NAME}`,
                    click: () => app.showAboutPanel(),
                },
            ],
        }] : []),
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildApplicationMenu() {
    installApplicationMenu();
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
// Test launches only: Chromium's mock keychain, set before app ready.
applyTestMockKeychain(app);

app.on('web-contents-created', (_event, contents) => {
    runMainCallback(() => hardenWebContents(contents), 'web contents hardening');
});

const deepLinkCtx = attachDeepLinkHandlers(app, {
    onDeepLink: forwardDeepLink,
    onSecondInstance: () => {
        if (canCreateWindows) {
            void runMainTask(restoreWindowAfterIdleCheck, 'second-instance window restore');
        }
    },
    onError: (error) => reportMainFailure('deep-link handling', error),
});
if (!deepLinkCtx.gotLock) {
    // Another instance is already running. Quit cleanly; the running
    // instance will pick up our URL from `second-instance`.
    app.quit();
}

// Every renderer window, the startup-failure recovery window included, gets
// the CSP response headers, attached once per process.
let rendererCspAttached = false;
function ensureRendererCspHeaders() {
    if (rendererCspAttached) return;
    attachRendererCspHeaders(session.defaultSession.webRequest, APP_ROOT);
    rendererCspAttached = true;
}

void runMainTask(async () => {
    await app.whenReady();
    applyTestNoFocusPolicy(app);
    // Before anything in main can fetch or open a window.
    networkGuard.attachSession(session.defaultSession, 'default session');
    if (networkGuard.probe) {
        await runNetworkGuardProbeAndExit();
        return;
    }
    ensureRendererCspHeaders();

    windowBoundsStore = new FileWindowBoundsStore(windowBoundsPathFor(app.getPath('userData')));
    rememberedWindowBounds = await windowBoundsStore.load();
    runtime = buildRuntime();
    // Before any window can send a signing message: main reads the freeze
    // from its own file, never from renderer storage.
    await installPanicModePersistence(runtime);
    app.setAboutPanelOptions(DESKTOP_ABOUT_PANEL_OPTIONS);

    // Best-effort auto-unlock. Failure here is logged but doesn't block
    // startup; the renderer will see `state: 'locked'` and prompt for
    // the password.
    //
    // ensureHost owns the egress policy: it applies routing and kicks the
    // registry sync before it builds a host (a locked boot routes at unlock).
    //
    // §26: bound the cached key by the user's own auto-lock window FIRST.
    // The keychain skip-the-prompt relaunch had no upper bound, so a
    // 15-minute auto-lock and a quit still auto-unlocked weeks later. When
    // the gate locks, it clears session.bin and the ensureHost below finds
    // no key, which is the ordinary lock-screen path.
    //
    // Boot unlocks only on an explicit `locked: false`. A gate that threw
    // could not decide, so it costs a password prompt: the session is
    // cleared, which also stops the first vault-backed message reopening it.
    let bootMayUnlock = false;
    try {
        const gate = await enforceLaunchAutoLock(runtime);
        bootMayUnlock = gate.locked === false;
        if (gate.locked) console.info(`[xchain] auto-lock: relaunch locked (${gate.reason})`);
    } catch (err) {
        reportMainFailure('desktop auto-lock gate', err);
        try { await runtime.sessionBackend.clear(); } catch (clearErr) {
            reportMainFailure('cached session key clear', clearErr);
        }
    }
    if (bootMayUnlock) {
        try {
            await ensureHost(runtime);
        } catch (err) {
            reportMainFailure('desktop auto-unlock', err);
        }
    }

    powerMonitor.on('lock-screen', () => { void runSystemAutoLock('screen lock'); });
    powerMonitor.on('suspend', () => { void runSystemAutoLock('system suspend'); });

    // §40.12 / Step 18: allow WebHID access for Ledger + Trezor vendor
    // IDs so PairSignerForm can reach the device picker. Without these
    // handlers Electron returns an empty device list under
    // `contextIsolation: true`.
    attachHidPermissions(session.defaultSession, { appRoot: APP_ROOT });

    // §40.12 Step 19: claim `xchain:` unconditionally. Tier-2 coin
    // schemes (bitcoin / litecoin / dogecoin) stay unclaimed until a
    // future settings toggle opts in; we don't silently override the
    // user's primary BTC wallet.
    registerProtocolClients(app, { optedInSchemes: [] });

    // electron-updater is active only in packaged direct-download builds.
    // Events relay to every open renderer so every window can surface an
    // update offer. The launch check starts before the first window exists,
    // so the latest event is retained for a renderer that subscribes later.
    // `getState` returns the broadcast shape and keeps one rendering path.
    let lastUpdaterEvent = null;
    let downloadAndInstall = null;
    let restartAndInstall = null;
    try {
        const {
            checkForUpdates,
            downloadUpdate,
            restartAndInstall: restart,
            isActive,
        } = await attachUpdater({
            isPackaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            onEvent: (event) => {
                if (updateCheckVisible) event.userInitiated = true;
                lastUpdaterEvent = event;
                broadcastToWindows('xchain:updater', event);
            },
            canRestart: () => activeSendOperations === 0,
        });
        downloadAndInstall = downloadUpdate;
        restartAndInstall = restart;
        runUpdaterCheck = isActive ? checkForUpdates : null;

        // Kick a quiet check on launch. The menu path marks its events so
        // the renderer can show progress and an explicit up-to-date result.
        void runMainTask(requestUpdateCheck, 'launch update check');
    } catch (err) {
        reportMainFailure('updater wiring', err);
    }

    // Register these channels even when updater wiring fails. The renderer
    // can treat null as no retained offer and an ok:false action as a visible
    // failure instead of receiving Electron's raw no-handler rejection.
    ipcMain.handle('xchain:updater-state', async (event, ...args) => {
        if (!isTrustedSender(event)) return null;
        if (!hasNoIpcArguments(args)) return null;
        return lastUpdaterEvent;
    });

    ipcMain.handle('xchain:updater-install', async (event, ...args) => {
        if (!isTrustedSender(event)) {
            return { ok: false, reason: 'desktop: update install rejected from untrusted frame' };
        }
        if (args.length > 1) {
            return { ok: false, reason: 'desktop: update install takes at most one action' };
        }
        const action = args.length === 0 ? 'download' : args[0];
        if (action !== 'check' && action !== 'restart' && action !== 'download') {
            return { ok: false, reason: 'desktop: unknown update action' };
        }
        if (!downloadAndInstall || !restartAndInstall) {
            return { ok: false, reason: 'desktop: updater unavailable' };
        }
        try {
            if (action === 'check') {
                await requestUpdateCheck({ visible: true });
                return { ok: true };
            }
            if (action === 'restart') return await restartAndInstall();
            // Counted so a quit during the fetch or signature check waits
            // for the verdict instead of cutting it off.
            activeUpdateDownloads += 1;
            try {
                return await downloadAndInstall();
            } finally {
                activeUpdateDownloads -= 1;
                quitDeferral.settle();
            }
        } catch (error) {
            reportMainFailure('updater IPC action', error);
            return { ok: false, reason: 'desktop: update action failed' };
        }
    });

    ipcMain.handle(IPC_CHANNEL, async (event, message, ...extraArgs) => {
        // Sender trust boundary behind the navigation lockdown: only an app
        // frame with the documented single message envelope may dispatch.
        if (!isTrustedSender(event)) {
            return {
                ok: false,
                error: { name: 'ForbiddenSenderError', message: 'desktop: message rejected from untrusted frame' },
            };
        }
        if (extraArgs.length > 0 || !isValidDesktopIpcMessage(message)) {
            return {
                ok: false,
                error: { name: 'InvalidMessageError', message: 'desktop: invalid message envelope' },
            };
        }
        if (!runtime) {
            return {
                ok: false,
                error: { name: 'Error', message: 'desktop: runtime not initialized' },
            };
        }
        const holdsQuit = isQuitDeferringMessage(message);
        if (holdsQuit) activeSendOperations += 1;
        try {
            const response = await handleIpcMessage(runtime, message);
            const change = stateChangeForMessage(message, response);
            if (change) broadcastToWindows('xchain:state-changed', change, event.sender);
            return response;
        } catch (error) {
            reportMainFailure('wallet IPC message', error);
            return {
                ok: false,
                error: { name: 'Error', message: 'desktop: message handling failed' },
            };
        } finally {
            if (holdsQuit) {
                activeSendOperations -= 1;
                quitDeferral.settle();
            }
        }
    });

    // §24.6 / Cluster Y FOLLOWUP 4: detach a pending tx (or any
    // other view) into a fresh BrowserWindow. The renderer dispatches
    // through `xchainWalletWindow.openDetached` (preload), which
    // invokes this channel; main creates a window pre-routed via
    // search-string prefill. Validates shape so a misbehaving
    // renderer can't pass non-serializable junk.
    ipcMain.handle('xchain:open-window', async (event, args, ...extraArgs) => {
        if (!isTrustedSender(event)) {
            return { ok: false, error: 'open-window: rejected from untrusted frame' };
        }
        const route = extraArgs.length === 0 ? normalizeOpenWindowArgs(args) : null;
        if (!route) {
            return { ok: false, error: 'open-window: invalid route arguments' };
        }
        const { initialView, initialContext } = route;
        try {
            const win = createWindow({ initialView, initialContext });
            return { ok: true, windowId: win.id };
        } catch (err) {
            reportMainFailure('open-window IPC action', err);
            return { ok: false, error: 'open-window: operation failed' };
        }
    });

    // §1 / S4: screen capture protection while a screen shows key material.
    // The renderer names only on or off; the target is the sender's own window.
    ipcMain.handle('xchain:screen-protection', async (event, ...args) => {
        if (!isTrustedSender(event)) {
            return { ok: false, error: 'screen-protection: rejected from untrusted frame' };
        }
        try {
            return applyScreenProtection(event, args, {
                isTrustedSender,
                windowFor: (sender) => BrowserWindow.fromWebContents(sender),
            });
        } catch (err) {
            reportMainFailure('screen-protection IPC action', err);
            return { ok: false, error: 'screen-protection: operation failed' };
        }
    });

    // Renderer-driven wipe of the shell's own stores. The
    // renderer's wipeWalletStorage clears localStorage + IndexedDB,
    // neither of which this shell uses, so without this channel both
    // wipe paths (demo exit, Locked "forgot password") are silent
    // no-ops and the user is handed an unlock screen for the vault
    // they just destroyed. Same trusted-sender gate as every other
    // channel: a remote frame cannot nuke someone's wallet.
    ipcMain.handle('xchain:wipe-storage', async (event, ...args) => {
        if (!isTrustedSender(event)) {
            return { ok: false, error: 'wipe-storage: rejected from untrusted frame' };
        }
        if (!hasNoIpcArguments(args)) {
            return { ok: false, error: 'wipe-storage: takes no arguments' };
        }
        if (!runtime) {
            return { ok: false, error: 'wipe-storage: runtime not initialized' };
        }
        try {
            const result = await wipeRuntimeStores(runtime);
            // The host is torn down before any store is touched, so every
            // other window re-reads its session whatever the stores did;
            // otherwise a sibling keeps showing an unlocked wallet with no host.
            broadcastToWindows('xchain:state-changed', { kind: 'session' }, event.sender);
            if (result.ok) {
                return { ok: true, cleared: result.cleared };
            }
            return {
                ok: false,
                cleared: result.cleared,
                error: result.errors.map((e) => `${e.store}: ${e.message}`).join('; '),
            };
        } catch (err) {
            reportMainFailure('wipe-storage IPC action', err);
            return { ok: false, error: 'wipe-storage: operation failed' };
        }
    });

    // Save an encrypted backup through the native dialog. The renderer hands
    // the file and a suggested name; main picks nothing itself and answers
    // with the written path or "not saved", which is what lets the backup
    // reminder clear only for a file that exists. Same trusted-sender gate.
    ipcMain.handle('xchain:save-backup', async (event, ...args) => {
        if (!isTrustedSender(event)) {
            return { ok: false, error: 'save-backup: rejected from untrusted frame' };
        }
        if (args.length !== 1) {
            return { ok: false, error: 'save-backup: expected one argument' };
        }
        try {
            return await saveBackupFile(args[0], {
                dialog,
                writeFile: writeFileAsync,
                window: BrowserWindow.fromWebContents(event.sender) ?? undefined,
                defaultDir: app.getPath('documents'),
            });
        } catch (err) {
            reportMainFailure('save-backup IPC action', err);
            return { ok: false, error: 'save-backup: the file could not be written' };
        }
    });

    // §9.7 / G007: hand the verified registry batch to renderer realms.
    // Awaits the boot sync so early callers don't race it; a failed or
    // skipped sync resolves { ok: false } and the renderer keeps its
    // bundled descriptors. Descriptors are already signature-verified
    // and schema-validated here in main; the renderer still re-validates
    // inside applyRemoteDescriptors.
    ipcMain.handle('xchain:chain-registry', async (event, ...args) => {
        if (!isTrustedSender(event)) {
            return { ok: false, reason: 'chain-registry: rejected from untrusted frame' };
        }
        if (!hasNoIpcArguments(args)) {
            return { ok: false, reason: 'chain-registry: takes no arguments' };
        }
        if (!chainRegistrySync) return { ok: false, reason: 'registry sync not started' };
        try {
            const r = await chainRegistrySync;
            return r.ok
                ? { ok: true, descriptors: r.descriptors, generatedAt: r.generatedAt }
                : { ok: false, reason: r.reason };
        } catch (error) {
            reportMainFailure('chain-registry IPC action', error);
            return { ok: false, reason: 'registry sync failed' };
        }
    });

    // §40.12: the app renderer's half of the Trezor Connect relay. Only the
    // app's own frames may drive the bridge window; trezorBridge checks the
    // call against the Connect methods the signer uses and always answers
    // with an envelope.
    ipcMain.handle('xchain:trezor-bridge-call', async (event, message, ...extraArgs) => {
        if (!isTrustedSender(event)) {
            return { ok: false, error: 'trezor-bridge: rejected from untrusted frame' };
        }
        if (extraArgs.length !== 0) return { ok: false, error: 'trezor-bridge: takes one message' };
        try {
            return await trezorBridge.call(message);
        } catch (error) {
            reportMainFailure('trezor-bridge IPC action', error);
            return { ok: false, error: 'trezor-bridge: operation failed' };
        }
    });

    ipcMain.handle('xchain:trezor-bridge-close', async (event, ...args) => {
        if (!isTrustedSender(event)) return { ok: false };
        if (!hasNoIpcArguments(args)) return { ok: false };
        return trezorBridge.close();
    });

    // Hand the parked deep link to its selected primary renderer once. Same
    // trust boundary as the other handlers: a remote or detached frame gets
    // nothing, and a sibling cannot consume a link nudged to another window.
    ipcMain.handle('xchain:deep-link-take', async (event, ...args) => {
        if (!isTrustedSender(event)) return null;
        if (!hasNoIpcArguments(args)) return null;
        try {
            const senderWindow = BrowserWindow.fromWebContents(event.sender);
            if (!senderWindow || !windows.has(senderWindow) || detachedWindows.has(senderWindow)) return null;
            if (deepLinkRecipient?.isDestroyed?.()) deepLinkRecipient = null;
            if (deepLinkRecipient && deepLinkRecipient !== event.sender) return null;
            const pending = deepLinkSlot.take();
            deepLinkRecipient = null;
            return pending;
        } catch (error) {
            reportMainFailure('deep-link IPC action', error);
            return null;
        }
    });

    // Wire the signer-bridge ipc listener so renderer-hosted HW
    // signers (paired via PairSignerForm) become reachable from the
    // main-process MessageHost. `action.*.hw` handlers consult the
    // same process-wide `signerBridge` registry this listener feeds.
    attachSignerBridgeListener({ ipcMain, isTrustedSender });

    // §24.6 / G057: install the application menu (File → New Window)
    // before opening the primary window so the accelerator is live the
    // moment the renderer focuses.
    buildApplicationMenu();
    canCreateWindows = true;
    installTray();
    createWindow();

    app.on('activate', () => {
        void runMainTask(() => restoreWindowAfterIdleCheck(), 'activation window restore');
    });
}, 'desktop startup', {
    recover: () => {
        networkGuard.attachSession(session.defaultSession, 'default session');
        if (networkGuard.probe) {
            app.exit(1);
            return;
        }
        ensureRendererCspHeaders();
        canCreateWindows = true;
        if (liveWindows().length === 0) createWindow();
    },
});

app.on('window-all-closed', () => {
    runMainCallback(() => {
        // Keep the vault alive for dock, tray, or second-instance reopening.
        startWindowlessIdleLock();
    }, 'all windows closed');
});

app.on('before-quit', (event) => {
    // A send can be between signing and persistence, and an update download
    // can be between its network fetch and signature verdict. Hold the quit
    // until that work settles or the deadline passes, then quit on our own;
    // a repeated quit request or SIGTERM during the wait rides the same
    // clock, so quit always completes.
    const deferral = quitDeferral.request();
    if (deferral) {
        event?.preventDefault();
        if (deferral === 'defer') void restoreWindowAfterIdleCheck();
        return;
    }
    // Zero the master key + close the encrypted doc. The OS already
    // treats process-exit memory as freed, but explicit zeroing catches
    // cases where a GC'd buffer might otherwise linger until
    // reallocation. The session-backend ciphertext stays on disk; the
    // next launch reuses it via the keychain.
    runMainCallback(() => {
        isQuitting = true;
        stopWindowlessIdleLock();
        flushWindowBoundsSync();
        tray?.destroy();
        tray = null;
        if (runtime) tearDownHost(runtime);
    }, 'desktop shutdown');
});
