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

import { registry as registryLib, sdk as sdkLib, storage as storageLib } from '@xchain-wallet/core';
import {
    ChromeSessionBackend,
    ChromeStorageBackend,
} from './storage/index.js';
import {
    attachChromeRuntime,
    attachSessionMetaListener,
    createBackgroundHost,
} from './background/index.js';

// The SDK factory is injected at bundle time. Shells with a live SDK
// wire it here; the infra scaffold uses a no-op factory that lets the
// extension load without a fatal crash when no SDK is present.
// Replace this with `adaptXChainSDK(XChainSDK)` when the real SDK is
// bundled for the extension (Phase 1 build-and-release work).
const scaffoldSdkFactory = () => ({
    wallet: {
        deriveAddress() { throw new Error('SDK not yet wired'); },
        signPsbt() { throw new Error('SDK not yet wired'); },
        validateAddress() { return { valid: false, type: null, network: null, error: 'SDK not wired' }; },
        broadcastTx() { return Promise.reject(new Error('SDK not yet wired')); },
        importWIF() { throw new Error('SDK not yet wired'); },
    },
    auth: {
        signMessage() { throw new Error('SDK not yet wired'); },
        verifyMessage() { return false; },
        generateChallenge() { return ''; },
    },
});

// --- Lazy wiring --------------------------------------------------------
// The service worker starts with no master key — it's in ChromeSessionBackend
// only if the user has unlocked the wallet in this browser session. Until
// that happens, MessageHost handlers that require a Vault will fail; the
// popup is responsible for prompting unlock before issuing any operation.
//
// In this scaffold we attach the runtime listener unconditionally and let
// the host report "vault not ready" via its own error envelopes.

const chainRegistry = registryLib.defaultRegistry();
const sdkRegistry = new sdkLib.SDKRegistry({
    chainRegistry,
    sdkFactory: scaffoldSdkFactory,
});

let host = null;
let vault = null;

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
    host = createBackgroundHost({ vault, chainRegistry, sdkRegistry });
    attachChromeRuntime(host);
    return host;
}

// Session-meta listener runs before the vault is open so the popup can
// ask "no-wallet / locked / unlocked?" on first render. It responds to
// `session.status` only; the host listener (attached below when a
// session key is available) handles everything else.
attachSessionMetaListener();

// Kick ensureHost on startup — no-ops when there's no session.
ensureHost().catch((err) => {
    console.error('[xchain] background init failed:', err);
});

// Log a marker so dev inspection confirms the bundle loaded.
console.log('[xchain] background service worker ready');
