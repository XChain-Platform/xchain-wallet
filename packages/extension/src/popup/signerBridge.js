// Popup-side signer bridge. Opens a long-lived `chrome.runtime`
// port at module import, holds a Map<signerId, live Signer>, and
// forwards sign requests from the background through the core
// `signerPortProtocol` helpers.
//
// Live signer instances come from the pair flow (§17.6): when the
// user completes pairing, `PairSignerForm` calls `registerSigner`
// here with the persisted SignerRecord's id and the live
// TrezorSigner / LedgerSigner instance the factory produced. The
// bridge announces the signerId to the background via the port;
// background's `signerBridge` captures a transport function keyed
// by the id. Subsequent `action.*.hw` handlers find the transport,
// wrap it in a `RemoteSigner`, and call through.
//
// When the popup closes, the port disconnects; background's
// `signerBridge` drops the registration; in-flight signPsbt calls
// reject with "signer bridge disconnected". The next popup open
// re-opens the port and re-registers.

import { signers } from '@xchain-wallet/core';

const { bindRendererPortBridge } = signers;

/** @type {Map<string, import('@xchain-wallet/core/signers/Signer.js').Signer>} */
const liveSigners = new Map();

let portHandle = null;
let bridgeHandle = null;

/**
 * Open (or reuse) a signer-bridge port to the background service
 * worker. Called lazily on first `registerSigner` so popup-open
 * code paths that don't touch HW don't pay the port-setup cost.
 */
function ensurePort() {
    if (portHandle && bridgeHandle) return { port: portHandle, bridge: bridgeHandle };
    const chromeRuntime = /** @type {any} */ (globalThis).chrome?.runtime;
    if (!chromeRuntime?.connect) {
        throw new Error('signerBridge: chrome.runtime.connect is not available');
    }
    const port = chromeRuntime.connect({ name: 'signer-bridge' });
    const bridge = bindRendererPortBridge(port, {
        getSigner: (id) => liveSigners.get(id) ?? null,
    });
    port.onDisconnect?.addListener(() => {
        portHandle = null;
        bridgeHandle = null;
    });
    portHandle = port;
    bridgeHandle = bridge;
    // Announce any signers registered before the port opened.
    if (liveSigners.size > 0) {
        bridge.announce(liveSigners.keys());
    }
    return { port, bridge };
}

/**
 * Register a live Signer instance so background-initiated sign
 * requests for its id can reach it. Called by the pair flow after
 * `messaging.registerSigner` persists the SignerRecord — we use
 * the record's id as the key so the descriptor built by
 * `resolveSigner` (which reads the same id from the vault) matches.
 *
 * @param {string} signerId   SignerRecord id
 * @param {import('@xchain-wallet/core/signers/Signer.js').Signer} signer
 */
export function registerSigner(signerId, signer) {
    if (typeof signerId !== 'string' || signerId.length === 0) {
        throw new Error('signerBridge.registerSigner: signerId is required');
    }
    if (!signer || typeof signer.signPsbt !== 'function') {
        throw new Error('signerBridge.registerSigner: signer must implement Signer');
    }
    liveSigners.set(signerId, signer);
    const { bridge } = ensurePort();
    bridge.announce([signerId]);
}

/**
 * Remove a Signer from the bridge (e.g., user unpaired the device).
 *
 * @param {string} signerId
 */
export function unregisterSigner(signerId) {
    if (!liveSigners.has(signerId)) return;
    liveSigners.delete(signerId);
    if (portHandle) {
        try {
            portHandle.postMessage({ kind: 'unregister', signerIds: [signerId] });
        } catch { /* port may be mid-disconnect */ }
    }
}

/**
 * Diagnostic — currently registered signer ids.
 * @returns {string[]}
 */
export function registeredIds() {
    return Array.from(liveSigners.keys());
}

/**
 * Test hook — drop all live signers and the port reference.
 * Production code has no reason to call this.
 */
export function _resetForTests() {
    liveSigners.clear();
    if (bridgeHandle) bridgeHandle.dispose();
    portHandle = null;
    bridgeHandle = null;
}
