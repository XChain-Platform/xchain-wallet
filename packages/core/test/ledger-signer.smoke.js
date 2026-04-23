// Smoke for Phase 2 — Step 14 (piece 4c) — LedgerSigner class +
// per-target WebHID transport factory.
//
// Mirrors trezor-signer.smoke.js: DI mock of the Ledger Bitcoin app,
// interface-conformance checks, getStatus / getAddresses /
// getPublicKey coverage, signPsbt + signMessage deferred, factory
// declared in both shell packages, core has zero Ledger SDK imports.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

// deriveLedgerDeviceIdentifier uses crypto.subtle.digest — Node 18
// exposes WebCrypto only on globalThis.crypto, matching setup.js.
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    signers,
    schemas,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');

const {
    LedgerSigner,
    deriveLedgerDeviceIdentifier,
    modelFromLedgerTransport,
} = signers;

// --- Mock Ledger app -----------------------------------------------

function makeMockApp(overrides = {}) {
    return {
        async getAppAndVersion() {
            return { name: 'Bitcoin', version: '2.2.3', flags: 0 };
        },
        async getWalletPublicKey(path) {
            return {
                publicKey: `02mockpub${path.replace(/[^0-9]/g, '')}`,
                bitcoinAddress: `mock-addr-for-${path}`,
                chainCode: 'mockchaincode',
            };
        },
        async signMessage() {
            return { v: 27, r: 'mockr', s: 'mocks' };
        },
        async createPaymentTransaction() {
            return 'mock-signed-tx';
        },
        ...overrides,
    };
}

// --- 1. Constructor guard-rails ---------------------------------------

assert.throws(() => new LedgerSigner({}), /LedgerSigner: id is required/);
assert.throws(() => new LedgerSigner({ id: 'x' }), /displayName is required/);
assert.throws(() => new LedgerSigner({ id: 'x', displayName: 'y' }), /model is required/);
assert.throws(
    () => new LedgerSigner({ id: 'x', displayName: 'y', model: 'nanoX' }),
    /deviceIdentifier is required/,
);
assert.throws(
    () => new LedgerSigner({ id: 'x', displayName: 'y', model: 'nanoX', deviceIdentifier: 'd' }),
    /app is required/,
);

// --- 2. Signer interface conformance ----------------------------------

const app = makeMockApp();
const signer = new LedgerSigner({
    id: 'ledger-mockid',
    displayName: 'Ledger (nanoX)',
    model: 'nanoX',
    deviceIdentifier: 'mockid',
    app,
});
assert.equal(signer.kind, 'ledger');
assert.equal(signer.requiresPhysicalConfirmation, true);
assert.equal(signer.model, 'nanoX');

// --- 3. getStatus: available / wrong-app / disconnected ---------------

assert.equal(
    await signer.getStatus({ chainId: 'bitcoin-mainnet' }),
    'available',
    'Bitcoin app open → available on bitcoin-mainnet',
);
assert.equal(
    await signer.getStatus({ chainId: 'litecoin-mainnet' }),
    'wrong-app',
    'Bitcoin app open → wrong-app on litecoin-mainnet',
);
assert.equal(
    await signer.getStatus(),
    'available',
    'no chainId → accepts any app',
);

const dcApp = makeMockApp({
    async getAppAndVersion() { throw new Error('cable unplugged'); },
});
const dcSigner = new LedgerSigner({
    id: 'ledger-dc', displayName: 'X', model: 'nanoX', deviceIdentifier: 'mockid', app: dcApp,
});
assert.equal(await dcSigner.getStatus(), 'disconnected');

// --- 4. getAddresses derives the right paths --------------------------

const addrs = await signer.getAddresses({
    chainId: 'bitcoin-mainnet',
    accountIndex: 0,
    change: 0,
    startIndex: 0,
    count: 2,
    addressType: 'p2wpkh',
});
assert.equal(addrs.length, 2);
assert.equal(addrs[0].path, "m/84'/0'/0'/0/0");
assert.equal(addrs[1].path, "m/84'/0'/0'/0/1");

const ltcAddrs = await signer.getAddresses({
    chainId: 'litecoin-mainnet',
    accountIndex: 1,
    change: 1,
    startIndex: 5,
    count: 1,
});
assert.equal(ltcAddrs[0].path, "m/44'/2'/1'/1/5");

await assert.rejects(
    signer.getAddresses({
        chainId: 'ethereum-mainnet', accountIndex: 0, change: 0, startIndex: 0, count: 1,
    }),
    /unsupported chainId/,
);

// getWalletPublicKey failure → SignerStatusError.
const failApp = makeMockApp({
    async getWalletPublicKey() {
        const err = new Error('user rejected');
        err.statusCode = 0x6985;
        throw err;
    },
});
const failSigner = new LedgerSigner({
    id: 'ledger-fail', displayName: 'X', model: 'nanoX', deviceIdentifier: 'mockid', app: failApp,
});
await assert.rejects(
    failSigner.getAddresses({
        chainId: 'bitcoin-mainnet', accountIndex: 0, change: 0, startIndex: 0, count: 1,
    }),
    /user rejected/,
);

// --- 5. getPublicKey --------------------------------------------------

const pk = await signer.getPublicKey({
    chainId: 'bitcoin-mainnet',
    path: "m/84'/0'/0'/0/0",
});
assert.ok(pk.publicKey);
assert.equal(pk.chainCode, 'mockchaincode');
assert.equal(pk.fingerprint, '', 'Ledger does not expose a fingerprint directly');

// --- 6. signPsbt + signMessage deferred -------------------------------

await assert.rejects(
    signer.signPsbt({ psbtHex: '', chainId: 'bitcoin-mainnet', signingPaths: [] }),
    /NotImplementedError.*signPsbt/,
);
await assert.rejects(
    signer.signMessage({ message: 'hi', chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" }),
    /NotImplementedError.*signMessage/,
);

// --- 7. deriveLedgerDeviceIdentifier ---------------------------------

const id1 = await deriveLedgerDeviceIdentifier('02abcdef01234567');
const id2 = await deriveLedgerDeviceIdentifier('02abcdef01234567');
assert.equal(id1, id2, 'deterministic on same input');
assert.equal(id1.length, 16, '16 hex chars (8 bytes)');
const id3 = await deriveLedgerDeviceIdentifier('03fedcba98765432');
assert.notEqual(id1, id3, 'different input → different id');

await assert.rejects(
    deriveLedgerDeviceIdentifier(''),
    /publicKeyHex is required/,
);
await assert.rejects(
    deriveLedgerDeviceIdentifier('abc'),
    /even length/,
);

// --- 8. modelFromLedgerTransport --------------------------------------

assert.equal(modelFromLedgerTransport({ id: 'nanoS' }), 'nanoS');
assert.equal(modelFromLedgerTransport({ id: 'nanoX' }), 'nanoX');
assert.equal(modelFromLedgerTransport({ id: 'stax' }), 'stax');
assert.equal(modelFromLedgerTransport(null), 'nanoX', 'falls back to nanoX');
assert.equal(modelFromLedgerTransport({ id: 'unknown' }), 'nanoX', 'unknown → nanoX fallback');

// --- 9. schemas.SIGNER_KINDS includes 'ledger' ------------------------

assert.ok(schemas.SIGNER_KINDS.includes('ledger'));

// --- 10. Factory files + package.json deps ----------------------------
//
// Step 18 hoisted the pair sequence into core's
// `signerFactories/ledger.js`. Shell factories bind transport + app
// class loaders via DI and delegate to `makeLedgerFactory`.

const coreFactory = join(core, 'src', 'signerFactories', 'ledger.js');
const extFactory = join(ext, 'src', 'signers', 'ledgerFactory.js');
const webFactory = join(web, 'src', 'signers', 'ledgerFactory.js');
assert.ok(existsSync(coreFactory), 'core signerFactories/ledger.js exists');
assert.ok(existsSync(extFactory), 'extension ledgerFactory.js exists');
assert.ok(existsSync(webFactory), 'web ledgerFactory.js exists');

const coreFactorySrc = readFileSync(coreFactory, 'utf8');
assert.ok(
    /export function makeLedgerFactory/.test(coreFactorySrc),
    'core exports makeLedgerFactory builder',
);
assert.ok(
    !/@ledgerhq/.test(stripComments(coreFactorySrc)),
    'core builder does NOT import @ledgerhq/* — DI keeps core decoupled',
);
assert.ok(
    /pairingInfo/.test(coreFactorySrc),
    'core builder returns pairingInfo — caller persists via flows.registerSigner',
);

function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

const extSrc = readFileSync(extFactory, 'utf8');
assert.ok(
    /@ledgerhq\/hw-transport-webhid/.test(extSrc),
    'extension factory references @ledgerhq/hw-transport-webhid',
);
assert.ok(
    /@ledgerhq\/hw-app-btc/.test(extSrc),
    'extension factory references @ledgerhq/hw-app-btc',
);
assert.ok(
    /export async function getLedgerTransport/.test(extSrc),
    'extension factory exports getLedgerTransport',
);
assert.ok(
    /export async function pairLedgerSigner/.test(extSrc),
    'extension factory exports pairLedgerSigner',
);
assert.ok(
    /import\(.@ledgerhq\/hw-transport-webhid.\)/.test(extSrc),
    'extension factory lazy-imports the transport',
);
assert.ok(
    /import\(.@ledgerhq\/hw-app-btc.\)/.test(extSrc),
    'extension factory lazy-imports the Bitcoin app',
);
assert.ok(
    /makeLedgerFactory/.test(extSrc),
    'extension factory delegates to core makeLedgerFactory',
);
assert.ok(
    /\.\.\/\.\.\/\.\.\/core\/src\/signerFactories\/index\.js/.test(extSrc),
    'extension factory imports core builder via cross-package relative path',
);

const webSrc = readFileSync(webFactory, 'utf8');
assert.ok(
    /\.\.\/\.\.\/\.\.\/extension\/src\/signers\/ledgerFactory\.js/.test(webSrc),
    'web factory uses cross-package relative path',
);

const extPkg = JSON.parse(readFileSync(join(ext, 'package.json'), 'utf8'));
assert.ok(extPkg.dependencies['@ledgerhq/hw-transport-webhid'], 'ext declares hw-transport-webhid');
assert.ok(extPkg.dependencies['@ledgerhq/hw-app-btc'], 'ext declares hw-app-btc');
assert.match(
    extPkg.dependencies['@ledgerhq/hw-transport-webhid'], /^\^6\./,
    'hw-transport-webhid pinned to ^6.x',
);
assert.match(
    extPkg.dependencies['@ledgerhq/hw-app-btc'], /^\^10\./,
    'hw-app-btc pinned to ^10.x',
);

const webPkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
assert.ok(webPkg.dependencies['@ledgerhq/hw-transport-webhid']);
assert.ok(webPkg.dependencies['@ledgerhq/hw-app-btc']);

// --- 11. LedgerSigner doesn't import Ledger SDK ------------------------

const ledgerSrc = readFileSync(
    join(core, 'src', 'signers', 'LedgerSigner.js'),
    'utf8',
);
assert.ok(
    !/from ['"]@ledgerhq/.test(ledgerSrc),
    'LedgerSigner class does NOT import any @ledgerhq package',
);

console.log(
    'OK — ledger signer smoke (class conforms to Signer interface against DI mock; getStatus distinguishes wrong-app / disconnected / available; getAddresses path derivation for BTC/LTC/DOGE; deriveLedgerDeviceIdentifier deterministic; signPsbt + signMessage deferred; factories declared in both shells; core has zero Ledger SDK imports)',
);
