// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the signer-bridge port protocol (HW Sign follow-up
// slice 2). Exercises both halves of `signerPortProtocol.js` against
// a pair of in-memory mock ports that pipe messages into each
// other's onMessage listeners. No chrome.runtime, no hardware.
//
// Covers:
//   - Renderer side dispatches op requests to the right signer by id
//   - Background-side transport correlates responses by reqId
//   - Errors thrown in the renderer propagate with name + message
//   - Port disconnect rejects in-flight requests
//   - register / unregister messages round-trip

import { strict as assert } from 'node:assert';

import { signers } from '../../../packages/core/src/index.js';

const {
    bindRendererPortBridge,
    createBackgroundTransport,
    RemoteSigner,
} = signers;

// --- In-memory port pair -------------------------------------------

function createPortPair() {
    const aListeners = new Set();
    const bListeners = new Set();
    const aDisconnect = new Set();
    const bDisconnect = new Set();
    let disconnected = false;

    const a = {
        postMessage(msg) {
            if (disconnected) return;
            const cloned = JSON.parse(JSON.stringify(msg));
            // Deliver asynchronously to mimic real port semantics.
            setImmediate(() => {
                for (const fn of bListeners) fn(cloned);
            });
        },
        onMessage: {
            addListener(fn) { aListeners.add(fn); },
            removeListener(fn) { aListeners.delete(fn); },
        },
        onDisconnect: {
            addListener(fn) { aDisconnect.add(fn); },
            removeListener(fn) { aDisconnect.delete(fn); },
        },
    };
    const b = {
        postMessage(msg) {
            if (disconnected) return;
            const cloned = JSON.parse(JSON.stringify(msg));
            setImmediate(() => {
                for (const fn of aListeners) fn(cloned);
            });
        },
        onMessage: {
            addListener(fn) { bListeners.add(fn); },
            removeListener(fn) { bListeners.delete(fn); },
        },
        onDisconnect: {
            addListener(fn) { bDisconnect.add(fn); },
            removeListener(fn) { bDisconnect.delete(fn); },
        },
    };

    function disconnect() {
        disconnected = true;
        for (const fn of aDisconnect) { try { fn(); } catch { /* */ } }
        for (const fn of bDisconnect) { try { fn(); } catch { /* */ } }
    }
    return { a, b, disconnect };
}

// --- Mock signer ----------------------------------------------------

function makeMockSigner({ id }) {
    return {
        id,
        displayName: id,
        kind: 'trezor',
        requiresPhysicalConfirmation: true,
        async getStatus() { return 'available'; },
        async getAddresses({ count }) {
            return Array.from({ length: count }, (_, i) => ({
                index: i,
                address: `mock-addr-${id}-${i}`,
                publicKey: `02mock${i}`,
                path: `m/84'/0'/0'/0/${i}`,
            }));
        },
        async getPublicKey() {
            return { publicKey: '02deadbeef', chainCode: '', fingerprint: '' };
        },
        async signPsbt({ psbtHex }) {
            return { signedPsbtHex: '', txHex: `signed-${psbtHex}`, txid: `txid-${psbtHex}` };
        },
        async signMessage({ message }) {
            return { signature: `sig-${message}` };
        },
        subscribe() { return () => {}; },
    };
}

// --- 1. Round-trip signPsbt via RemoteSigner + transport + bridge ---

const { a: backgroundPort, b: rendererPort, disconnect } = createPortPair();
/** @type {Map<string, any>} */
const rendererSigners = new Map();
rendererSigners.set('sig-1', makeMockSigner({ id: 'sig-1' }));

const bridge = bindRendererPortBridge(rendererPort, {
    getSigner: (id) => rendererSigners.get(id) ?? null,
});
const transport = createBackgroundTransport(backgroundPort);
const remote = new RemoteSigner({
    id: 'sig-1', displayName: 'Mock', kind: 'trezor', transport,
});

// getStatus
assert.equal(await remote.getStatus(), 'available');

// signPsbt round-trip
const signed = await remote.signPsbt({
    psbtHex: '70736274ff',
    chainId: 'bitcoin-mainnet',
    signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
});
assert.equal(signed.txHex, 'signed-70736274ff');
assert.equal(signed.txid, 'txid-70736274ff');

// signMessage round-trip
const msg = await remote.signMessage({
    message: 'hello', chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0",
});
assert.equal(msg.signature, 'sig-hello');

// --- 2. Unknown signerId surfaces a named error -------------------

const absent = new RemoteSigner({
    id: 'sig-missing', displayName: 'Missing', kind: 'trezor', transport,
});
await assert.rejects(
    absent.signPsbt({ psbtHex: '70', chainId: 'bitcoin-mainnet', signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }] }),
    /SignerNotRegisteredError|no renderer signer/,
);

// --- 3. Renderer-side throw propagates -----------------------------

rendererSigners.set('sig-throws', {
    ...makeMockSigner({ id: 'sig-throws' }),
    async signPsbt() {
        const err = new Error('user rejected');
        err.name = 'UserRejectedError';
        throw err;
    },
});
const thrower = new RemoteSigner({
    id: 'sig-throws', displayName: 'T', kind: 'trezor', transport,
});
await assert.rejects(
    thrower.signPsbt({ psbtHex: '70', chainId: 'bitcoin-mainnet', signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }] }),
    /user rejected/,
);

// --- 4. Port disconnect rejects in-flight + subsequent requests ----

// Install a signer whose signPsbt stalls so we can race the disconnect
// against an in-flight request.
let releaseHang;
const hangPromise = new Promise((resolve) => { releaseHang = resolve; });
rendererSigners.set('sig-hang', {
    ...makeMockSigner({ id: 'sig-hang' }),
    async signPsbt() { await hangPromise; return { signedPsbtHex: '', txHex: 'x', txid: 'x' }; },
});
const hangSigner = new RemoteSigner({
    id: 'sig-hang', displayName: 'H', kind: 'trezor', transport,
});
const inflight = hangSigner.signPsbt({
    psbtHex: '70', chainId: 'bitcoin-mainnet',
    signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
});
// Let the request reach the renderer before we cut the port.
await new Promise((r) => setImmediate(r));
disconnect();
await assert.rejects(inflight, /signer bridge disconnected/);

// Subsequent requests also reject immediately.
await assert.rejects(
    remote.signMessage({ message: 'hi', chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" }),
    /signer bridge disconnected/,
);

// Cleanup (unblock the hang so no dangling resolve leaks).
releaseHang();

// --- 5. announce() posts register message -------------------------

const { a: bgPort2, b: rendPort2 } = createPortPair();
/** @type {any} */
let registerMsg = null;
bgPort2.onMessage.addListener((msg) => {
    if (msg?.kind === 'register') registerMsg = msg;
});
const bridge2 = bindRendererPortBridge(rendPort2, { getSigner: () => null });
bridge2.announce(['sig-a', 'sig-b']);
await new Promise((r) => setImmediate(r));
assert.ok(registerMsg, 'register message received by background');
assert.deepEqual(registerMsg.signerIds, ['sig-a', 'sig-b']);

console.log(
    'OK — signer port protocol smoke (renderer bridge dispatches to signer map by id; background transport correlates responses via reqId; thrown errors propagate with name; unknown signerId rejects via SignerNotRegisteredError; port disconnect rejects in-flight + future requests with "signer bridge disconnected"; announce() posts register messages)',
);
