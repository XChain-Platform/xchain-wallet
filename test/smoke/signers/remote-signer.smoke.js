// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for HW Sign Step 4: RemoteSigner class.
//
// RemoteSigner implements the Signer interface by forwarding every
// call over an injected transport function. Background-process flows
// construct one of these so `submitWithSigner` can drive HW signing
// that physically runs in the renderer (WebHID transports + Trezor
// Connect popups need a user gesture + tab anchor; neither works in
// an MV3 service worker).
//
// This smoke exercises the shim against a hand-written mock transport
// that records every op + payload; no real messaging channel, no
// real signer, just the forwarding contract.

import { strict as assert } from 'node:assert';

import { signers } from '../../../packages/core/src/index.js';

const { RemoteSigner } = signers;

// --- 1. Constructor guard-rails --------------------------------------

assert.throws(() => new RemoteSigner({}), /id is required/);
assert.throws(() => new RemoteSigner({ id: 'x' }), /displayName is required/);
assert.throws(
    () => new RemoteSigner({ id: 'x', displayName: 'y', kind: 'software', transport: () => {} }),
    /kind must be 'trezor' or 'ledger'/,
);
assert.throws(
    () => new RemoteSigner({ id: 'x', displayName: 'y', kind: 'trezor' }),
    /transport must be a function/,
);

// --- 2. Basic Signer interface conformance ---------------------------

const calls = [];
function makeMockTransport(handlers = {}) {
    return async ({ op, payload }) => {
        calls.push({ op, payload });
        if (typeof handlers[op] === 'function') return handlers[op](payload);
        return null;
    };
}

const shim = new RemoteSigner({
    id: 'remote-sig-1',
    displayName: 'My Trezor',
    kind: 'trezor',
    transport: makeMockTransport({
        status: async () => 'available',
        getAddresses: async () => [
            { index: 0, address: 'bc1qaaa', publicKey: '02aa', path: "m/84'/0'/0'/0/0" },
            { index: 1, address: 'bc1qbbb', publicKey: '02bb', path: "m/84'/0'/0'/0/1" },
        ],
        getPublicKey: async () => ({ publicKey: '02deadbeef', chainCode: 'cc', fingerprint: 'ff' }),
        signPsbt: async () => ({ signedPsbtHex: '', txHex: '02deadbeef', txid: 'abc123' }),
        signMessage: async () => ({ signature: 'base64sig==' }),
    }),
});

assert.equal(shim.id, 'remote-sig-1');
assert.equal(shim.displayName, 'My Trezor');
assert.equal(shim.kind, 'trezor');
assert.equal(shim.requiresPhysicalConfirmation, true);

// --- 3. getStatus: various response shapes ---------------------------

assert.equal(await shim.getStatus(), 'available', 'string response passes through');

const shim2 = new RemoteSigner({
    id: 'r2', displayName: 'L', kind: 'ledger',
    transport: makeMockTransport({ status: async () => ({ status: 'wrong-app', detail: 'open the Bitcoin app' }) }),
});
assert.equal(await shim2.getStatus(), 'wrong-app', 'object { status } response');

const shim3 = new RemoteSigner({
    id: 'r3', displayName: 'L', kind: 'ledger',
    transport: async () => { throw new Error('cable unplugged'); },
});
assert.equal(await shim3.getStatus(), 'disconnected', 'transport throw → disconnected');

// --- 4. getAddresses / getPublicKey -----------------------------------

const addrs = await shim.getAddresses({
    chainId: 'bitcoin-mainnet',
    accountIndex: 0,
    change: 0,
    startIndex: 0,
    count: 2,
    addressType: 'p2wpkh',
});
assert.equal(addrs.length, 2);
assert.equal(addrs[0].path, "m/84'/0'/0'/0/0");

// The transport was called with `signerId` threaded into every payload.
const addrsCall = calls.find((c) => c.op === 'getAddresses');
assert.equal(addrsCall.payload.signerId, 'remote-sig-1');
assert.equal(addrsCall.payload.chainId, 'bitcoin-mainnet');

const pk = await shim.getPublicKey({ chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" });
assert.equal(pk.publicKey, '02deadbeef');
assert.equal(pk.fingerprint, 'ff');

// --- 5. signPsbt / signMessage ---------------------------------------

const signed = await shim.signPsbt({
    psbtHex: '70736274ff01',
    chainId: 'bitcoin-mainnet',
    signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
});
assert.equal(signed.txHex, '02deadbeef');
assert.equal(signed.txid, 'abc123');
assert.equal(signed.signedPsbtHex, '');

const signMsg = await shim.signMessage({ message: 'hi', chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" });
assert.equal(signMsg.signature, 'base64sig==');

// --- 6. Malformed response shapes are caught -------------------------

const badSigPsbtShim = new RemoteSigner({
    id: 'r-bad', displayName: 'X', kind: 'trezor',
    transport: makeMockTransport({ signPsbt: async () => ({ signedPsbtHex: '' }) }),
});
await assert.rejects(
    badSigPsbtShim.signPsbt({ psbtHex: '70', chainId: 'bitcoin-mainnet', signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }] }),
    /malformed result/,
);

const badSignMsgShim = new RemoteSigner({
    id: 'r-bad2', displayName: 'X', kind: 'ledger',
    transport: makeMockTransport({ signMessage: async () => ({}) }),
});
await assert.rejects(
    badSignMsgShim.signMessage({ message: 'hi', chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" }),
    /no signature/,
);

// Bad getAddresses response.
const badAddrsShim = new RemoteSigner({
    id: 'r-bad3', displayName: 'X', kind: 'trezor',
    transport: makeMockTransport({ getAddresses: async () => ({ not: 'array' }) }),
});
await assert.rejects(
    badAddrsShim.getAddresses({
        chainId: 'bitcoin-mainnet', accountIndex: 0, change: 0, startIndex: 0, count: 1,
    }),
    /non-array/,
);

// --- 7. Transport failure wraps into SignerStatusError ---------------

const failShim = new RemoteSigner({
    id: 'r-fail', displayName: 'X', kind: 'trezor',
    transport: async () => { throw new Error('user cancelled'); },
});
await assert.rejects(
    failShim.signPsbt({
        psbtHex: '70', chainId: 'bitcoin-mainnet', signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
    }),
    /signPsbt failed: user cancelled/,
);

// --- 8. Subscribe is inherited from the base class --------------------

let statusUpdates = 0;
const unsub = shim.subscribe(() => { statusUpdates += 1; });
assert.equal(typeof unsub, 'function');
unsub();

console.log(
    'OK: remote signer smoke (Signer-interface forwarding via injected transport; status/addresses/publicKey/signPsbt/signMessage payloads carry signerId; transport throw → SignerStatusError; malformed remote results rejected)',
);
