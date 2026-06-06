// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Desktop renderer-side signer bridge. Mirrors the extension popup's
// signerBridge: keeps a Map<signerId, live Signer> locally, and
// exposes the signer's methods back to the main process over the
// preload-bridged `xchainWalletSignerBridge` ipc channel.
//
// Web shares a JS context with its "background" and can set the
// bgSignerBridge transport directly; desktop cannot. The main
// process lives in a separate V8 context and reaches the renderer's
// live Signer instance only via ipc, so we wrap the preload's
// postMessage/onMessage into the neutral `PortLike` the core
// `signerPortProtocol` helpers expect.
//
// Module-scoped singleton: renderer App mounts once per window, and
// the preload bridge is unique to that window. If the main-process
// bridge has already registered signer ids before the renderer loads
// (restart mid-flight), the announce-on-register + the main side's
// lazy per-webContents entry together ensure the id is reachable
// after the first register message arrives.

// Cross-package relative path so smoke tests (plain Node) resolve
// without the pnpm workspace symlink. Vite picks up either form.
import { bindRendererPortBridge } from '../../core/src/signers/index.js';

/** @type {Map<string, import('@xchain-wallet/core/signers/Signer.js').Signer>} */
const liveSigners = new Map();

let bridgeHandle = null;

function ensureBridge() {
    if (bridgeHandle) return bridgeHandle;
    const ipc = /** @type {any} */ (globalThis).xchainWalletSignerBridge;
    if (!ipc || typeof ipc.postMessage !== 'function' || typeof ipc.onMessage !== 'function') {
        throw new Error('signerBridge: window.xchainWalletSignerBridge not exposed by preload');
    }
    /** @type {Set<(msg:any)=>void>} */
    const listeners = new Set();
    const unsubscribe = ipc.onMessage((msg) => {
        for (const fn of listeners) {
            try { fn(msg); } catch { /* swallow listener errors */ }
        }
    });
    const port = {
        postMessage: (msg) => ipc.postMessage(msg),
        onMessage: {
            addListener: (fn) => listeners.add(fn),
            removeListener: (fn) => listeners.delete(fn),
        },
    };
    const bridge = bindRendererPortBridge(port, {
        getSigner: (id) => liveSigners.get(id) ?? null,
    });
    bridgeHandle = {
        bridge,
        dispose() {
            bridge.dispose();
            unsubscribe?.();
            bridgeHandle = null;
        },
    };
    if (liveSigners.size > 0) {
        bridge.announce(Array.from(liveSigners.keys()));
    }
    return bridgeHandle;
}

/**
 * Register a live Signer so main-process `action.*.hw` handlers can
 * reach it. Called from `PairSignerForm`'s `onSignerPaired` hook
 * after the SignerRecord is persisted in the vault.
 *
 * @param {string} signerId
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
    const { bridge } = ensureBridge();
    bridge.announce([signerId]);
}

/** @param {string} signerId */
export function unregisterSigner(signerId) {
    if (!liveSigners.delete(signerId)) return;
    try {
        /** @type {any} */ (globalThis).xchainWalletSignerBridge?.postMessage(
            { kind: 'unregister', signerIds: [signerId] },
        );
    } catch { /* ipc may be unavailable (hot reload) */ }
}

/** @returns {string[]} */
export function registeredIds() {
    return Array.from(liveSigners.keys());
}

/** Test hook — drop state so fresh instances can be constructed. */
export function _resetForTests() {
    liveSigners.clear();
    if (bridgeHandle) bridgeHandle.dispose();
    bridgeHandle = null;
}
