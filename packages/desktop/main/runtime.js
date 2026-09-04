// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Desktop main-process runtime: everything that isn't Electron-specific.
//
// Splitting this out of `index.js` lets the IPC dispatch + auto-unlock
// path be unit-tested under plain Node (no `electron` import). `index.js`
// imports this module, injects the real Electron deps (`app`,
// `safeStorage`, `ipcMain`, `BrowserWindow`), and glues the lifecycle
// events together.
//
// The runtime is a single mutable object carrying:
//
//   - Three backends (storage/session/meta) that live for the whole
//     app lifecycle. The session backend is OS-keychain-backed and
//     survives app restarts; the others are file-backed under
//     `app.getPath('userData')`.
//   - A ChainRegistry + SDKRegistry (static for the whole lifecycle).
//   - A Vault + MessageHost that come and go with lock/unlock.
//
// State transitions:
//
//   startup → ensureHost():
//     - No cached session key → host stays null, state = 'locked'
//       (or 'no-wallet' if meta has no kdfParams). Renderer drives
//       `wallet.unlock` (or `wallet.create`/`wallet.import`) via the
//       pre-host pipeline to build the host.
//     - Cached session key present → open vault, build host, state =
//       'unlocked'. Renderer sees no lock screen.
//
//   `wallet.unlock` / `wallet.create` / `wallet.import` → on success,
//     the pre-host handlers persist the master key via
//     `sessionBackend.save` and fire `onUnlocked`, which re-runs
//     ensureHost to bring the vault online.
//
//   `wallet.lock` → pre-host handler clears the session backend and
//     fires `onLocked`, which tears down the host + closes the vault.
//
//   Any non-pre-host message when the host is null returns
//     `WalletLockedError` in the standard envelope.

// Cross-package relative paths: the pnpm workspace symlink makes the
// `@xchain-wallet/*` specifiers work at build time, but the core smoke
// harness runs files via Node directly (no workspace setup) and
// resolves these paths instead. Same convention as messageHost.js.
import {
    storage as storageLib,
    flows as flowsLib,
    notifications as notificationsLib,
    signers as signersLib,
} from '@xchain-wallet/core';
import {
    dispatchPreHost,
    PRE_HOST_MESSAGE_TYPES,
} from '@xchain-wallet/extension/src/background/sessionMeta.js';
import { serializeError } from '@xchain-wallet/extension/src/background/MessageHost.js';
// The pure idle decision, shared with the extension backstop so the two
// shells cannot drift on what "idle" means.
import { shouldAutoLock } from '@xchain-wallet/extension/src/background/autoLockState.js';

import { createDesktopMessageHost } from './messageHost.js';
import { applyAutoLockReport, stampAutoLockActivity } from './autoLockState.js';

/**
 * Renderer-sent type that arms/disarms the auto-lock backstop. The SAME
 * string the extension popup sends, because `useAutoLockPolicy` is shared
 * and the messaging barrels are pinned to one wire name per helper
 * (test/unit/shells/messagingBarrelContract.test.js).
 */
export const AUTO_LOCK_REPORT_TYPE = 'session.autolock';

/**
 * @typedef {Object} DesktopRuntimeDeps
 * @property {{ load: () => Promise<Uint8Array | null>, save: (blob: Uint8Array) => Promise<void>, clear: () => Promise<void> }} storageBackend
 * @property {{ load: () => Promise<Uint8Array | null>, save: (blob: Uint8Array) => Promise<void>, clear: () => Promise<void> }} sessionBackend
 * @property {{ load: () => Promise<unknown | null>, save: (obj: unknown) => Promise<void>, clear: () => Promise<void> }} metaBackend
 * @property {{ load: () => Promise<unknown | null>, save: (s: object) => Promise<void>, clear: () => Promise<void> }} [autoLockStore]
 *        §26: restart-surviving auto-lock record (main/autoLockState.js).
 *        Without it the launch gate is inert and a quit-then-relaunch
 *        auto-unlocks with no regard for `autolockMinutes`.
 * @property {import('@xchain-wallet/core').registry.ChainRegistry} chainRegistry
 * @property {import('@xchain-wallet/core').sdk.SDKRegistry} sdkRegistry
 * @property {() => Promise<{env?: object, build?: object}>} [getDiagnosticContext]
 *        §50 / Cluster L FOLLOWUP 4: supplied by main/index.js so the
 *        diagnostic dump records electron version + OS + walletVersion.
 * @property {(settings: object, ctx: { sdkRegistry: object }) => Promise<void>} [onPrivacySettingsChanged]
 *        Applies the egress policy (Tor routing) for the given settings.
 *        Injected by main/index.js, which owns the `electron` import.
 * @property {(n: { kind: string, title: string, body: string }) => void} [notify]
 *        §46: OS-notification adapter, injected by main/index.js (which
 *        owns the `electron` import). When absent (unit tests / headless),
 *        the notification watcher is not started.
 *
 * @typedef {DesktopRuntimeDeps & {
 *   vault: import('@xchain-wallet/core').storage.Vault | null,
 *   host: ReturnType<typeof createDesktopMessageHost> | null,
 *   notificationService: import('@xchain-wallet/core').notifications.NotificationService | null,
 *   priceAlertWatcher: import('@xchain-wallet/core').notifications.PriceAlertWatcher | null,
 *   governancePollWatcher: import('@xchain-wallet/core').notifications.GovernancePollWatcher | null,
 *   deadlineWatcher: import('@xchain-wallet/core').notifications.DeadlineWatcher | null,
 *   dispenserEscrowWatcher: import('@xchain-wallet/core').notifications.DispenserEscrowWatcher | null,
 *   coinpayAutopayWatcher: import('@xchain-wallet/core').notifications.CoinpayAutopayWatcher | null,
 *   signerPool: import('@xchain-wallet/core').signers.SignerPool,
 * }} DesktopRuntime
 */

/**
 * @param {DesktopRuntimeDeps} deps
 * @returns {DesktopRuntime}
 */
export function createRuntime(deps) {
    if (!deps?.storageBackend) throw new Error('createRuntime: storageBackend is required');
    if (!deps?.sessionBackend) throw new Error('createRuntime: sessionBackend is required');
    if (!deps?.metaBackend) throw new Error('createRuntime: metaBackend is required');
    if (!deps?.chainRegistry) throw new Error('createRuntime: chainRegistry is required');
    if (!deps?.sdkRegistry) throw new Error('createRuntime: sdkRegistry is required');
    return {
        storageBackend: deps.storageBackend,
        sessionBackend: deps.sessionBackend,
        metaBackend: deps.metaBackend,
        // Optional file-backed unlock-attempt throttle (§26). When present,
        // handleWalletUnlock enforces the same pre-KDF lockout the extension
        // ships; when absent (older callers / tests) unlock is un-throttled.
        unlockThrottleStore: deps.unlockThrottleStore || null,
        // §26: restart-surviving auto-lock record. Optional for the same
        // reason as the throttle store (older callers and unit tests build
        // runtimes without one); when absent, enforceLaunchAutoLock is a
        // no-op and the shell behaves exactly as it did before.
        autoLockStore: deps.autoLockStore || null,
        chainRegistry: deps.chainRegistry,
        sdkRegistry: deps.sdkRegistry,
        getDiagnosticContext: deps.getDiagnosticContext,
        // Egress-policy applier, kept optional: unit tests and headless
        // callers build runtimes without it and must still get a host.
        onPrivacySettingsChanged: deps.onPrivacySettingsChanged || null,
        notify: deps.notify || null,
        vault: null,
        host: null,
        notificationService: null,
        priceAlertWatcher: null,
        governancePollWatcher: null,
        deadlineWatcher: null,
        dispenserEscrowWatcher: null,
        coinpayAutopayWatcher: null,
        // PC-16: pre-unlocked software signers, populated by the shared
        // wallet.unlock handler while the password is in scope (wallet
        // seeds have their own per-wallet KDF, so the keychain-cached
        // master key alone cannot sign). A keychain auto-unlock leaves
        // this pool empty: the wallet works with per-op passwords and
        // auto-pay stays disarmed until one password unlock arms it.
        signerPool: new signersLib.SignerPool(),
    };
}

/**
 * Enforce the user's configured auto-lock across a QUIT, once per launch.
 *
 * `session.bin` is deliberately left on disk at `before-quit` so a relaunch
 * skips the password prompt (§40.12). Nothing consulted `autolockMinutes`
 * on that path, so the skip had no upper bound: quit with a 15-minute
 * auto-lock set, come back a month later, and the vault opened itself.
 * This is the missing bound. Call it ONCE at app-ready, before the boot
 * `ensureHost`; when it clears the session backend, that ensureHost finds
 * no key and the renderer gets the lock screen.
 *
 * Fails CLOSED on a missing or unreadable record, which is also what
 * covers the crash and kill paths that never wrote a stamp: the cost of
 * being wrong is one password prompt, and the cost the other way is an
 * unlocked wallet the user believed had locked itself.
 *
 * Deliberately NOT folded into `ensureHost`. That function is also called
 * straight after a password unlock (`onUnlocked`), where the record can
 * legitimately be absent for a tick; refusing there would clear the key
 * the user had just authenticated and leave the UI claiming an unlock that
 * had been undone. The gate belongs on the launch path only, which is the
 * only path the finding is about.
 *
 * @param {DesktopRuntime} runtime
 * @param {number} [now]
 * @returns {Promise<{ locked: boolean, reason: string }>}
 */
export async function enforceLaunchAutoLock(runtime, now = Date.now()) {
    const store = runtime?.autoLockStore;
    if (!store) return { locked: false, reason: 'no-store' };
    // Nothing persisted means nothing to enforce: a shell with no cached
    // key already lands on the unlock screen, and clearing an empty
    // session backend would only churn the disk.
    let hasPersistedKey = false;
    try {
        hasPersistedKey = (await runtime.sessionBackend.load()) != null;
    } catch {
        hasPersistedKey = false;
    }
    if (!hasPersistedKey) return { locked: false, reason: 'no-session' };

    let state = null;
    try { state = await store.load(); } catch { state = null; }

    let reason = '';
    if (!state) reason = 'no-record';
    else if (state.armed !== true) reason = 'disarmed';   // the user chose Never, or a demo wallet
    else if (shouldAutoLock(state, now)) reason = 'idle-window-elapsed';

    if (reason === 'disarmed') return { locked: false, reason };
    if (reason === '') return { locked: false, reason: 'within-window' };

    // Drop the cached key AND the stale record together: leaving the
    // record would let the next launch read a stamp that no longer
    // describes any session.
    try { await runtime.sessionBackend.clear(); } catch (err) {
        console.error('[xchain] auto-lock could not clear the cached session key:', err);
    }
    try { await store.clear(); } catch { /* best-effort */ }
    return { locked: true, reason };
}

/**
 * Build the Vault + MessageHost from the cached session master key, if
 * one is present. Idempotent: returns the existing host if already
 * built. Returns null when no cached key exists (locked state).
 *
 * @param {DesktopRuntime} runtime
 */
export async function ensureHost(runtime) {
    if (runtime.host) return runtime.host;

    const masterKey = await runtime.sessionBackend.load();
    if (!masterKey) return null;

    const vault = new storageLib.Vault({
        backend: runtime.storageBackend,
        masterKey,
    });
    try {
        await vault.open();
        runtime.vault = vault;

        // Apply the egress policy before the host or any watcher can reach
        // the network (both boot and the `onUnlocked` path land here).
        if (runtime.onPrivacySettingsChanged) {
            try {
                const settings = await flowsLib.getSettings(vault);
                await runtime.onPrivacySettingsChanged(settings, { sdkRegistry: runtime.sdkRegistry });
            } catch (err) {
                // Loud, not fatal: this failing means traffic leaves
                // direct while the UI claims the toggle is on.
                console.error('[xchain] egress policy not applied at unlock:', err);
            }
        }

        runtime.host = createDesktopMessageHost({
            vault,
            chainRegistry: runtime.chainRegistry,
            sdkRegistry: runtime.sdkRegistry,
            signerPool: runtime.signerPool,
            getDiagnosticContext: runtime.getDiagnosticContext,
            // Re-applies routing on any settings.update touching `privacy`,
            // so the toggle takes effect on the next request.
            onPrivacySettingsChanged: runtime.onPrivacySettingsChanged,
        });

        // §46: start the live notification watcher. main/index.js injects the
        // electron.Notification adapter; without it (unit tests) we skip.
        if (runtime.notify && !runtime.notificationService) {
            runtime.notificationService = new notificationsLib.NotificationService({
                getActiveAddresses: async () => {
                    const settings = await flowsLib.getSettings(vault);
                    return notificationsLib.getActiveAddresses(vault, runtime.chainRegistry, {
                        activeNetwork: settings.activeNetwork,
                    });
                },
                getSdkForChain: (chainId) => runtime.sdkRegistry.get(chainId),
                getSettings: () => flowsLib.getSettings(vault),
                notify: runtime.notify,
                getPendingTxids: () => notificationsLib.getBroadcastTxids(vault),
                onTxConfirmed: (txid) => notificationsLib.markPendingTxIndexed(vault, txid),
                onMempoolSeen: (txid) => notificationsLib.markPendingTxMempoolSeen(vault, txid),
                logger: console,
            });
            runtime.notificationService.start().catch((err) => {
                console.error('[xchain] notification watcher start failed:', err);
            });
        }

        // §46 price-alert poll watcher: same lifecycle + adapter as above.
        if (runtime.notify && !runtime.priceAlertWatcher && typeof globalThis.fetch === 'function') {
            const priceOracle = flowsLib.createPriceOracle({ fetch: globalThis.fetch.bind(globalThis) });
            runtime.priceAlertWatcher = new notificationsLib.PriceAlertWatcher({
                getNativePrices: ({ chainIds, fiatCurrency }) => priceOracle.getNativePrices({ chainIds, fiatCurrency }),
                listArmedAlerts: () => vault.priceAlerts.list(),
                getSettings: () => flowsLib.getSettings(vault),
                notify: runtime.notify,
                markTriggered: (id) => flowsLib.markAlertTriggered({ vault, id }),
                logger: console,
            });
            runtime.priceAlertWatcher.start();
        }

        // §46 governance-poll watcher (new VOTE poll over a held token,
        // binding polls flagged). Same lifecycle + adapter as above. Seen-state
        // is in-memory (re-baselines per unlock); persisting it via metaBackend
        // is a follow-up if restart-gap notifications prove wanted here.
        if (runtime.notify && !runtime.governancePollWatcher) {
            runtime.governancePollWatcher = new notificationsLib.GovernancePollWatcher({
                getActiveAddresses: async () => {
                    const settings = await flowsLib.getSettings(vault);
                    return notificationsLib.getActiveAddresses(vault, runtime.chainRegistry, {
                        activeNetwork: settings.activeNetwork,
                    });
                },
                getSdkForChain: (chainId) => runtime.sdkRegistry.get(chainId),
                getSettings: () => flowsLib.getSettings(vault),
                notify: runtime.notify,
                logger: console,
            });
            runtime.governancePollWatcher.start();
        }

        // PC-45 deadline watcher (my orders/swaps/dispensers nearing
        // EXPIRATION, polls I created or voted in nearing their close block).
        // Seen-state is in-memory here for the same reason as above.
        // COINPAY obligations (PC-15) and unstake cooldowns (PC-47) keep their
        // own timers; this deep-links rather than duplicating them.
        if (runtime.notify && !runtime.deadlineWatcher) {
            runtime.deadlineWatcher = new notificationsLib.DeadlineWatcher({
                getActiveAddresses: async () => {
                    const settings = await flowsLib.getSettings(vault);
                    return notificationsLib.getActiveAddresses(vault, runtime.chainRegistry, {
                        activeNetwork: settings.activeNetwork,
                    });
                },
                getSdkForChain: (chainId) => runtime.sdkRegistry.get(chainId),
                getSettings: () => flowsLib.getSettings(vault),
                coinForChain: (chainId) => runtime.chainRegistry.get(chainId)?.coin || null,
                notify: runtime.notify,
                logger: console,
            });
            runtime.deadlineWatcher.start();
        }

        // PC-46 low-escrow alert. Auto-refill deferred (no per-event consent);
        // deep-links to PC-19's refill stage.
        if (runtime.notify && !runtime.dispenserEscrowWatcher) {
            runtime.dispenserEscrowWatcher = new notificationsLib.DispenserEscrowWatcher({
                getActiveAddresses: async () => {
                    const settings = await flowsLib.getSettings(vault);
                    return notificationsLib.getActiveAddresses(vault, runtime.chainRegistry, {
                        activeNetwork: settings.activeNetwork,
                    });
                },
                getSdkForChain: (chainId) => runtime.sdkRegistry.get(chainId),
                getSettings: () => flowsLib.getSettings(vault),
                notify: runtime.notify,
                logger: console,
            });
            runtime.dispenserEscrowWatcher.start();
        }

        // PC-16 CoinPay auto-pay engine. Desktop main is the spec's best
        // fire-and-forget home (tray-capable, no worker eviction). Pays
        // only when the signer pool holds the wallet's signer, i.e. after
        // a password unlock; a keychain-only session is notify-only with
        // the ObligationsView banner explaining how to arm.
        if (runtime.notify && !runtime.coinpayAutopayWatcher) {
            runtime.coinpayAutopayWatcher = new notificationsLib.CoinpayAutopayWatcher({
                vault,
                sdkRegistry: runtime.sdkRegistry,
                chainRegistry: runtime.chainRegistry,
                getSigner: (walletId) => runtime.signerPool.get(walletId),
                reservationLedger: runtime.host.host.reservationLedger,
                notify: runtime.notify,
                shellKind: 'desktop',
                logger: console,
            });
            runtime.coinpayAutopayWatcher.start();
            runtime.coinpayAutopayWatcher.refresh().catch(() => { /* WS triggers are best-effort */ });
        }

        return runtime.host;
    } catch (err) {
        // Cached key doesn't decrypt the vault. Most likely the user
        // reset the wallet, or the vault file was replaced by a
        // different install. Close the vault (zeros its key copy) and
        // clear the stale session so the renderer sees a clean
        // locked / no-wallet state and can drive unlock or onboarding.
        try { vault.close(); } catch (_err) { /* already closed */ }
        try { await runtime.sessionBackend.clear(); } catch (_err) { /* best-effort */ }
        runtime.vault = null;
        runtime.host = null;
        throw err;
    } finally {
        masterKey.fill(0);
    }
}

/**
 * Close the vault + drop the host. Used by the `wallet.lock` pre-host
 * callback and by app-before-quit. Safe to call when already torn down.
 *
 * @param {DesktopRuntime} runtime
 */
export function tearDownHost(runtime) {
    if (runtime.notificationService) {
        try { runtime.notificationService.stop(); } catch (_err) { /* best-effort */ }
        runtime.notificationService = null;
    }
    if (runtime.priceAlertWatcher) {
        try { runtime.priceAlertWatcher.stop(); } catch (_err) { /* best-effort */ }
        runtime.priceAlertWatcher = null;
    }
    if (runtime.governancePollWatcher) {
        try { runtime.governancePollWatcher.stop(); } catch (_err) { /* best-effort */ }
        runtime.governancePollWatcher = null;
    }
    if (runtime.deadlineWatcher) {
        try { runtime.deadlineWatcher.stop(); } catch (_err) { /* best-effort */ }
        runtime.deadlineWatcher = null;
    }
    if (runtime.dispenserEscrowWatcher) {
        try { runtime.dispenserEscrowWatcher.stop(); } catch (_err) { /* best-effort */ }
        runtime.dispenserEscrowWatcher = null;
    }
    if (runtime.coinpayAutopayWatcher) {
        try { runtime.coinpayAutopayWatcher.stop(); } catch (_err) { /* best-effort */ }
        runtime.coinpayAutopayWatcher = null;
    }
    if (runtime.signerPool) {
        try { runtime.signerPool.lockAll(); } catch (_err) { /* best-effort */ }
        runtime.signerPool = new signersLib.SignerPool();
    }
    if (runtime.vault) {
        try { runtime.vault.close(); } catch (_err) { /* already closed */ }
        runtime.vault = null;
    }
    runtime.host = null;
}

/**
 * @typedef {Object} WipeResult
 * @property {boolean} ok                              every store with a backend was cleared
 * @property {string[]} cleared                        store names that were cleared
 * @property {{ store: string, message: string }[]} errors
 */

/**
 * Clear every wallet store the desktop shell owns, so a wipe
 * from the renderer actually lands.
 *
 * The renderer's `wipeWalletStorage` can only reach localStorage and
 * IndexedDB, neither of which the desktop shell uses. Its four stores
 * are files under `app.getPath('userData')`, reachable only from main:
 *
 *   - storage        `vault.bin`            encrypted vault document
 *   - meta           `meta.json`            kdfParams: the "a wallet
 *                                           already exists" signal that
 *                                           decides unlock vs onboarding
 *   - session        cached session key     an auto-unlock into a vault
 *                                           that no longer exists
 *   - unlockThrottle attempt counters       a lockout inherited by the
 *                                           *next* wallet, punishing the
 *                                           user for the old one's typos
 *
 * The throttle is cleared deliberately. It exists to slow password
 * guessing against a vault; once that vault is gone there is nothing
 * left to guess at, and a caller who wipes to escape a lockout has
 * destroyed the very thing they wanted to break into.
 *
 * The in-memory host is torn down FIRST so no watcher or autosave can
 * write a store back after it was unlinked.
 *
 * Per-store failures are collected rather than thrown so one unwritable
 * file cannot leave the other three behind; the caller reports `ok`.
 *
 * @param {DesktopRuntime} runtime
 * @returns {Promise<WipeResult>}
 */
export async function wipeRuntimeStores(runtime) {
    if (!runtime) throw new Error('wipeRuntimeStores: runtime is required');
    tearDownHost(runtime);

    /** @type {string[]} */
    const cleared = [];
    /** @type {{ store: string, message: string }[]} */
    const errors = [];
    const targets = [
        ['storage', runtime.storageBackend],
        ['meta', runtime.metaBackend],
        ['session', runtime.sessionBackend],
        ['unlockThrottle', runtime.unlockThrottleStore],
        // The auto-lock stamp describes a session that no longer exists
        // after a wipe; carrying it into the next wallet would hand that
        // wallet somebody else's idle clock.
        ['autoLock', runtime.autoLockStore],
    ];
    for (const [name, backend] of targets) {
        if (!backend || typeof backend.clear !== 'function') continue;
        try {
            await backend.clear();
            cleared.push(name);
        } catch (err) {
            errors.push({ store: name, message: String(err?.message ?? err) });
        }
    }
    return { ok: errors.length === 0, cleared, errors };
}

/**
 * Route an IPC message to the pre-host dispatcher or the MessageHost,
 * returning the standard `{ ok, result } | { ok, error }` envelope.
 *
 * @param {DesktopRuntime} runtime
 * @param {{ type?: unknown, request?: unknown }} message
 */
export async function handleIpcMessage(runtime, message) {
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        return errorEnvelope(Object.assign(
            new Error('desktop: message.type is required'),
            { name: 'InvalidMessageError' },
        ));
    }

    try {
        // §26 auto-lock, taken BEFORE both lanes on purpose.
        //
        // Not in PRE_HOST_MESSAGE_TYPES because that set and its dispatcher
        // are shared with the extension shell, and this handling is
        // desktop-specific. Ahead of the host lane because the shared
        // `createBackgroundHost` registers `session.autolock` against the
        // extension's chrome.storage record, which on desktop writes to a
        // `chrome` that does not exist and silently does nothing; and
        // because a DISARM has to land while the vault is closed, which
        // the host lane cannot serve.
        if (message.type === AUTO_LOCK_REPORT_TYPE) {
            await applyAutoLockReport(runtime.autoLockStore, message.request, Date.now());
            return { ok: true, result: { armed: message.request?.armed === true } };
        }
        // Every other message is renderer activity, and the idle clock has
        // to advance from it or a user who is actively using the app would
        // come back to a locked wallet. Throttled inside the helper.
        stampAutoLockActivity(runtime.autoLockStore, Date.now())
            .catch(() => { /* best-effort; never blocks the message */ });

        if (PRE_HOST_MESSAGE_TYPES.has(message.type)) {
            const result = await dispatchPreHost(message.type, message.request, {
                storageBackend: runtime.storageBackend,
                sessionBackend: runtime.sessionBackend,
                metaBackend: runtime.metaBackend,
                unlockThrottleStore: runtime.unlockThrottleStore,
                chainRegistry: runtime.chainRegistry,
                sdkRegistry: runtime.sdkRegistry,
                // PC-16: populate the desktop signer pool while the typed
                // password is in scope, arming auto-pay for the session.
                signerPool: runtime.signerPool,
                onUnlocked: async () => {
                    try { await ensureHost(runtime); } catch (err) {
                        // Logged but not thrown: the unlock itself
                        // succeeded; the host-build failure will
                        // resurface on the next message if it's real.
                        console.error('[xchain] ensureHost after unlock failed:', err);
                    }
                },
                onLocked: () => {
                    tearDownHost(runtime);
                    // An explicit lock ends the window the stamp described.
                    runtime.autoLockStore?.clear().catch(() => { /* best-effort */ });
                },
            });
            return { ok: true, result };
        }

        const host = runtime.host ?? await ensureHost(runtime);
        if (!host) {
            return errorEnvelope(Object.assign(
                new Error('Wallet is locked. Unlock before calling vault-backed handlers.'),
                { name: 'WalletLockedError' },
            ));
        }
        return await host.handle({ type: message.type, request: message.request });
    } catch (err) {
        return errorEnvelope(err);
    }
}

// The host lane's serializer, not a second hand-rolled envelope: it carries
// `code` and the THROTTLED hints (retryAfterMs / burst / windowMs) that every
// renderer transport rebuilds, and `UnlockThrottledError` sets retryAfterMs on
// the pre-host lane this file dispatches.
function errorEnvelope(err) {
    return serializeError(err);
}
