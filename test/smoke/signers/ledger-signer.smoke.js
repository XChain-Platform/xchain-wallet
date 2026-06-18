// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2, Step 14 (piece 4c): LedgerSigner class +
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

// deriveLedgerDeviceIdentifier uses crypto.subtle.digest. Node 18
// exposes WebCrypto only on globalThis.crypto, matching setup.js.
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    signers,
    schemas,
} from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
// §9 / G002: LedgerSigner.js + ledgerFormat.js moved to the standalone
// signers-ledger workspace package; the back-compat shim in
// `core/src/signers/index.js` keeps the `signers.LedgerSigner` runtime
// re-export working, so the in-process import above still resolves.
const ledgerPkg = join(wsRoot, 'packages', 'signers-ledger');

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

// --- 6. signPsbt + signMessage live wiring (HW Sign Step 3) ----------

await assert.rejects(
    signer.signPsbt({ psbtHex: 'deadbeef', chainId: 'bitcoin-mainnet', signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }] }),
    /requires an sdkRegistry/,
    'signPsbt without sdkRegistry is rejected',
);

function makeMockSdkRegistry({ decomposed }) {
    return {
        get() {
            return {
                wallet: {
                    decomposePsbt: () => decomposed,
                    txidOf: (txHex) => `txid-of-${txHex}`,
                },
            };
        },
    };
}

const segwitDecomposed = {
    txVersion: 2,
    locktime: 0,
    network: 'bitcoin-mainnet',
    inputs: [
        {
            prevTxHash: 'ab'.repeat(32),
            prevTxIndex: 0,
            sequence: 0xfffffffd,
            value: 100_000,
            scriptPubKeyHex: '0014' + 'bb'.repeat(20),
            scriptType: 'p2wpkh',
            sighashType: null,
            nonWitnessUtxoHex: null,
            witnessUtxoScriptHex: '0014' + 'bb'.repeat(20),
            redeemScriptHex: null,
            witnessScriptHex: null,
            address: 'bc1qmockinput',
            prevTxInfo: null,
        },
    ],
    outputs: [
        {
            address: 'bc1qmockoutput',
            scriptPubKeyHex: '0014' + 'cc'.repeat(20),
            scriptType: 'p2wpkh',
            value: 90_000,
        },
    ],
};

let capturedCreateArgs = null;
let capturedSplitCalls = [];
const signApp = makeMockApp({
    splitTransaction(rawTxHex, isSegwitSupported, hasTimestamp, hasExtraData, additionals) {
        capturedSplitCalls.push({ rawTxHex, isSegwitSupported, additionals });
        return { version: Buffer.alloc(4), outputs: [], inputs: [], locktime: Buffer.alloc(4) };
    },
    async createPaymentTransaction(args) {
        capturedCreateArgs = args;
        return '02deadbeef';
    },
});
const wiredSigner = new LedgerSigner({
    id: 'ledger-wired',
    displayName: 'Wired Ledger',
    model: 'nanoX',
    deviceIdentifier: 'mockid',
    app: signApp,
    sdkRegistry: makeMockSdkRegistry({ decomposed: segwitDecomposed }),
});

const signResult = await wiredSigner.signPsbt({
    psbtHex: '70736274ff01',
    chainId: 'bitcoin-mainnet',
    signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/5" }],
});
assert.equal(signResult.txHex, '02deadbeef');
assert.equal(signResult.txid, 'txid-of-02deadbeef');
assert.equal(signResult.signedPsbtHex, '');
assert.ok(capturedCreateArgs, 'createPaymentTransaction was called');
assert.equal(capturedCreateArgs.segwit, true, 'p2wpkh → segwit');
assert.deepEqual(capturedCreateArgs.additionals, ['bech32'], 'native segwit → bech32 additional');
assert.equal(capturedCreateArgs.associatedKeysets[0], "m/84'/0'/0'/0/5");
assert.equal(capturedSplitCalls.length, 1, 'one input → one splitTransaction call');
assert.match(capturedSplitCalls[0].rawTxHex, /^01000000/, 'synthesized prev tx starts with version=1 LE');

// Legacy lane: p2pkh input uses nonWitnessUtxoHex directly.
const legacyDecomposed = {
    ...segwitDecomposed,
    inputs: [{
        ...segwitDecomposed.inputs[0],
        scriptType: 'p2pkh',
        witnessUtxoScriptHex: null,
        nonWitnessUtxoHex: '01000000deadbeef',
    }],
};
let legacyCreate = null;
let legacySplit = [];
const legacyApp = makeMockApp({
    splitTransaction(rawTxHex) { legacySplit.push(rawTxHex); return {}; },
    async createPaymentTransaction(args) { legacyCreate = args; return 'aa' + 'bb'.repeat(4); },
});
const legacySigner = new LedgerSigner({
    id: 'ledger-legacy', displayName: 'L', model: 'nanoX', deviceIdentifier: 'mockid',
    app: legacyApp, sdkRegistry: makeMockSdkRegistry({ decomposed: legacyDecomposed }),
});
await legacySigner.signPsbt({
    psbtHex: '70736274ff02',
    chainId: 'dogecoin-mainnet',
    signingPaths: [{ inputIndex: 0, path: "m/44'/3'/0'/0/0" }],
});
assert.equal(legacyCreate.segwit, false, 'all-p2pkh → not segwit');
assert.deepEqual(legacyCreate.additionals, [], 'no native segwit → no bech32');
assert.equal(legacySplit[0], '01000000deadbeef', 'legacy lane uses real nonWitnessUtxoHex');

// createPaymentTransaction failure surfaces via SignerStatusError.
const failSignApp = makeMockApp({
    splitTransaction() { return {}; },
    async createPaymentTransaction() {
        const e = new Error('user rejected');
        e.statusCode = 0x6985;
        throw e;
    },
});
const failSignSigner = new LedgerSigner({
    id: 'ledger-signfail', displayName: 'X', model: 'nanoX', deviceIdentifier: 'mockid',
    app: failSignApp, sdkRegistry: makeMockSdkRegistry({ decomposed: segwitDecomposed }),
});
await assert.rejects(
    failSignSigner.signPsbt({
        psbtHex: '70736274ff03',
        chainId: 'bitcoin-mainnet',
        signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
    }),
    /user rejected/,
);

// signMessage: device returns { v, r, s }; signer composes the
// bitcoin-message compact base64 envelope using the path's BIP44
// purpose to select the header base (39 for p2wpkh).
let msgCapturedPath = null;
let msgCapturedHex = null;
const msgApp = makeMockApp({
    async signMessageNew(path, messageHex) {
        msgCapturedPath = path;
        msgCapturedHex = messageHex;
        return { v: 1, r: '11'.repeat(32), s: '22'.repeat(32) };
    },
});
const msgSigner = new LedgerSigner({
    id: 'ledger-msg', displayName: 'X', model: 'nanoX', deviceIdentifier: 'mockid',
    app: msgApp,
});
const msgResult = await msgSigner.signMessage({
    message: 'hello',
    chainId: 'bitcoin-mainnet',
    path: "m/84'/0'/0'/0/0",
});
assert.equal(msgCapturedPath, "m/84'/0'/0'/0/0");
assert.equal(msgCapturedHex, '68656c6c6f', 'message UTF-8 hex');
// Decode the base64 back to bytes; first byte must be 39 + recId(1) = 40.
const sigBytes = Buffer.from(msgResult.signature, 'base64');
assert.equal(sigBytes.length, 65, 'compact signature is 65 bytes');
assert.equal(sigBytes[0], 40, 'header = 39 (p2wpkh) + recId(1) = 40');
assert.equal(sigBytes.slice(1, 33).toString('hex'), '11'.repeat(32));
assert.equal(sigBytes.slice(33, 65).toString('hex'), '22'.repeat(32));

// p2sh-p2wpkh path produces header base 35.
const msgApp2 = makeMockApp({
    async signMessageNew() { return { v: 0, r: '11'.repeat(32), s: '22'.repeat(32) }; },
});
const msgSigner2 = new LedgerSigner({
    id: 'ledger-msg2', displayName: 'X', model: 'nanoX', deviceIdentifier: 'mockid',
    app: msgApp2,
});
const msgResult2 = await msgSigner2.signMessage({
    message: 'hi',
    chainId: 'bitcoin-mainnet',
    path: "m/49'/0'/0'/0/0",
});
assert.equal(Buffer.from(msgResult2.signature, 'base64')[0], 35, 'header = 35 + recId(0) = 35');

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
    'core builder does NOT import @ledgerhq/* (DI keeps core decoupled)',
);
assert.ok(
    /pairingInfo/.test(coreFactorySrc),
    'core builder returns pairingInfo; caller persists via flows.registerSigner',
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
    join(ledgerPkg, 'src', 'LedgerSigner.js'),
    'utf8',
);
assert.ok(
    !/from ['"]@ledgerhq/.test(ledgerSrc),
    'LedgerSigner class does NOT import any @ledgerhq package',
);

// §9 / G002: LedgerSigner now lives in @xchain-wallet/signers-ledger;
// back-compat shim in core/src/signers/index.js keeps the runtime
// re-export reachable.
assert.ok(
    !existsSync(join(core, 'src', 'signers', 'LedgerSigner.js')),
    'LedgerSigner.js no longer lives in @xchain-wallet/core (moved to @xchain-wallet/signers-ledger)',
);
assert.ok(
    existsSync(join(ledgerPkg, 'package.json')),
    '@xchain-wallet/signers-ledger package.json exists',
);

// --- 12. ledgerFormat.js envelope builder exists + exports -----------

const fmtPath = join(ledgerPkg, 'src', 'ledgerFormat.js');
assert.ok(existsSync(fmtPath), 'ledgerFormat.js exists in signers-ledger');
const fmtSrc = readFileSync(fmtPath, 'utf8');
for (const sym of [
    'chainIdToLedgerCurrency',
    'serializeOutputs',
    'synthesizeMinimalPrevTx',
    'toLedgerCreatePayment',
    'addressTypeFromPath',
    'composeBitcoinCompactSignature',
]) {
    assert.ok(
        new RegExp(`export (?:function|const) ${sym}\\b`).test(fmtSrc),
        `ledgerFormat.js exports ${sym}`,
    );
}

console.log(
    'OK: ledger signer smoke (class conforms to Signer interface against DI mock; getStatus distinguishes wrong-app / disconnected / available; getAddresses path derivation for BTC/LTC/DOGE; deriveLedgerDeviceIdentifier deterministic; signPsbt pipes through sdk.decomposePsbt -> Ledger envelope builder -> createPaymentTransaction; signMessage composes base64 compact sig with address-type header base; factories declared in both shells; core has zero Ledger SDK imports)',
);
