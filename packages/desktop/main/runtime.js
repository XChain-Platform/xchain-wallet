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
    registry as registryLib,
    signers as signersLib,
} from '@xchain-wallet/core';
import {
    dispatchPreHost,
    hasSessionKey,
    PRE_HOST_MESSAGE_TYPES,
} from '@xchain-wallet/extension/src/background/sessionMeta.js';
import { serializeError } from '@xchain-wallet/extension/src/background/MessageHost.js';
import { createLockedAutopay } from '@xchain-wallet/core/notifications/index.js';
// The pure idle decision, shared with the extension backstop so the two
// shells cannot drift on what "idle" means.
import {
    AUTO_LOCK_UNSAVED,
    shouldAutoLock,
} from '@xchain-wallet/extension/src/background/autoLockState.js';
import { createBroadcastQueueStore, sealBroadcastQueueStore } from '@xchain-wallet/extension/src/background/broadcastQueueStore.js';
import { createBroadcastQueueStorage } from '@xchain-wallet/extension/src/background/broadcastQueueStorage.js';
import { restoreLabelSyncBestEffort } from '@xchain-wallet/extension/src/background/walletCreate.js';
import { startLabelSyncRestoreTask } from '@xchain-wallet/extension/src/background/labelSyncRestoreTasks.js';
import { createVaultKeyring } from '@xchain-wallet/extension/src/background/vaultKeyring.js';

import { createDesktopMessageHost } from './messageHost.js';
import { applyAutoLockReport, armProvisionalAutoLock, hasEnforceableWindow, stampAutoLockActivity } from './autoLockState.js';
import { handlePanicStateMessage, PANIC_STATE_MESSAGE_TYPES } from './panicModeState.js';

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
 * @property {{ load: () => Promise<unknown | null>, save: (s: unknown) => Promise<void>, clear: () => Promise<void> }} [panicModeStore]
 *        Panic-mode freeze record (main/panicModeState.js). Without it main
 *        reads no freeze and signs while the renderer shows one.
 * @property {import('@xchain-wallet/extension/src/background/broadcastQueueStorage.js').BroadcastQueueStorage | null} [broadcastQueueStorage]
 *        Desktop supplies a file adapter under userData. Other callers retain
 *        the shell default when this dependency is absent.
 * @property {{ list: () => Promise<string[] | null>, add: (id: string) => Promise<void>, remove: (ids: string[]) => Promise<void>, clear?: () => Promise<void> } | null} [broadcastQueuePrunedLedger]
 *        Desktop supplies a file ledger so removals survive queue IO failures.
 * @property {import('@xchain-wallet/core').registry.ChainRegistry} chainRegistry
 * @property {import('@xchain-wallet/core').sdk.SDKRegistry} sdkRegistry
 * @property {() => object|null} [loadAmountRules]
 *        The SDK amount validators the host settles pre-flight reports with.
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
 *   idleLockInFlight: Promise<{ locked: boolean, reason: string }> | null,
 *   autoLockCleanupPending: boolean,
 *   autoLockStoreLane: Promise<unknown>,
 *   systemLockInFlight: Promise<{ locked: boolean, reason: string }> | null,
 *   hostEpoch: number,
 *   hostBuildInFlight: Promise<ReturnType<typeof createDesktopMessageHost> | null> | null,
 *   hostClosedHolds: number,
 *   broadcastQueueStore: ReturnType<typeof createBroadcastQueueStore>,
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
    const broadcastQueueStorage = Object.prototype.hasOwnProperty.call(deps, 'broadcastQueueStorage')
        ? deps.broadcastQueueStorage
        : createBroadcastQueueStorage();
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
        // Panic-mode freeze record (main/panicModeState.js). Optional for the
        // same reason as the two stores above; `installPanicModePersistence`
        // wires it into core's freeze before the first window opens.
        panicModeStore: deps.panicModeStore || null,
        broadcastQueueStorage,
        broadcastQueuePrunedLedger: deps.broadcastQueuePrunedLedger,
        chainRegistry: deps.chainRegistry,
        sdkRegistry: deps.sdkRegistry,
        loadAmountRules: deps.loadAmountRules || null,
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
        // PC-16 Phase B: auto pay keeps paying armed orders after a lock (OS
        // screen lock and suspend included) for as long as main runs. The
        // session lives in main's memory only, never the keychain or disk;
        // the renderer sees plain status and a Stop call.
        lockedAutopay: deps.notify
            ? createLockedAutopay({ shellKind: 'desktop', notify: deps.notify, logger: console })
            : null,
        // PC-16: pre-unlocked software signers, populated by the shared
        // wallet.unlock handler while the password is in scope. A keychain
        // restore can also populate wallets sealed under the vault key; any
        // wallet with independent KDF params still requires a password.
        signerPool: new signersLib.SignerPool(),
        // The windowless idle check in flight, shared by concurrent callers.
        idleLockInFlight: null,
        // Fail closed if an auto-lock cannot remove the persisted session key.
        // The in-memory pending flag drives a later cleanup retry.
        autoLockCleanupPending: false,
        // Record loads and writes are ordered so a late activity stamp cannot
        // recreate a record after a lock clears it.
        autoLockStoreLane: Promise.resolve(),
        // OS lock and suspend can arrive together, so they share one lock.
        systemLockInFlight: null,
        // A teardown invalidates an asynchronous host build. Overlapping
        // callers share one build so only one Vault can own the session key.
        hostEpoch: 0,
        hostBuildInFlight: null,
        // Nonzero while a teardown still owes its session-key clear, so no
        // host can be built from the key it is about to remove.
        hostClosedHolds: 0,
        // One broadcast-queue store for every host this process builds, as the
        // extension and web shells hold: a lock keeps it (a broadcast still on
        // the network owes its persist and journal entry to the NEXT host),
        // and only a wipe seals and renews it.
        broadcastQueueStore: newBroadcastQueueStore(
            broadcastQueueStorage,
            deps.broadcastQueuePrunedLedger,
        ),
    };
}

/** Serialize auto-lock record reads and writes for one runtime. */
function withAutoLockStoreLane(runtime, task) {
    const run = runtime.autoLockStoreLane.then(task);
    runtime.autoLockStoreLane = run.catch(() => {});
    return run;
}

/** Clear the record in order, logging but never surfacing storage faults. */
async function clearAutoLockRecord(runtime, store) {
    if (!store) return;
    try {
        await withAutoLockStoreLane(runtime, () => store.clear());
    } catch (err) {
        console.error('[xchain] auto-lock record could not be cleared:', err);
    }
}

/**
 * Make main's freeze the file-backed one and load it. Await before the first
 * window opens: until the load resolves, core refuses every signature, which
 * is the safe answer while a freeze from the last run may still be unread.
 *
 * @param {DesktopRuntime} runtime
 * @returns {Promise<void>}
 */
export async function installPanicModePersistence(runtime) {
    if (!runtime?.panicModeStore) return;
    await flowsLib.configurePanicModePersistence(runtime.panicModeStore);
}

/** Build a queue store with the durable prune ledger supplied by the shell. */
function newBroadcastQueueStore(storage, prunedLedger) {
    return createBroadcastQueueStore({ storage, prunedLedger });
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
 * Fails CLOSED on a missing or unreadable record, or an armed one whose
 * idle window cannot be enforced, which is also what
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
    // Only a provably absent key skips the gate. A key that is present but
    // unreadable, or a probe that throws, still has an auto-lock deadline to
    // enforce and therefore follows the record checks below.
    let hasPersistedKey = false;
    let sessionProbeFailed = false;
    try {
        hasPersistedKey = await hasSessionKey(runtime.sessionBackend);
    } catch {
        sessionProbeFailed = true;
    }
    if (!hasPersistedKey && !sessionProbeFailed) {
        const presenceProbe = runtime.sessionBackend?.hasPersistedCiphertext;
        if (typeof presenceProbe !== 'function') {
            return { locked: false, reason: 'no-session' };
        }
        try {
            if (!await presenceProbe.call(runtime.sessionBackend)) {
                return { locked: false, reason: 'no-session' };
            }
        } catch { /* unknown presence follows the fail-closed record path */ }
    }

    let state = null;
    try { state = await store.load(); } catch { state = null; }

    let reason = '';
    if (!state) reason = 'no-record';
    else if (state.armed !== true) reason = 'disarmed';   // the user chose Never, or a demo wallet
    // Treat an armed record with no enforceable window as no record, for
    // any injected store (shouldAutoLock would answer "never lock" here)
    else if (!hasEnforceableWindow(state)) reason = 'no-record';
    else if (shouldAutoLock(state, now)) reason = 'idle-window-elapsed';

    if (reason === 'disarmed') return { locked: false, reason };
    if (reason === '') return { locked: false, reason: 'within-window' };

    // Drop the cached key AND the stale record together: leaving the
    // record would let the next launch read a stamp that no longer
    // describes any session.
    runtime.autoLockCleanupPending = true;
    try {
        await runtime.sessionBackend.clear();
        runtime.autoLockCleanupPending = false;
    } catch (err) {
        console.error('[xchain] auto-lock could not clear the cached session key:', err);
        // The keychain backend revokes its in-process copy before removing
        // the file. Drop this launch's record so a relaunch fails closed on
        // the missing record, while the pending flag protects this process
        // if an injected backend rejects before revoking its copy.
        try { await store.clear(); } catch { /* best-effort */ }
        return { locked: true, reason };
    }
    try { await store.clear(); } catch { /* best-effort */ }
    return { locked: true, reason };
}

/**
 * Enforce the user's configured auto-lock while the app runs with NO window.
 *
 * On macOS closing the last window does not quit, so the open vault, the
 * in-memory master key and the unlocked signer pool outlive the renderer
 * whose foreground timer was the only idle check. Reopening a window then
 * re-stamped the idle clock before anything read it. index.js calls this on
 * a timer while no window is live, and awaits it before a windowless reopen
 * creates the renderer that would stamp first.
 *
 * In-session semantics, the opposite of `enforceLaunchAutoLock`: a missing,
 * unreadable or disarmed record means do not lock, because an explicit lock
 * already cleared the record and the launch gate owns the crash paths. Only
 * call it while no window is live: activity is tracked in the renderer and
 * never reaches main, so with a window open this would lock an active user.
 * Never throws; concurrent callers share one in-flight check.
 *
 * @param {DesktopRuntime} runtime
 * @param {number} [now]
 * @returns {Promise<{ locked: boolean, reason: string }>}
 */
export function enforceIdleAutoLock(runtime, now = Date.now()) {
    if (!runtime) return Promise.resolve({ locked: false, reason: 'no-runtime' });
    if (!runtime.idleLockInFlight) {
        runtime.idleLockInFlight = runIdleAutoLock(runtime, now)
            .catch((err) => {
                console.error('[xchain] windowless auto-lock check failed:', err);
                return { locked: false, reason: 'check-failed' };
            })
            .finally(() => { runtime.idleLockInFlight = null; });
    }
    return runtime.idleLockInFlight;
}

// The body of enforceIdleAutoLock, without the single-flight wrapper.
async function runIdleAutoLock(runtime, now) {
    const store = runtime.autoLockStore;
    if (runtime.autoLockCleanupPending) return lockRuntimeForAutoLock(runtime, store, 'cleanup-retry');
    if (!store) return { locked: false, reason: 'no-store' };
    let state = null;
    try { state = await store.load(); } catch { state = null; }
    if (!state) return { locked: false, reason: 'no-record' };
    if (state.armed !== true) return { locked: false, reason: 'disarmed' };
    if (!hasEnforceableWindow(state)) return { locked: false, reason: 'no-window' };
    if (!shouldAutoLock(state, now)) return { locked: false, reason: 'within-window' };

    return lockRuntimeForAutoLock(runtime, store, 'idle-window-elapsed');
}

/**
 * Lock an armed desktop wallet immediately for an OS screen lock or suspend.
 * The existing Never setting remains the opt-out; enabled timeout lengths do
 * not delay an OS event because the user is no longer at the machine.
 *
 * @param {DesktopRuntime} runtime
 * @returns {Promise<{ locked: boolean, reason: string }>}
 */
export function enforceSystemAutoLock(runtime) {
    if (!runtime) return Promise.resolve({ locked: false, reason: 'no-runtime' });
    if (!runtime.systemLockInFlight) {
        runtime.systemLockInFlight = runSystemAutoLock(runtime)
            .catch((err) => {
                console.error('[xchain] system auto-lock check failed:', err);
                return { locked: false, reason: 'check-failed' };
            })
            .finally(() => { runtime.systemLockInFlight = null; });
    }
    return runtime.systemLockInFlight;
}

async function runSystemAutoLock(runtime) {
    const store = runtime.autoLockStore;
    if (runtime.autoLockCleanupPending) return lockRuntimeForAutoLock(runtime, store, 'cleanup-retry');
    if (!store) return { locked: false, reason: 'no-store' };
    let state = null;
    try { state = await store.load(); } catch { state = null; }
    if (!state) return { locked: false, reason: 'no-record' };
    if (state.armed !== true) return { locked: false, reason: 'disarmed' };
    if (!hasEnforceableWindow(state)) return { locked: false, reason: 'no-window' };
    return lockRuntimeForAutoLock(runtime, store, 'system-event');
}

async function lockRuntimeForAutoLock(runtime, store, reason) {
    // Armed auto pay moves to its locked session first, so an idle lock, an
    // OS screen lock or a suspend locks the wallet without stopping it.
    await captureLockedAutopay(runtime);
    // Stop watchers first so nothing signs while the cached key is removed.
    tearDownHost(runtime);
    runtime.autoLockCleanupPending = true;
    try {
        await runtime.sessionBackend.clear();
        runtime.autoLockCleanupPending = false;
    } catch (err) {
        console.error('[xchain] auto-lock could not clear the cached session key:', err);
        // Drop the record so a relaunch fails closed. The pending flag drives
        // the in-process retry while vault-backed IPC remains closed.
        await clearAutoLockRecord(runtime, store);
        return { locked: true, reason: 'session-clear-failed' };
    }
    await clearAutoLockRecord(runtime, store);
    return { locked: true, reason };
}

/**
 * Build the Vault + MessageHost from the cached session master key, if
 * one is present. Idempotent: returns the existing host if already
 * built. Returns null when no cached key exists (locked state).
 *
 * @param {DesktopRuntime} runtime
 */
async function buildHost(runtime) {
    const epoch = runtime.hostEpoch;
    const pool = runtime.signerPool;
    const masterKey = await runtime.sessionBackend.load();
    if (runtime.hostEpoch !== epoch) {
        masterKey?.fill(0);
        return null;
    }
    if (!masterKey) return null;

    const vault = new storageLib.Vault({
        backend: runtime.storageBackend,
        masterKey,
    });
    const abandonBuild = () => {
        if (!runtime.lockedAutopay?.holdsVault(vault)) {
            try { vault.close(); } catch (_err) { /* best-effort */ }
        }
        if (runtime.vault === vault) runtime.vault = null;
        try { pool.lockAll(); } catch (_err) { /* best-effort */ }
        return null;
    };
    try {
        await vault.open();
        if (runtime.hostEpoch !== epoch) return abandonBuild();
        runtime.vault = vault;

        // The keychain restores the already-derived vault key rather than a
        // password. Reuse it only for wallet records carrying identical KDF
        // params, which is the primary wallet created with the vault. Added
        // wallets with independent params remain unpooled and require unlock.
        try {
            const meta = await runtime.metaBackend.load();
            if (meta?.kdfParams) {
                await pool.populate({
                    vault,
                    masterKey,
                    masterKeyKdfParams: meta.kdfParams,
                    chainRegistry: runtime.chainRegistry,
                    sdkRegistry: runtime.sdkRegistry,
                });
            }
        } catch {
            // Best-effort restoration. The network switch locks before reload
            // when its wallet has no signer, so this cannot leave a false
            // unlocked state with address derivation unavailable.
        }
        if (runtime.hostEpoch !== epoch) return abandonBuild();

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
        if (runtime.hostEpoch !== epoch) return abandonBuild();

        // Publishing and watcher construction below are synchronous. Any
        // await added before publication needs another epoch check.
        runtime.host = createDesktopMessageHost({
            vault,
            chainRegistry: runtime.chainRegistry,
            sdkRegistry: runtime.sdkRegistry,
            signerPool: pool,
            loadAmountRules: runtime.loadAmountRules,
            // A password change re-seals the vault; the keychain-cached
            // session key must follow it or the next launch opens nothing.
            vaultKeyring: createVaultKeyring({
                metaBackend: runtime.metaBackend,
                sessionBackend: runtime.sessionBackend,
            }),
            broadcastQueueStore: runtime.broadcastQueueStore,
            getDiagnosticContext: runtime.getDiagnosticContext,
            // Re-applies routing on any settings.update touching `privacy`,
            // so the toggle takes effect on the next request.
            onPrivacySettingsChanged: runtime.onPrivacySettingsChanged,
            // A saved endpoint override drops the chain's SDK instance; the
            // watcher rebinds its socket to the new one.
            onSdkEndpointsChanged: async () => { await runtime.notificationService?.refresh(); },
            surfaceStateEvents: {
                async publish(kind) {
                    if (kind !== 'network') return;
                    await runtime.notificationService?.refresh();
                    for (const watcher of [
                        runtime.governancePollWatcher,
                        runtime.deadlineWatcher,
                        runtime.dispenserEscrowWatcher,
                    ]) {
                        if (!watcher) continue;
                        watcher.stop();
                        watcher.start();
                    }
                    if (runtime.coinpayAutopayWatcher) {
                        runtime.coinpayAutopayWatcher.stop();
                        runtime.coinpayAutopayWatcher.start();
                        await runtime.coinpayAutopayWatcher.refresh();
                    }
                },
            },
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
            // Token alerts price through the chain registry; the setting is read
            // once per poll so a privacy toggle applies without a restart.
            let tokenPriceDeps = {};
            if (typeof notificationsLib.createTokenPriceLookup === 'function') {
                let priceDataAllowed = true;
                const lookup = notificationsLib.createTokenPriceLookup({
                    chainRegistry: runtime.chainRegistry,
                    allowCoingeckoFallback: () => priceDataAllowed,
                });
                tokenPriceDeps = {
                    getTokenPrices: async (req) => {
                        const settings = await flowsLib.getSettings(vault);
                        priceDataAllowed = settings?.privacy?.priceDataEnabled !== false;
                        return lookup(req);
                    },
                };
            }
            runtime.priceAlertWatcher = new notificationsLib.PriceAlertWatcher({
                getNativePrices: ({ chainIds, fiatCurrency }) => priceOracle.getNativePrices({ chainIds, fiatCurrency }),
                ...tokenPriceDeps,
                listArmedAlerts: () => vault.priceAlerts.list(),
                getSettings: () => flowsLib.getSettings(vault),
                notify: runtime.notify,
                markTriggered: (id, terms) => flowsLib.markAlertTriggered({ vault, id, terms }),
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
        // when the signer pool holds the wallet's signer: after a password
        // unlock, or after a keychain restore for the primary wallet (the
        // pool populate above). Once locked, runtime.lockedAutopay pays.
        if (runtime.notify && !runtime.coinpayAutopayWatcher) {
            runtime.coinpayAutopayWatcher = new notificationsLib.CoinpayAutopayWatcher({
                vault,
                sdkRegistry: runtime.sdkRegistry,
                chainRegistry: runtime.chainRegistry,
                getSigner: (walletId) => runtime.signerPool.get(walletId),
                getSettings: () => flowsLib.getSettings(vault),
                reservationLedger: runtime.host.host.reservationLedger,
                notify: runtime.notify,
                shellKind: 'desktop',
                // Shared with the locked session so a lock or unlock hands
                // the payer lease over instead of waiting it out.
                ...(runtime.lockedAutopay && { instanceId: runtime.lockedAutopay.instanceId }),
                logger: console,
            });
            runtime.coinpayAutopayWatcher.seedAttempted?.(runtime.lockedAutopay?.takeHandoff() ?? []);
            runtime.coinpayAutopayWatcher.start();
            runtime.coinpayAutopayWatcher.refresh().catch(() => { /* WS triggers are best-effort */ });
        }

        return runtime.host;
    } catch (err) {
        if (runtime.hostEpoch !== epoch) return abandonBuild();
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
 * Return the current host or share one asynchronous build among callers.
 * A caller that joined a build which found no session builds once more,
 * since it may be the unlock that saved the key after that build read it.
 * It never retries when a teardown ran after it joined: its request predates
 * that lock, and the session key may outlive the teardown (a wipe clears it
 * only after its other stores).
 *
 * @param {DesktopRuntime} runtime
 */
export async function ensureHost(runtime) {
    if (runtime.autoLockCleanupPending || runtime.hostClosedHolds > 0) return null;
    if (runtime.host) return runtime.host;
    const joined = runtime.hostBuildInFlight !== null;
    const joinedEpoch = runtime.hostEpoch;
    if (!runtime.hostBuildInFlight) {
        const build = buildHost(runtime).finally(() => {
            if (runtime.hostBuildInFlight === build) runtime.hostBuildInFlight = null;
        });
        runtime.hostBuildInFlight = build;
    }
    const result = await runtime.hostBuildInFlight;
    if (result != null || !joined || runtime.hostEpoch !== joinedEpoch) return result;
    return ensureHost(runtime);
}

/**
 * Close the vault + drop the host. Used by the `wallet.lock` pre-host
 * callback and by app-before-quit. Safe to call when already torn down.
 *
 * @param {DesktopRuntime} runtime
 */
export function tearDownHost(runtime) {
    runtime.hostEpoch += 1;
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
        // A vault locked auto pay took is the session's to close.
        if (!runtime.lockedAutopay?.holdsVault(runtime.vault)) {
            try { runtime.vault.close(); } catch (_err) { /* already closed */ }
        }
        runtime.vault = null;
    }
    runtime.host = null;
}

/**
 * Tear the host down, then clear the cached session key, building no host
 * from that key until the clear settles. Rejects with the clear's error.
 *
 * @param {DesktopRuntime} runtime
 */
export async function closeHostAndClearSession(runtime) {
    tearDownHost(runtime);
    runtime.hostClosedHolds += 1;
    try {
        await runtime.sessionBackend.clear();
    } finally {
        runtime.hostClosedHolds -= 1;
    }
}

/**
 * PC-16 Phase B: hand armed auto pay to its locked session just before a lock
 * zeroes the signer pool. Nothing armed, or no open vault (a repeat lock),
 * does nothing, and the lock runs exactly as before. Never throws.
 *
 * @param {DesktopRuntime} runtime
 * @returns {Promise<boolean>} whether the session took the vault
 */
export async function captureLockedAutopay(runtime) {
    if (!runtime?.lockedAutopay || !runtime.vault || !runtime.host) return false;
    try {
        return await runtime.lockedAutopay.lock({
            vault: runtime.vault,
            signerPool: runtime.signerPool,
            chainRegistry: runtime.chainRegistry,
            sdkRegistry: runtime.sdkRegistry,
            reservationLedger: runtime.host?.host?.reservationLedger,
            watcher: runtime.coinpayAutopayWatcher,
        });
    } catch (err) {
        console.error('[xchain] locked auto pay could not start:', err);
        return false;
    }
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
 * IndexedDB, neither of which the desktop shell uses. Its stores are
 * files under `app.getPath('userData')`, reachable only from main, and
 * `targets` below is the list that decides what goes; a new per-wallet
 * store added to `createRuntime` goes there too. The broadcast queue is
 * sealed first to stop late writes, then cleared again in that list so a
 * file refusal reaches the wipe result:
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
 *   - autoLock       `autolock.json`        the idle stamp of a session
 *                                           that no longer exists, which
 *                                           would hand the next wallet
 *                                           somebody else's idle clock
 *   - broadcastQueue `broadcast-queue.json` signed transactions waiting
 *                                           for an explicit retry
 *   - broadcastQueuePruned                    wallet removals that must
 *                                           survive a queue IO failure
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
 * file cannot leave the others behind; the caller reports `ok`. The meta is
 * the exception: when it will not go, the wipe stops with the wallet whole.
 *
 * @param {DesktopRuntime} runtime
 * @returns {Promise<WipeResult>}
 */
export async function wipeRuntimeStores(runtime) {
    if (!runtime) throw new Error('wipeRuntimeStores: runtime is required');
    // The vault being erased is the one locked auto pay holds.
    try { await runtime.lockedAutopay?.end('wallet-wipe'); } catch { /* the wipe goes on */ }
    tearDownHost(runtime);
    clearErasedWalletRuntimeState(runtime);
    // The session key outlives the teardown until its turn below, so no host
    // may be built from it while the wipe runs.
    runtime.hostClosedHolds += 1;
    try {
        return await clearRuntimeStores(runtime);
    } finally {
        runtime.hostClosedHolds -= 1;
    }
}

function clearErasedWalletRuntimeState(runtime) {
    let removed = [];
    try {
        ({ removed } = registryLib.clearUserAddedChains(runtime.chainRegistry));
    } catch (err) {
        console.error('[xchain] custom-chain reset failed:', err);
    }
    try {
        if (typeof runtime.sdkRegistry?.applyEndpointOverridesFromSettings === 'function') {
            runtime.sdkRegistry.applyEndpointOverridesFromSettings({});
        }
    } catch (err) {
        console.error('[xchain] endpoint reset failed:', err);
    }
    for (const id of removed) {
        try { runtime.sdkRegistry?.invalidate?.(id); } catch (_err) { /* wipe continues */ }
    }
}

/**
 * The store-clearing half of `wipeRuntimeStores`, run with the host closed.
 *
 * @param {DesktopRuntime} runtime
 * @returns {Promise<WipeResult>}
 */
async function clearRuntimeStores(runtime) {
    // Seal the shared queue store so a broadcast the torn-down host still has
    // on the network writes nothing back; the next unlock gets a fresh one.
    try {
        await sealBroadcastQueueStore(runtime.broadcastQueueStore);
    } catch (err) {
        console.error('[xchain] broadcast-queue seal failed:', err);
    }
    runtime.broadcastQueueStore = newBroadcastQueueStore(
        runtime.broadcastQueueStorage,
        runtime.broadcastQueuePrunedLedger,
    );

    /** @type {string[]} */
    const cleared = [];
    /** @type {{ store: string, message: string }[]} */
    const errors = [];
    // Meta before the blob. A quit between the two unlinks leaves one of
    // them on disk: a blob alone reads as locked, and the lock screen's
    // Forgot password runs the reset again; meta alone reads as no wallet
    // while create, import and restore refuse over it, a dead end.
    const targets = [
        ['meta', runtime.metaBackend],
        ['storage', runtime.storageBackend],
        ['session', runtime.sessionBackend],
        ['broadcastQueue', runtime.broadcastQueueStorage],
        ['broadcastQueuePruned', runtime.broadcastQueuePrunedLedger],
        ['unlockThrottle', runtime.unlockThrottleStore],
        // The auto-lock stamp describes a session that no longer exists
        // after a wipe; carrying it into the next wallet would hand that
        // wallet somebody else's idle clock.
        ['autoLock', runtime.autoLockStore],
        // The renderer's reset clears its view of the freeze; main's copy
        // and its file go with it, as every other shell's reset does.
        ['panicMode', runtime.panicModeStore],
    ];
    for (const [name, backend] of targets) {
        if (!backend || typeof backend.clear !== 'function') continue;
        try {
            await backend.clear();
            cleared.push(name);
        } catch (err) {
            errors.push({ store: name, message: String(err?.message ?? err) });
            // A meta file that will not go must keep its blob: unlinking the
            // blob anyway leaves the meta-alone dead end the order above
            // avoids, while stopping here leaves the wallet whole for a retry.
            if (name === 'meta') break;
        }
    }
    // Main's in-memory freeze follows its file: a wipe that stopped before the
    // file went leaves the surviving wallet frozen, in memory as on disk.
    if (cleared.includes('panicMode')) flowsLib.applyExternalPanicModeState(null);
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
            // Drop every report while an undeletable cached key is on disk: a
            // disarm or activity stamp written now would let the next launch
            // reopen that key with no password. A password unlock ends this.
            try {
                const applied = await withAutoLockStoreLane(runtime, async () => {
                    if (runtime.autoLockCleanupPending) return false;
                    await applyAutoLockReport(runtime.autoLockStore, message.request, Date.now());
                    return true;
                });
                if (!applied) return { ok: true, result: { armed: false } };
            } catch (err) {
                const refusedArm = message.request?.armed === true
                    && message.request?.activity !== true;
                if (!refusedArm) throw err;
                console.error('[xchain] auto-lock arm could not be saved:', err);
                await lockRuntimeForAutoLock(runtime, runtime.autoLockStore, 'arm-refused');
                await clearAutoLockRecord(runtime, runtime.autoLockStore);
                return { ok: true, result: { ok: false, reason: AUTO_LOCK_UNSAVED } };
            }
            return { ok: true, result: { armed: message.request?.armed === true } };
        }
        // Panic-mode freeze, also ahead of both lanes: the duress passphrase
        // arms it from the Locked screen, so it has to land while the vault
        // is closed, and main is the process whose signers it must stop.
        if (PANIC_STATE_MESSAGE_TYPES.has(message.type)) {
            const result = await handlePanicStateMessage(
                { flows: flowsLib, store: runtime.panicModeStore },
                message.type,
                message.request,
            );
            return { ok: true, result };
        }
        const preHostMessage = PRE_HOST_MESSAGE_TYPES.has(message.type);
        if (!preHostMessage && runtime.autoLockCleanupPending) {
            return errorEnvelope(Object.assign(
                new Error('Wallet is locked. Unlock before calling vault-backed handlers.'),
                { name: 'WalletLockedError' },
            ));
        }
        // Every other message is renderer activity, and the idle clock has
        // to advance from it or a user who is actively using the app would
        // come back to a locked wallet. Throttled inside the helper.
        withAutoLockStoreLane(runtime, async () => {
            if (runtime.autoLockCleanupPending) return;
            await stampAutoLockActivity(runtime.autoLockStore, Date.now());
        }).catch(() => { /* best-effort; never blocks the message */ });

        if (preHostMessage) {
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
                    // A fresh password-authenticated unlock supersedes a
                    // failed cleanup attempt and starts a new idle window.
                    runtime.autoLockCleanupPending = false;
                    await clearAutoLockRecord(runtime, runtime.autoLockStore);
                    try { await ensureHost(runtime); } catch (err) {
                        // Logged but not thrown: the unlock itself
                        // succeeded; the host-build failure will
                        // resurface on the next message if it's real.
                        console.error('[xchain] ensureHost after unlock failed:', err);
                    }
                    // Until the renderer reports, the session carries the
                    // vault's own window instead of no deadline.
                    await withAutoLockStoreLane(runtime, () => armProvisionalAutoLock(
                        runtime.autoLockStore,
                        () => runtime.vault?.settings.get() ?? null,
                        Date.now(),
                    )).catch((err) => {
                        console.error('[xchain] provisional auto-lock record could not be saved:', err);
                    });
                },
                startLabelSyncRestore: (opts) => startLabelSyncRestoreTask({
                    walletId: opts.walletId,
                    run: () => restoreLabelSyncBestEffort({ ...opts, vault: runtime.vault }),
                }),
                onLocked: async (result) => {
                    runtime.autoLockCleanupPending = result?.secretsCleared === false;
                    // Armed auto pay moves to its locked session before the
                    // teardown zeroes the pool (PC-16 Phase B).
                    await captureLockedAutopay(runtime);
                    tearDownHost(runtime);
                    // An explicit lock ends the window the stamp described.
                    await clearAutoLockRecord(runtime, runtime.autoLockStore);
                },
                // The Locked screen's auto pay line and Stop, and the end of
                // locked auto pay before any unlock, create or import.
                ...(runtime.lockedAutopay && {
                    lockedAutopay: runtime.lockedAutopay,
                    beforeSessionStart: (type) => runtime.lockedAutopay.end(type === 'wallet.unlock' ? 'unlock' : 'wallet-switch'),
                }),
                // wallet.hardware.balances keeps the open vault's price-data
                // switch; with no open vault the defaults apply.
                readSettings: () => (runtime.vault ? runtime.vault.settings.get() : null),
            });
            // A locked wallet whose KDF metadata cannot be read can never unlock:
            // reading it here sends the renderer to the damaged-vault screen
            // (VaultCorruptError) instead of a password prompt that always fails.
            if (message.type === 'session.status' && result.hasWallet && !result.hasSession) {
                await runtime.metaBackend.load();
            }
            if (message.type === 'session.status' && runtime.autoLockCleanupPending) {
                return {
                    ok: true,
                    result: {
                        ...result,
                        hasSession: false,
                        state: result.hasWallet ? 'locked' : 'no-wallet',
                    },
                };
            }
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
