// Smoke for Phase 4 — Step 18 of 23 — Multisig address derivation +
// Receive integration (§22 + §42.9).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { flows } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
const desktop = join(wsRoot, 'packages', 'desktop');
const sharedRoutes = join(core, 'src', 'shared', 'routes');

// --- Core flow guards ---

assert.equal(typeof flows.receiveMultisigAddress, 'function',
    'flows.receiveMultisigAddress re-exported');
await assert.rejects(
    async () => flows.receiveMultisigAddress({}),
    /vault is required/,
);
await assert.rejects(
    async () => flows.receiveMultisigAddress({ vault: {}, sdkRegistry: {} }),
    /walletId is required/,
);
await assert.rejects(
    async () => flows.receiveMultisigAddress({
        vault: {}, sdkRegistry: {}, walletId: 'w',
    }),
    /chainId is required/,
);

// Wallet without multisig configured surfaces a clear error.
await assert.rejects(
    async () => flows.receiveMultisigAddress({
        vault: {
            wallets: {
                async get(id) { return { id, multisig: null }; },
            },
        },
        sdkRegistry: { get: () => ({ deriveMultisigAddress: () => ({ address: 'x' }) }) },
        walletId: 'w',
        chainId: 'bitcoin-mainnet',
    }),
    /no multisig configuration/,
);

// SDK without deriveMultisigAddress (older SDK) surfaces a clear bump hint.
await assert.rejects(
    async () => flows.receiveMultisigAddress({
        vault: {
            wallets: {
                async get(id) {
                    return {
                        id,
                        multisig: {
                            scheme: 'p2wsh-multisig',
                            threshold: 2,
                            scriptTemplate: 'multi:2:02ab:03cd',
                            cosigners: [
                                { name: 'A' }, { name: 'B' },
                            ],
                        },
                    };
                },
            },
        },
        sdkRegistry: { get: () => ({ /* no deriveMultisigAddress */ }) },
        walletId: 'w',
        chainId: 'bitcoin-mainnet',
    }),
    /xchain-sdk to \^1\.11\.0/,
);

// Happy path — SDK returns an address; flow assembles the result.
const happy = await flows.receiveMultisigAddress({
    vault: {
        wallets: {
            async get(id) {
                return {
                    id,
                    multisig: {
                        scheme: 'p2wsh-multisig',
                        threshold: 2,
                        scriptTemplate: 'multi:2:02ab:03cd',
                        cosigners: [
                            { name: 'Alice' },
                            { name: 'Bob' },
                            { name: 'Carol' },
                        ],
                    },
                };
            },
        },
    },
    sdkRegistry: {
        get(_chainId) {
            return {
                deriveMultisigAddress(params) {
                    return {
                        address: 'bc1q-fake-' + params.scheme,
                        scheme: params.scheme,
                        redeemScript: null,
                        witnessScript: 'aabbcc',
                        outputPubkey: null,
                    };
                },
            };
        },
    },
    walletId: 'w',
    chainId: 'bitcoin-mainnet',
});
assert.equal(happy.address, 'bc1q-fake-p2wsh-multisig');
assert.equal(happy.threshold, 2);
assert.equal(happy.cosignerCount, 3);
assert.deepEqual(happy.cosignerNames, ['Alice', 'Bob', 'Carol']);
assert.equal(happy.schemeLabel, '2-of-3 P2WSH multisig');

// --- Background host ---

const bg = readFileSync(join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8');
assert.ok(bg.includes("'multisig.receiveAddress'"),
    'background host registers multisig.receiveAddress');
assert.ok(/receiveMultisigAddress\b/.test(bg),
    'background host imports receiveMultisigAddress');

// --- Shell messaging helpers ---

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
    ['desktop', join(desktop, 'renderer', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    assert.ok(/export function getMultisigReceiveAddress\b/.test(m),
        `${shell} messaging.js exports getMultisigReceiveAddress`);
}

// --- Receive route integration ---

const receive = readFileSync(join(sharedRoutes, 'Receive.jsx'), 'utf8');
assert.ok(/messaging\.getMultisigReceiveAddress/.test(receive),
    'Receive route fetches the multisig address');
assert.ok(/aria-label="Multisig receive address"/.test(receive),
    'Receive renders a labeled multisig section');
assert.ok(/threshold.*-of-.*cosignerCount|cosignerCount.*-of-.*threshold/.test(receive)
    || /multisig\.threshold.*multisig\.cosignerCount/.test(receive),
    'Receive renders an N-of-M indicator');
assert.ok(/multisig\.schemeLabel/.test(receive),
    'Receive renders the scheme label badge');
assert.ok(/cosignerNames/.test(receive),
    'Receive surfaces cosigner names');

// --- SDK pin bumped to 1.11.0 ---

for (const [shell, pkgPath] of [
    ['extension', join(ext, 'package.json')],
    ['web', join(web, 'package.json')],
]) {
    const pkg = readFileSync(pkgPath, 'utf8');
    assert.ok(/"xchain-sdk":\s*"\^1\.11\.0"/.test(pkg),
        `${shell} pkg pins xchain-sdk ^1.11.0`);
}

console.log(
    'OK — multisig address smoke (receiveMultisigAddress flow guards + missing multisig config error + missing SDK 1.11 hint + happy-path result shape + bg handler + 3-shell messaging exports + Receive route integration with N-of-M indicator + scheme label + cosigner names + SDK pin bumped to ^1.11.0)',
);
