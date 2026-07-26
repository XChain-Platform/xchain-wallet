// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// MV3 service-worker entry; the manifest's `background.service_worker`
// points at this file (bundled to dist/background.js).
//
// Responsibilities:
//   1. Stand up a Vault against ChromeStorageBackend / ChromeSessionBackend
//   2. Build a ChainRegistry + SDKRegistry (SDK factory injected by the
//      packaged bundle; the SDK is CJS and shells bundle their own
//      version via createRequire / native ESM)
//   3. Build the MessageHost via `createBackgroundHost`
//   4. Attach to `chrome.runtime.onMessage`
//
// This file stays thin so the UI session can swap in richer lifecycle
// (wallet-session state machine, approval popup wiring, event fan-out
// to content scripts) without reworking the entry.

import {
    registry as registryLib,
    sdk as sdkLib,
    signers as signersLib,
    storage as storageLib,
    flows as flowsLib,
    notifications as notificationsLib,
} from '@xchain-wallet/core';
import { WALLET_VERSION } from '@xchain-wallet/core/buildInfo.js';
import {
    ChromeSessionBackend,
    ChromeStorageBackend,
} from './storage/index.js';
import {
    ApprovalBroker,
    attachChromeRuntime,
    attachSessionMetaListener,
    attachSignerBridgeListener,
    createBackgroundHost,
    createDevMockSdk as createDevMockSdkImpl,
    resolveSdkFactory,
} from './background/index.js';
// : NOT re-exported through the barrel above. A static `import` is the
// only way a service worker can load the SDK (`import()` is disallowed on
// ServiceWorkerGlobalScope), and keeping it off the barrel is what lets the
// Node smokes go on importing sdkFactory.js without an installed SDK.
import { XChainSDK } from './background/sdkStatic.js';
import { SIGNING_SECRET_SESSION_KEY, loadSigningSecret } from './background/signingSecretSession.js';
import { initPanicModePersistence } from './background/panicModeStorage.js';
import {
    readAutoLockState,
    stampAutoLockActivity,
    clearAutoLockState,
    shouldAutoLock,
} from './background/autoLockState.js';
import { handleWalletLock } from './background/walletLock.js';
import { createBridgeEventBroadcaster } from './bridge/bridgeEvents.js';
import {
    applyLayoutMode,
    attachLayoutModeListener,
    readLayoutMode,
} from './background/layoutMode.js';

// Apply the user's saved layout mode (popup vs sidepanel) at worker
// boot, then watch storage for live changes from the in-wallet
// settings UI. The user's preference is honoured the next time they
// click the toolbar icon; no extension reload needed.
(async () => {
    const mode = await readLayoutMode();
    await applyLayoutMode(mode);
})();
attachLayoutModeListener();

// --- Lazy wiring --------------------------------------------------------
// The service worker starts with no master key; it's in ChromeSessionBackend
// only if the user has unlocked the wallet in this browser session. Until
// that happens, MessageHost handlers that require a Vault will fail; the
// popup is responsible for prompting unlock before issuing any operation.

const chainRegistry = registryLib.defaultRegistry();

// §9.7 / G007: refresh chain descriptors from the hub's signed public
// registry snapshot on worker boot. Fire-and-forget soft enhancement: the
// signature must verify against the pinned federation key or nothing
// changes; any failure leaves the bundled descriptors serving.
try {
    registryLib.syncChainRegistryFromHub({ registry: chainRegistry })
        .then((r) => {
            if (!r.ok) console.info('[xchain] chain-registry sync skipped:', r.reason);
        })
        .catch(() => { /* soft enhancement; bundled descriptors keep serving */ });
} catch { /* never block worker boot */ }

// : gate the dev mock on `import.meta.env?.PROD` (statically
// replaced by Vite) so a production build dead-code-eliminates the mock
// implementation entirely; check-no-dev-mock.sh greps dist/ for it. The
// `?.` keeps this Node-safe for the smoke harness, where import.meta.env
// is undefined and the mock stays available.
const createDevMockSdk = import.meta.env?.PROD ? null : createDevMockSdkImpl;

// /: pre-resolution placeholder for PRODUCTION builds, where
// the dev mock is compiled out. Throws loudly on any call instead of
// serving fabricated data. Mirrors packages/web/src/hostBridge.js.
function makeLoadingSdkSurface() {
    const thrower = () => {
        throw new Error(
            '[xchain-wallet/extension] xchain-sdk is not loaded yet (or '
            + 'failed to load); refusing to serve data. See sdkResolved.',
        );
    };
    return new Proxy(thrower, {
        get(_target, prop) {
            // Not a thenable: `await sdk` must not recurse into the proxy.
            if (prop === 'then') return undefined;
            return makeLoadingSdkSurface();
        },
        apply() { return thrower(); },
    });
}
const createLoadingSdk = () => makeLoadingSdkSurface();

// Build the SDKRegistry against the dev mock (dev builds) or a throwing
// placeholder (production) synchronously so the service worker can
// register handlers immediately, then swap in the real
// `xchain-sdk`-backed factory once `adaptXChainSDK` has wrapped it.
// Callers that need to wait on real-SDK availability can await
// `sdkResolved` before issuing sign / broadcast requests.
let sdkRegistry = new sdkLib.SDKRegistry({
    chainRegistry,
    sdkFactory: createDevMockSdk ?? createLoadingSdk,
});

export const sdkResolved = resolveSdkFactory({ devMockFactory: createDevMockSdk, XChainSDK })
    .then((result) => {
        sdkRegistry = new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: result.factory,
        });
        return result.source;
    })
    .catch((err) => {
        // : never swallow the production refusal (see the web shell's
        // hostBridge.js for the full rationale). In production, log and
        // re-throw so `sdkResolved` consumers see the failure; the registry
        // stays on the throwing placeholder. In dev / Node harnesses the
        // dev-mock fallback is expected.
        if (import.meta.env?.PROD) {
            console.error('[xchain-wallet/extension] SDK resolution failed:', err);
            throw err;
        }
        return 'dev-mock';
    });

// Module-scoped so the broker survives across unlock / lock cycles;
// rejecting any pending approval on window-close continues to work even
// if no wallet is unlocked.
const approvalBroker = new ApprovalBroker();

let host = null;
let vault = null;
let detachHost = null;
// §46: live notification watcher. Module-scoped so it survives across the
// keepalive's repeated ensureHost() calls; recreated from scratch when the MV3
// worker is evicted and cold-restarts.
let notificationService = null;
// §46 price-alert poll watcher, paired with notificationService; same
// guard + cold-restart semantics.
let priceAlertWatcher = null;
// §46 governance-poll watcher (new VOTE poll over a held token); same guard +
// cold-restart semantics. Seen-state persists in chrome.storage.local so an
// MV3 worker eviction doesn't re-baseline and drop pending announcements.
let governancePollWatcher = null;
let coinpayAutopayWatcher = null;
let deadlineWatcher = null;
const GOV_POLL_SEEN_KEY = 'governancePollsSeen';
const DEADLINE_SEEN_KEY = 'deadlinesSeen';

// §46 delivery adapter for the extension: chrome.notifications works with the
// popup closed (it's the service worker firing, not a page). type 'basic'
// requires an iconUrl; reuse the packaged action icon.
function chromeNotify({ kind, title, body }) {
    try {
        if (typeof chrome === 'undefined' || !chrome.notifications || !chrome.notifications.create) return;
        chrome.notifications.create(`xchain-${kind}-${Date.now()}`, {
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
            title,
            message: body,
        });
    } catch (err) {
        console.error('[xchain] chrome.notifications failed:', err);
    }
}
// SignerPool persists across the unlocked session. Populated by the
// pre-host `wallet.unlock` handler while the password is in scope, so
// account.create / receive.getAddress (etc.) can derive without a
// per-op password prompt. Locked + cleared by `tearDownHost` on
// `wallet.lock` or any teardown path.
let signerPool = new signersLib.SignerPool();

async function ensureHost() {
    if (host) return host;
    const sessionBackend = new ChromeSessionBackend();
    const masterKey = await sessionBackend.load();
    if (!masterKey) {
        // No unlocked session. The popup must unlock + re-init the host.
        return null;
    }
    vault = new storageLib.Vault({
        backend: new ChromeStorageBackend(),
        masterKey,
    });
    await vault.open();

    // Re-populate the SignerPool after a service-worker restart. On the
    // normal unlock path the pre-host handler already filled the pool while
    // the password was in scope, so this only fires when Chrome killed and
    // restarted the worker mid-session (the pool is module state and didn't
    // survive). The master key can't decrypt seeds, so we use the password
    // cached in the signing-secret session slot. Best-effort: a failure just
    // leaves the per-op password prompt as the fallback.
    if (signerPool.size() === 0) {
        try {
            const cachedPassword = await loadSigningSecret(
                new ChromeSessionBackend({ key: SIGNING_SECRET_SESSION_KEY }),
            );
            if (cachedPassword) {
                await signerPool.populate({
                    vault,
                    password: cachedPassword,
                    chainRegistry,
                    sdkRegistry,
                });
            }
        } catch (err) {
            console.error('[xchain] SignerPool rehydrate failed:', err);
        }
    }

    // §26.5 panic-mode freeze. localStorage does not exist in an MV3 service
    // worker, so the freeze state must persist in chrome.storage.local to
    // survive worker teardown and to stay visible across popup / approval /
    // background. Start hydration before the host serves any signing route;
    // assertSigningAllowed fails closed until the initial load resolves.
    await initPanicModePersistence(flowsLib);

    host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        signerPool,
        approvals: approvalBroker,
        // §43.2 / Cluster F FOLLOWUP 1: fan-out for bridge events so
        // dApps subscribed via provider.on(...) get accountsChanged /
        // chainChanged / disconnect when the wallet mutates connected
        // site state. Background uses chrome.tabs to find tabs sitting
        // on the matching origin.
        bridgeEvents: typeof chrome !== 'undefined' && chrome.tabs
            ? createBridgeEventBroadcaster({ tabs: chrome.tabs, runtime: chrome.runtime })
            : undefined,
        // §50 / Cluster L FOLLOWUP 4: shell-specific diagnostic env + build.
        getDiagnosticContext: async () => ({
            env: {
                shell: 'extension',
                userAgent:
                    typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
                platform:
                    typeof navigator !== 'undefined' ? navigator.platform : undefined,
            },
            build: {
                walletVersion: WALLET_VERSION,
                target: typeof chrome !== 'undefined' && chrome.runtime?.getManifest
                    ? chrome.runtime.getManifest().version
                    : undefined,
            },
        }),
    });
    detachHost = attachChromeRuntime(host, undefined, { onActivity: noteAutoLockActivity });

    // §46: start the live notification watcher once a vault is open. Guarded
    // so the keepalive's repeat ensureHost() calls don't double-start; a cold
    // worker restart rebuilds it (module state was lost) and the SDK WS client
    // reconnects + replays its subscriptions.
    if (!notificationService) {
        notificationService = new notificationsLib.NotificationService({
            getActiveAddresses: async () => {
                const settings = await flowsLib.getSettings(vault);
                return notificationsLib.getActiveAddresses(vault, chainRegistry, {
                    activeNetwork: settings.activeNetwork,
                });
            },
            getSdkForChain: (chainId) => sdkRegistry.get(chainId),
            getSettings: () => flowsLib.getSettings(vault),
            notify: chromeNotify,
            getPendingTxids: () => notificationsLib.getBroadcastTxids(vault),
            onTxConfirmed: (txid) => notificationsLib.markPendingTxIndexed(vault, txid),
            logger: console,
        });
        notificationService.start().catch((err) => {
            console.error('[xchain] notification watcher start failed:', err);
        });
    }

    // §46: start the price-alert poll watcher. Its own oracle instance
    // (in-memory cache, 5-min cadence ≈ the oracle's spot TTL). The watcher
    // hard-gates on settings.privacy.priceDataEnabled + notifications.priceAlerts
    // and makes zero network calls when no alert is armed.
    if (!priceAlertWatcher && typeof globalThis.fetch === 'function') {
        const priceOracle = flowsLib.createPriceOracle({ fetch: globalThis.fetch.bind(globalThis) });
        priceAlertWatcher = new notificationsLib.PriceAlertWatcher({
            getNativePrices: ({ chainIds, fiatCurrency }) => priceOracle.getNativePrices({ chainIds, fiatCurrency }),
            listArmedAlerts: () => vault.priceAlerts.list(),
            getSettings: () => flowsLib.getSettings(vault),
            notify: chromeNotify,
            markTriggered: (id) => flowsLib.markAlertTriggered({ vault, id }),
            logger: console,
        });
        priceAlertWatcher.start();
    }

    // §46: start the governance-poll watcher (new VOTE poll over a held token,
    // binding polls flagged). One open-poll query per chain per tick; held
    // ticks are derived locally from the wallet's own balances.
    if (!governancePollWatcher) {
        governancePollWatcher = new notificationsLib.GovernancePollWatcher({
            getActiveAddresses: async () => {
                const settings = await flowsLib.getSettings(vault);
                return notificationsLib.getActiveAddresses(vault, chainRegistry, {
                    activeNetwork: settings.activeNetwork,
                });
            },
            getSdkForChain: (chainId) => sdkRegistry.get(chainId),
            getSettings: () => flowsLib.getSettings(vault),
            notify: chromeNotify,
            loadSeen: async () => {
                try {
                    const stored = await chrome.storage.local.get(GOV_POLL_SEEN_KEY);
                    return stored?.[GOV_POLL_SEEN_KEY] || null;
                } catch (_err) { return null; }
            },
            saveSeen: async (seen) => {
                try { await chrome.storage.local.set({ [GOV_POLL_SEEN_KEY]: seen }); }
                catch (_err) { /* best-effort: fall back to in-session only */ }
            },
            logger: console,
        });
        governancePollWatcher.start();
    }

    // PC-45: start the deadline watcher (my orders/swaps/dispensers nearing
    // EXPIRATION, and polls I created or voted in nearing their close block).
    // COINPAY obligations and unstake cooldowns are deliberately excluded:
    // PC-15 and PC-47 own those timers, and this deep-links to them instead.
    if (!deadlineWatcher) {
        deadlineWatcher = new notificationsLib.DeadlineWatcher({
            getActiveAddresses: async () => {
                const settings = await flowsLib.getSettings(vault);
                return notificationsLib.getActiveAddresses(vault, chainRegistry, {
                    activeNetwork: settings.activeNetwork,
                });
            },
            getSdkForChain: (chainId) => sdkRegistry.get(chainId),
            getSettings: () => flowsLib.getSettings(vault),
            coinForChain: (chainId) => chainRegistry.get(chainId)?.coin || null,
            notify: chromeNotify,
            loadSeen: async () => {
                try {
                    const stored = await chrome.storage.local.get(DEADLINE_SEEN_KEY);
                    return stored?.[DEADLINE_SEEN_KEY] || null;
                } catch (_err) { return null; }
            },
            saveSeen: async (seen) => {
                try { await chrome.storage.local.set({ [DEADLINE_SEEN_KEY]: seen }); }
                catch (_err) { /* best-effort: fall back to in-session only */ }
            },
            logger: console,
        });
        deadlineWatcher.start();
    }

    // PC-16: start the CoinPay auto-pay engine. Signs with the pool's
    // pre-unlocked signers only (unlocked session = armed); shares the
    // host's reservation ledger so its funds holds and the confirm
    // surface net in one domain. The MV3 keepalive alarm keeps the
    // worker (and this interval) alive like the other watchers.
    if (!coinpayAutopayWatcher) {
        coinpayAutopayWatcher = new notificationsLib.CoinpayAutopayWatcher({
            vault,
            sdkRegistry,
            chainRegistry,
            getSigner: (walletId) => signerPool.get(walletId),
            reservationLedger: host.reservationLedger,
            notify: chromeNotify,
            shellKind: 'extension',
            logger: console,
        });
        coinpayAutopayWatcher.start();
        coinpayAutopayWatcher.refresh().catch(() => { /* WS triggers are best-effort */ });
    }

    return host;
}

/**
 * Release the host + close the vault so a subsequent unlock starts from
 * a clean slate. Called by the wallet.lock handler via the onLocked
 * callback; also safe to call from any cleanup path (e.g. panic mode).
 */
function tearDownHost() {
    if (notificationService) {
        try { notificationService.stop(); } catch (_err) { /* best-effort */ }
        notificationService = null;
    }
    if (priceAlertWatcher) {
        try { priceAlertWatcher.stop(); } catch (_err) { /* best-effort */ }
        priceAlertWatcher = null;
    }
    if (governancePollWatcher) {
        try { governancePollWatcher.stop(); } catch (_err) { /* best-effort */ }
        governancePollWatcher = null;
    }
    if (deadlineWatcher) {
        try { deadlineWatcher.stop(); } catch (_err) { /* best-effort */ }
        deadlineWatcher = null;
    }
    if (coinpayAutopayWatcher) {
        try { coinpayAutopayWatcher.stop(); } catch (_err) { /* best-effort */ }
        coinpayAutopayWatcher = null;
    }
    if (detachHost) {
        try { detachHost(); } catch (_err) { /* best-effort */ }
        detachHost = null;
    }
    if (vault) {
        try { vault.close(); } catch (_err) { /* best-effort */ }
        vault = null;
    }
    if (signerPool) {
        try { signerPool.lockAll(); } catch (_err) { /* best-effort */ }
    }
    // Replace rather than null; sessionMeta passes the pool by
    // reference at construction time. Swapping in a fresh empty pool
    // keeps that reference stable for the next unlock.
    signerPool = new signersLib.SignerPool();
    host = null;
}

// --- Auto-lock backstop (§26) ------------------------------------------
// The foreground `useAutoLock` hook locks on idle only while a popup/tab is
// open; the extension popup is torn down on close, so its timer stops. These
// helpers let the service worker enforce the same idle timeout after the popup
// is gone. The popup ARMS the backstop (armed + idleMs, honouring the demo-
// wallet skip); the SW stamps activity from trusted-UI message traffic and the
// keepalive alarm checks + locks.

let lastActivityStampAt = 0;
function noteAutoLockActivity() {
    const now = Date.now();
    // Throttle persisted writes to at most once per 10s; a message burst from
    // the open popup only needs to keep the idle clock roughly fresh.
    if (now - lastActivityStampAt < 10_000) return;
    lastActivityStampAt = now;
    stampAutoLockActivity(now).catch(() => { /* best-effort */ });
}

async function lockWalletNow() {
    await clearAutoLockState();
    await handleWalletLock(null, {
        sessionBackend: new ChromeSessionBackend(),
        signingSecretBackend: new ChromeSessionBackend({ key: SIGNING_SECRET_SESSION_KEY }),
        onLocked: () => tearDownHost(),
    });
}

async function maybeAutoLock() {
    if (!host || !vault) return;  // already locked; nothing to do
    let state;
    try { state = await readAutoLockState(); } catch { return; }
    if (!shouldAutoLock(state, Date.now())) return;
    console.log('[xchain] auto-lock: idle timeout reached, locking wallet');
    try { await lockWalletNow(); } catch (err) {
        console.error('[xchain] auto-lock lock failed:', err);
    }
}

// Pre-host listener runs before the vault is open so the popup can ask
// "no-wallet / locked / unlocked?" and perform `wallet.unlock`. Both
// of those need to work when the vault is still encrypted. The host
// listener (attached inside `ensureHost` once a session key is present)
// picks up everything else. See sessionMeta.PRE_HOST_MESSAGE_TYPES.
attachSessionMetaListener({
    chainRegistry,
    get sdkRegistry() { return sdkRegistry; },
    // Function-form so dispatchPreHost grabs the *current* pool; it
    // gets swapped on tearDownHost so the reference can change between
    // unlock cycles. (See sessionMeta.js handling of `signerPool`.)
    signerPool: () => signerPool,
    onUnlocked: () => {
        // Drop any stale cross-session auto-lock state; the popup re-arms the
        // backstop (with the correct idleMs + demo-skip) once Home mounts.
        clearAutoLockState().catch(() => { /* best-effort */ });
        lastActivityStampAt = 0;
        return ensureHost().catch((err) => {
            console.error('[xchain] ensureHost after unlock failed:', err);
        });
    },
    onLocked: () => {
        clearAutoLockState().catch(() => { /* best-effort */ });
        tearDownHost();
    },
});

// Signer bridge: always on, independent of vault unlock state. The
// popup opens a long-lived 'signer-bridge' port when the user pairs
// a HW device; this listener wraps the port as a transport in
// `signerBridge` so `action.send.hw` / `signer.status` handlers can
// route sign requests to the renderer-hosted signer.
attachSignerBridgeListener();

// §46: MV3 keepalive. Chrome evicts an idle service worker after ~30s, which
// would silently tear down the notification WebSocket. A periodic alarm wakes
// the worker; the wake re-runs this module (rebuilding the host + watcher) and,
// on an already-warm worker, ensureHost() re-subscribes any addresses the WS
// dropped. ~24s period stays under the eviction window.
if (typeof chrome !== 'undefined' && chrome.alarms) {
    chrome.alarms.create('xchain-ws-keepalive', { periodInMinutes: 0.4 });
    chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name !== 'xchain-ws-keepalive') return;
        ensureHost()
            .then(() => notificationService && notificationService.refresh())
            // §26 auto-lock backstop: every keepalive tick (~24s) also checks
            // whether the unlocked session has gone idle past the configured
            // timeout with the popup closed, and locks if so.
            .then(() => maybeAutoLock())
            .catch((err) => console.error('[xchain] keepalive ensureHost failed:', err));
    });
}

ensureHost().catch((err) => {
    console.error('[xchain] background init failed:', err);
});

console.log('[xchain] background service worker ready');
