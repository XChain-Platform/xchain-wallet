// Smoke test for Batch 4 piece 13 (Send view).
//
// Send's happy path (sign + broadcast) depends on the real xchain-sdk
// which isn't bundled yet. This smoke exercises what CAN be verified
// deterministically today:
//
//   1. Static wiring — Send.jsx exists with the expected stages
//      (form / review / submitting / done), validation rules (memo,
//      amount, word counts), messaging.sendAsset helper present, App
//      sub-route + Home onSend prop activated.
//   2. Messaging round-trip — `sendAsset` goes through `action.send`
//      which reaches the core flow, which blows up on the dev-SDK
//      stub at the encoder step. The flow still wraps the error in
//      the host's response envelope, so the popup side gets a
//      structured error (not a hang). Verifying this guarantees the
//      UX "Send failed — <reason>" path stays wired.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import { crypto as cryptoLib } from '../../core/src/index.js';
import { IndexedDBStorageBackend } from '../../web/src/storage/IndexedDBStorageBackend.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const webPkg = join(wsRoot, 'packages', 'web');

// --- 1. Static wiring -------------------------------------------------

const send = readFileSync(join(webPkg, 'src', 'routes', 'Send.jsx'), 'utf8');
for (const stage of ['form', 'review', 'submitting', 'done']) {
    assert.ok(send.includes(`'${stage}'`), `Send.jsx handles stage "${stage}"`);
}
assert.ok(/sendAsset\(\{/.test(send), 'Send.jsx calls sendAsset');
assert.ok(
    /\[\|;\]/.test(send),
    'Send.jsx rejects | and ; in memo (protocol constraint)',
);
assert.ok(
    /Number\(amt\) <= 0/.test(send),
    'Send.jsx validates positive amount',
);
assert.ok(
    send.includes("'InvalidPasswordError'"),
    'Send.jsx distinguishes wrong password from other errors',
);
assert.ok(
    /inputMode="decimal"/.test(send),
    'amount input uses decimal input mode',
);

const app = readFileSync(join(webPkg, 'src', 'App.jsx'), 'utf8');
assert.ok(app.includes('<Send'), 'App.jsx renders Send route');
assert.ok(
    app.includes("'send'"),
    'App.jsx tracks unlockedView === send sub-route',
);
assert.ok(
    app.includes('activeWalletId'),
    'App.jsx caches activeWalletId for Send',
);

const home = readFileSync(join(webPkg, 'src', 'routes', 'Home.jsx'), 'utf8');
assert.ok(
    /onSend/.test(home) && /onClick=\{onSend\}/.test(home),
    'Home.jsx activates Send button via onSend',
);

const msg = readFileSync(join(webPkg, 'src', 'messaging.js'), 'utf8');
assert.ok(
    /export function sendAsset\b/.test(msg),
    'messaging.js exports sendAsset',
);
assert.ok(
    msg.includes("'action.send'"),
    'sendAsset helper targets action.send',
);

// --- 2. End-to-end: sendAsset through the host lands on the SDK stub
//        and surfaces the error cleanly (not a crash / not a hang) -----

function makeFakeLocalStorage() {
    let store = {};
    return {
        getItem(k) { return store[k] ?? null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; },
    };
}
function makeFakeKvStore() {
    const map = new Map();
    return {
        async get(k) { return map.get(k); },
        async set(k, v) { map.set(k, v); },
        async delete(k) { map.delete(k); },
    };
}

globalThis.localStorage = makeFakeLocalStorage();
const fakeKv = makeFakeKvStore();
const originalOpen = IndexedDBStorageBackend.prototype._openStore;
IndexedDBStorageBackend.prototype._openStore = function _openStore() {
    this._store = fakeKv;
    return Promise.resolve(fakeKv);
};

const hostBridge = await import('../../web/src/hostBridge.js');

// Create a wallet so `action.send` has something to resolve against.
const password = 'testpassword123';
await hostBridge.createWalletLocal({
    password,
    name: 'Sender',
    strengthBits: 128,
});

const wallets = /** @type {any[]} */ (await hostBridge.sendMessage('wallet.list'));
const walletId = wallets[0].id;

const byChain = /** @type {any} */ (
    await hostBridge.sendMessage('addresses.byChain', { walletId })
);
const chainId = 'bitcoin-mainnet';
const [src] = byChain[chainId] || [];
assert.ok(src, 'bitcoin-mainnet has a derived source address');

let thrown = null;
try {
    await hostBridge.sendMessage('action.send', {
        walletId,
        password,
        chainId,
        from: {
            address: src.address,
            publicKey: src.publicKey,
            derivationPath: src.derivationPath,
            addressId: src.id,
        },
        to: src.address, // reuse self-address; encoder will reject on the stub SDK
        asset: 'BTC',
        amount: '100',
    });
} catch (err) {
    thrown = err;
}
assert.ok(thrown, 'Send against dev-SDK stub surfaces an error');
// The error message varies by exactly which step the stub trips on —
// accept any of the obvious "SDK not wired" surfaces.
assert.match(
    thrown.message,
    /xchain-sdk|not yet wired|encoder|createAction/i,
    `expected SDK-stub error, got: ${thrown.message}`,
);

IndexedDBStorageBackend.prototype._openStore = originalOpen;

console.log(
    'OK — web send smoke (static wiring + sendAsset error surface against dev-SDK stub)',
);
