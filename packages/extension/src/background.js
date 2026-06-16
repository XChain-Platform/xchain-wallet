// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// MV3 service-worker entry — the manifest's `background.service_worker`
// points at this file (bundled to dist/background.js).
//
// Responsibilities:
//   1. Stand up a Vault against ChromeStorageBackend / ChromeSessionBackend
//   2. Build a ChainRegistry + SDKRegistry (SDK factory injected by the
//      packaged bundle — the SDK is CJS and shells bundle their own
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
    createDevMockSdk,
    resolveSdkFactory,
} from './background/index.js';
import { SIGNING_SECRET_SESSION_KEY, loadSigningSecret } from './background/signingSecretSession.js';
import { createBridgeEventBroadcaster } from './bridge/bridgeEvents.js';
import {
    applyLayoutMode,
    attachLayoutModeListener,
    readLayoutMode,
} from './background/layoutMode.js';

// Apply the user's saved layout mode (popup vs sidepanel) at worker
// boot, then watch storage for live changes from the in-wallet
// settings UI. The user's preference is honoured the next time they
// click the toolbar icon — no extension reload needed.
(async () => {
    const mode = await readLayoutMode();
    await applyLayoutMode(mode);
})();
attachLayoutModeListener();

// --- Lazy wiring --------------------------------------------------------
// The service worker starts with no master key — it's in ChromeSessionBackend
// only if the user has unlocked the wallet in this browser session. Until
// that happens, MessageHost handlers that require a Vault will fail; the
// popup is responsible for prompting unlock before issuing any operation.

const chainRegistry = registryLib.defaultRegistry();

// Build the SDKRegistry against the dev mock synchronously so the
// service worker can register handlers immediately, then swap in the
// real `xchain-sdk`-backed factory once the dynamic import settles.
// Callers that need to wait on real-SDK availability can await
// `sdkResolved` before issuing sign / broadcast requests.
let sdkRegistry = new sdkLib.SDKRegistry({
    chainRegistry,
    sdkFactory: createDevMockSdk,
});

export const sdkResolved = resolveSdkFactory({ devMockFactory: createDevMockSdk })
    .then((result) => {
        sdkRegistry = new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: result.factory,
        });
        return result.source;
    })
    .catch(() => 'dev-mock');

// Module-scoped so the broker survives across unlock / lock cycles —
// rejecting any pending approval on window-close continues to work even
// if no wallet is unlocked.
const approvalBroker = new ApprovalBroker();

let host = null;
let vault = null;
let detachHost = null;
// §46 — live notification watcher. Module-scoped so it survives across the
// keepalive's repeated ensureHost() calls; recreated from scratch when the MV3
// worker is evicted and cold-restarts.
let notificationService = null;
// §46 price-alert poll watcher — paired with notificationService, same
// guard + cold-restart semantics.
let priceAlertWatcher = null;

// §46 delivery adapter for the extension: chrome.notifications works with the
// popup closed (it's the service worker firing, not a page). type 'basic'
// requires an iconUrl — reuse the packaged action icon.
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

    host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        signerPool,
        approvals: approvalBroker,
        // §43.2 / Cluster F FOLLOWUP 1 — fan-out for bridge events so
        // dApps subscribed via provider.on(...) get accountsChanged /
        // chainChanged / disconnect when the wallet mutates connected
        // site state. Background uses chrome.tabs to find tabs sitting
        // on the matching origin.
        bridgeEvents: typeof chrome !== 'undefined' && chrome.tabs
            ? createBridgeEventBroadcaster({ tabs: chrome.tabs, runtime: chrome.runtime })
            : undefined,
        // §50 / Cluster L FOLLOWUP 4 — shell-specific diagnostic env + build.
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
    detachHost = attachChromeRuntime(host);

    // §46 — start the live notification watcher once a vault is open. Guarded
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

    // §46 — start the price-alert poll watcher. Its own oracle instance
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
    // Replace rather than null — sessionMeta passes the pool by
    // reference at construction time; swapping in a fresh empty pool
    // keeps that reference stable for the next unlock.
    signerPool = new signersLib.SignerPool();
    host = null;
}

// Pre-host listener runs before the vault is open so the popup can ask
// "no-wallet / locked / unlocked?" and perform `wallet.unlock` — both
// of which need to work when the vault is still encrypted. The host
// listener (attached inside `ensureHost` once a session key is present)
// picks up everything else. See sessionMeta.PRE_HOST_MESSAGE_TYPES.
attachSessionMetaListener({
    chainRegistry,
    get sdkRegistry() { return sdkRegistry; },
    // Function-form so dispatchPreHost grabs the *current* pool — it
    // gets swapped on tearDownHost so the reference can change between
    // unlock cycles. (See sessionMeta.js handling of `signerPool`.)
    signerPool: () => signerPool,
    onUnlocked: () =>
        ensureHost().catch((err) => {
            console.error('[xchain] ensureHost after unlock failed:', err);
        }),
    onLocked: () => {
        tearDownHost();
    },
});

// Signer bridge — always on, independent of vault unlock state. The
// popup opens a long-lived 'signer-bridge' port when the user pairs
// a HW device; this listener wraps the port as a transport in
// `signerBridge` so `action.send.hw` / `signer.status` handlers can
// route sign requests to the renderer-hosted signer.
attachSignerBridgeListener();

// §46 — MV3 keepalive. Chrome evicts an idle service worker after ~30s, which
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
            .catch((err) => console.error('[xchain] keepalive ensureHost failed:', err));
    });
}

// Kick ensureHost on startup — no-ops when there's no session.
ensureHost().catch((err) => {
    console.error('[xchain] background init failed:', err);
});

// Log a marker so dev inspection confirms the bundle loaded.
console.log('[xchain] background service worker ready');
