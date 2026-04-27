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

import { registry as registryLib, sdk as sdkLib, signers as signersLib, storage as storageLib } from '@xchain-wallet/core';
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
    host = createBackgroundHost({
        vault,
        chainRegistry,
        sdkRegistry,
        signerPool,
        approvals: approvalBroker,
    });
    detachHost = attachChromeRuntime(host);
    return host;
}

/**
 * Release the host + close the vault so a subsequent unlock starts from
 * a clean slate. Called by the wallet.lock handler via the onLocked
 * callback; also safe to call from any cleanup path (e.g. panic mode).
 */
function tearDownHost() {
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

// Kick ensureHost on startup — no-ops when there's no session.
ensureHost().catch((err) => {
    console.error('[xchain] background init failed:', err);
});

// Log a marker so dev inspection confirms the bundle loaded.
console.log('[xchain] background service worker ready');
