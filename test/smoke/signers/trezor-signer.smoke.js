// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2: Step 13 (piece 4b): TrezorSigner class +
// per-target transport factories, plus HW Sign Step 2: live
// signPsbt + signMessage wiring through the Trezor envelope builder.
//
// Coverage strategy:
//   1. Run the TrezorSigner class against a hand-written mock Connect
//     : no hardware, no @trezor/connect-web dependency exercised by
//      the smoke. Covers the shape the class demands of the transport.
//   2. Static-check the factories: extension ships the real path,
//      web re-exports it via a cross-package relative import.
//   3. signPsbt pipes a mock-decomposed PSBT through the Trezor
//      envelope builder into connect.signTransaction, and returns the
//      resulting serializedTx + txid.
//   4. signMessage passes through the device's base64 signature.
//   5. The class refuses to signPsbt without an injected sdkRegistry.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    signers,
    schemas,
} from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const ext = join(wsRoot, 'packages', 'extension');
const web = join(wsRoot, 'packages', 'web');
// §9 / G001: TrezorSigner.js + trezorFormat.js moved to the standalone
// signers-trezor workspace package; the back-compat shim in
// `core/src/signers/index.js` keeps the `signers.TrezorSigner` runtime
// re-export working, so the in-process import above still resolves.
const trezorPkg = join(wsRoot, 'packages', 'signers-trezor');

const {
    TrezorSigner,
    deviceIdentifierFromFeatures,
    modelFromFeatures,
    firmwareVersionFromFeatures,
} = signers;

// --- Mock Connect -----------------------------------------------------

/**
 * Minimal mock of the Trezor Connect shape TrezorSigner reaches for.
 * Tests that need to vary responses override individual methods on
 * the returned object.
 */
function makeMockConnect(overrides = {}) {
    return {
        async getFeatures() {
            return {
                success: true,
                payload: {
                    device_id: 'mock-device-id',
                    label: 'My Trezor',
                    internal_model: 'T2T1',
                    major_version: 2,
                    minor_version: 7,
                    patch_version: 2,
                },
            };
        },
        async getAddress({ path }) {
            return {
                success: true,
                payload: { address: `mock-addr-for-${path}`, path },
            };
        },
        async getPublicKey({ path }) {
            return {
                success: true,
                payload: {
                    publicKey: `02mockpub${path.replace(/[^0-9]/g, '')}`,
                    chainCode: 'mockchaincode',
                    fingerprint: 0xdeadbeef,
                },
            };
        },
        async signTransaction() {
            return { success: true, payload: { serializedTx: 'mock-signed-tx', signatures: [] } };
        },
        async signMessage() {
            return { success: true, payload: { signature: 'mock-signature' } };
        },
        ...overrides,
    };
}

// --- 1. Constructor guard-rails ---------------------------------------

assert.throws(
    () => new TrezorSigner({}),
    /TrezorSigner: id is required/,
    'constructor rejects missing id',
);
assert.throws(
    () => new TrezorSigner({ id: 'x' }),
    /TrezorSigner: displayName is required/,
);
assert.throws(
    () => new TrezorSigner({ id: 'x', displayName: 'y' }),
    /TrezorSigner: model is required/,
);
assert.throws(
    () => new TrezorSigner({ id: 'x', displayName: 'y', model: 'T2T1' }),
    /TrezorSigner: deviceIdentifier is required/,
);
assert.throws(
    () => new TrezorSigner({ id: 'x', displayName: 'y', model: 'T2T1', deviceIdentifier: 'd' }),
    /TrezorSigner: connect is required/,
);

// --- 2. Signer interface conformance ----------------------------------

const connect = makeMockConnect();
const signer = new TrezorSigner({
    id: 'trezor-mock-device-id',
    displayName: 'My Trezor (T2T1)',
    model: 'T2T1',
    deviceIdentifier: 'mock-device-id',
    connect,
});

assert.equal(signer.id, 'trezor-mock-device-id');
assert.equal(signer.displayName, 'My Trezor (T2T1)');
assert.equal(signer.kind, 'trezor');
assert.equal(signer.requiresPhysicalConfirmation, true);
assert.equal(signer.model, 'T2T1');
assert.equal(signer.deviceIdentifier, 'mock-device-id');

// --- 3. getStatus: available / disconnected / mismatched device -------

assert.equal(
    await signer.getStatus(),
    'available',
    'matching device_id returns "available"',
);

const mismatchSigner = new TrezorSigner({
    id: 'trezor-other',
    displayName: 'Other',
    model: 'T2T1',
    deviceIdentifier: 'different-device',
    connect,
});
assert.equal(
    await mismatchSigner.getStatus(),
    'disconnected',
    'different device_id returns "disconnected": protects against swapped device',
);

const failConnect = makeMockConnect({
    async getFeatures() { throw new Error('boom'); },
});
const failSigner = new TrezorSigner({
    id: 'trezor-fail',
    displayName: 'Fail',
    model: 'T2T1',
    deviceIdentifier: 'mock-device-id',
    connect: failConnect,
});
assert.equal(
    await failSigner.getStatus(),
    'disconnected',
    'getFeatures throwing → disconnected',
);

const rejectConnect = makeMockConnect({
    async getFeatures() { return { success: false, payload: { error: 'user cancelled' } }; },
});
const rejectSigner = new TrezorSigner({
    id: 'trezor-reject',
    displayName: 'Reject',
    model: 'T2T1',
    deviceIdentifier: 'mock-device-id',
    connect: rejectConnect,
});
assert.equal(await rejectSigner.getStatus(), 'disconnected');

// Fail closed on an unconfirmable identity: a device that reports
// getFeatures success but omits BOTH device_id and fw_fingerprint cannot
// be confirmed as the paired device, so it must read 'disconnected' (not
// 'available', which would silently accept a swapped/counterfeit device).
const noIdConnect = makeMockConnect({
    async getFeatures() { return { success: true, payload: { model: 'T2T1' } }; },
});
const noIdSigner = new TrezorSigner({
    id: 'trezor-noid',
    displayName: 'NoId',
    model: 'T2T1',
    deviceIdentifier: 'mock-device-id',
    connect: noIdConnect,
});
assert.equal(
    await noIdSigner.getStatus(),
    'disconnected',
    'device with no device_id/fw_fingerprint fails closed to "disconnected"',
);

// --- 4. getAddresses derives the right paths --------------------------

const addrs = await signer.getAddresses({
    chainId: 'bitcoin-mainnet',
    accountIndex: 0,
    change: 0,
    startIndex: 0,
    count: 3,
    addressType: 'p2wpkh',
});
assert.equal(addrs.length, 3);
assert.equal(addrs[0].path, "m/84'/0'/0'/0/0", 'BIP84 purpose for p2wpkh');
assert.equal(addrs[1].path, "m/84'/0'/0'/0/1");
assert.equal(addrs[2].path, "m/84'/0'/0'/0/2");
assert.ok(addrs[0].address, 'each entry has an address');
assert.ok(addrs[0].publicKey, 'each entry has a publicKey');

const dogeAddrs = await signer.getAddresses({
    chainId: 'dogecoin-mainnet',
    accountIndex: 0,
    change: 0,
    startIndex: 0,
    count: 1,
});
assert.equal(
    dogeAddrs[0].path,
    "m/44'/3'/0'/0/0",
    'Dogecoin defaults to purpose 44\' + coinType 3\'',
);

const ltcAddrs = await signer.getAddresses({
    chainId: 'litecoin-mainnet',
    accountIndex: 1,
    change: 1,
    startIndex: 5,
    count: 1,
});
assert.equal(
    ltcAddrs[0].path,
    "m/44'/2'/1'/1/5",
    'Litecoin uses coinType 2\' with account + change + index',
);

// Unknown chainId throws.
await assert.rejects(
    signer.getAddresses({ chainId: 'ethereum-mainnet', accountIndex: 0, change: 0, startIndex: 0, count: 1 }),
    /unsupported chainId/,
);

// getAddress failure propagates as SignerStatusError.
const failAddrConnect = makeMockConnect({
    async getAddress() { return { success: false, payload: { error: 'user rejected' } }; },
});
const failAddrSigner = new TrezorSigner({
    id: 'trezor-addr-fail',
    displayName: 'X',
    model: 'T2T1',
    deviceIdentifier: 'mock-device-id',
    connect: failAddrConnect,
});
await assert.rejects(
    failAddrSigner.getAddresses({
        chainId: 'bitcoin-mainnet', accountIndex: 0, change: 0, startIndex: 0, count: 1,
    }),
    /user rejected/,
);

// --- 5. getPublicKey returns SDK-shaped response ----------------------

const pk = await signer.getPublicKey({
    chainId: 'bitcoin-mainnet',
    path: "m/84'/0'/0'/0/0",
});
assert.ok(pk.publicKey);
assert.equal(pk.chainCode, 'mockchaincode');
assert.equal(pk.fingerprint, '3735928559', 'fingerprint stringified');

// --- 6. signPsbt + signMessage live wiring (HW Sign Step 2) ----------

// 6a. signPsbt without an sdkRegistry is rejected: consistent with
//     SoftwareSigner's own posture.
await assert.rejects(
    signer.signPsbt({ psbtHex: 'deadbeef', chainId: 'bitcoin-mainnet', signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }] }),
    /requires an sdkRegistry/,
    'signPsbt without sdkRegistry is rejected',
);

// 6b. Build a mock sdkRegistry whose decomposePsbt / txidOf return
//     fixtures the envelope builder can consume. The signer should
//     thread these into connect.signTransaction and return a proper
//     { txHex, txid, signedPsbtHex } trio.
function makeMockSdkRegistry({ decomposed }) {
    return {
        get() {
            return {
                wallet: {
                    decomposePsbt: (_psbtHex) => decomposed,
                    txidOf: (txHex) => `txid-of-${txHex}`,
                },
            };
        },
    };
}

const decomposedFixture = {
    txVersion: 2,
    locktime: 0,
    network: 'bitcoin-mainnet',
    inputs: [
        {
            prevTxHash: 'aa'.repeat(32),
            prevTxIndex: 1,
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

let capturedSignTxArgs = null;
const signConnect = makeMockConnect({
    async signTransaction(args) {
        capturedSignTxArgs = args;
        return {
            success: true,
            payload: { serializedTx: '0200000001deadbeef', signatures: ['3045sig'] },
        };
    },
});
const wiredSigner = new TrezorSigner({
    id: 'trezor-wired',
    displayName: 'Wired Trezor',
    model: 'T2T1',
    deviceIdentifier: 'mock-device-id',
    connect: signConnect,
    sdkRegistry: makeMockSdkRegistry({ decomposed: decomposedFixture }),
});

const signResult = await wiredSigner.signPsbt({
    psbtHex: '70736274ff01',
    chainId: 'bitcoin-mainnet',
    signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/5" }],
});

assert.equal(signResult.txHex, '0200000001deadbeef', 'passes serializedTx through as txHex');
assert.equal(signResult.txid, 'txid-of-0200000001deadbeef', 'routes through sdk.wallet.txidOf');
assert.equal(signResult.signedPsbtHex, '', 'Trezor does not return a signed PSBT');

assert.ok(capturedSignTxArgs, 'signTransaction was called');
assert.equal(capturedSignTxArgs.coin, 'btc', 'bitcoin-mainnet → btc');
assert.deepEqual(
    capturedSignTxArgs.inputs[0].address_n,
    [
        (84 | 0x80000000) >>> 0,
        (0 | 0x80000000) >>> 0,
        (0 | 0x80000000) >>> 0,
        0,
        5,
    ],
    'path "m/84\'/0\'/0\'/0/5" becomes the expected address_n array',
);
assert.equal(capturedSignTxArgs.inputs[0].prev_hash, 'aa'.repeat(32));
assert.equal(capturedSignTxArgs.inputs[0].prev_index, 1);
assert.equal(capturedSignTxArgs.inputs[0].amount, '100000', 'amounts are stringified');
assert.equal(capturedSignTxArgs.inputs[0].script_type, 'SPENDWITNESS');
assert.equal(capturedSignTxArgs.outputs[0].address, 'bc1qmockoutput');
assert.equal(capturedSignTxArgs.outputs[0].amount, '90000');
assert.equal(capturedSignTxArgs.outputs[0].script_type, 'PAYTOADDRESS');
assert.equal(capturedSignTxArgs.refTxs, undefined, 'segwit-only inputs → no refTxs');

// 6c. Legacy p2pkh input emits refTxs from prevTxInfo.
const legacyFixture = {
    ...decomposedFixture,
    inputs: [
        {
            ...decomposedFixture.inputs[0],
            scriptType: 'p2pkh',
            nonWitnessUtxoHex: '0100000001aabb',
            witnessUtxoScriptHex: null,
            prevTxInfo: {
                hash: 'aa'.repeat(32),
                version: 1,
                locktime: 0,
                inputs: [{ prev_hash: 'cc'.repeat(32), prev_index: 0, script_sig: '', sequence: 0xffffffff }],
                bin_outputs: [{ amount: '100000', script_pubkey: '76a914' + 'dd'.repeat(20) + '88ac' }],
            },
        },
    ],
};

let legacyCaptured = null;
const legacySigner = new TrezorSigner({
    id: 'trezor-legacy',
    displayName: 'Legacy',
    model: 'T2T1',
    deviceIdentifier: 'mock-device-id',
    connect: makeMockConnect({
        async signTransaction(args) {
            legacyCaptured = args;
            return { success: true, payload: { serializedTx: '01deadbeef', signatures: [] } };
        },
    }),
    sdkRegistry: makeMockSdkRegistry({ decomposed: legacyFixture }),
});
await legacySigner.signPsbt({
    psbtHex: '70736274ff02',
    chainId: 'dogecoin-mainnet',
    signingPaths: [{ inputIndex: 0, path: "m/44'/3'/0'/0/0" }],
});
assert.equal(legacyCaptured.coin, 'doge');
assert.equal(legacyCaptured.inputs[0].script_type, 'SPENDADDRESS');
assert.ok(Array.isArray(legacyCaptured.refTxs), 'legacy inputs emit refTxs');
assert.equal(legacyCaptured.refTxs.length, 1);
assert.equal(legacyCaptured.refTxs[0].hash, 'aa'.repeat(32));

// 6d. Connect failure surfaces as SignerStatusError.
const failSignConnect = makeMockConnect({
    async signTransaction() { return { success: false, payload: { error: 'user rejected' } }; },
});
const failSignSigner = new TrezorSigner({
    id: 'trezor-sign-fail',
    displayName: 'X',
    model: 'T2T1',
    deviceIdentifier: 'mock-device-id',
    connect: failSignConnect,
    sdkRegistry: makeMockSdkRegistry({ decomposed: decomposedFixture }),
});
await assert.rejects(
    failSignSigner.signPsbt({
        psbtHex: '70736274ff03',
        chainId: 'bitcoin-mainnet',
        signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
    }),
    /user rejected/,
);

// 6e. signMessage passes through the device's base64 signature.
let msgCaptured = null;
const msgSigner = new TrezorSigner({
    id: 'trezor-msg',
    displayName: 'X',
    model: 'T2T1',
    deviceIdentifier: 'mock-device-id',
    connect: makeMockConnect({
        async signMessage(args) {
            msgCaptured = args;
            return { success: true, payload: { signature: 'IGmockbase64sig==' } };
        },
    }),
});
const msgResult = await msgSigner.signMessage({
    message: 'hello',
    chainId: 'bitcoin-mainnet',
    path: "m/84'/0'/0'/0/0",
});
assert.equal(msgResult.signature, 'IGmockbase64sig==');
assert.equal(msgCaptured.coin, 'btc');
assert.equal(msgCaptured.path, "m/84'/0'/0'/0/0");
assert.equal(msgCaptured.message, 'hello');

// Without a path or with bad-shape path, signMessage rejects.
await assert.rejects(
    msgSigner.signMessage({ message: 'hi', chainId: 'bitcoin-mainnet' }),
    /path is required/,
);

// --- 7. Features → SignerRecord field extractors ----------------------

assert.equal(
    deviceIdentifierFromFeatures({ device_id: 'abc' }),
    'abc',
);
assert.equal(
    deviceIdentifierFromFeatures({ fw_fingerprint: 'fp' }),
    'fp',
    'falls back to fw_fingerprint',
);
assert.equal(deviceIdentifierFromFeatures(null), null);
assert.equal(deviceIdentifierFromFeatures({}), null);

assert.equal(
    modelFromFeatures({ internal_model: 'T2B1' }),
    'T2B1',
    'prefers internal_model',
);
assert.equal(
    modelFromFeatures({ model: '1' }),
    'T1B1',
    'maps legacy "1" → T1B1',
);
assert.equal(
    modelFromFeatures({ model: 'T' }),
    'T2T1',
    'maps legacy "T" → T2T1',
);
assert.equal(modelFromFeatures({}), null);

assert.equal(
    firmwareVersionFromFeatures({ major_version: 2, minor_version: 7, patch_version: 2 }),
    '2.7.2',
);
assert.equal(
    firmwareVersionFromFeatures({ major_version: 2 }),
    null,
    'missing component → null (no half-version)',
);

// --- 8. Core schemas.SIGNER_KINDS includes 'trezor' -------------------

assert.ok(
    schemas.SIGNER_KINDS.includes('trezor'),
    'schemas.SIGNER_KINDS includes trezor',
);

// --- 9. Factory files + package.json deps -----------------------------
//
// Step 18 hoisted the pair sequence into core's `signerFactories/`
// module: shell factories are now thin bindings that lazy-import the
// HW SDK and delegate to `makeTrezorFactory({ getConnect })`. The
// extension + web + desktop bindings all share the same core logic;
// only transport init (manifest, connectSrc, permission wiring) is
// shell-specific.

const coreFactory = join(core, 'src', 'signerFactories', 'trezor.js');
const coreFactoryIndex = join(core, 'src', 'signerFactories', 'index.js');
const extFactory = join(ext, 'src', 'signers', 'trezorFactory.js');
const webFactory = join(web, 'src', 'signers', 'trezorFactory.js');
assert.ok(existsSync(coreFactory), 'core signerFactories/trezor.js exists');
assert.ok(existsSync(coreFactoryIndex), 'core signerFactories/index.js exists');
assert.ok(existsSync(extFactory), 'extension trezorFactory.js exists');
assert.ok(existsSync(webFactory), 'web trezorFactory.js exists');

const coreFactorySrc = readFileSync(coreFactory, 'utf8');
assert.ok(
    /export function makeTrezorFactory/.test(coreFactorySrc),
    'core exports makeTrezorFactory builder',
);
assert.ok(
    !/@trezor\/connect-web/.test(stripComments(coreFactorySrc)),
    'core builder does NOT import @trezor/connect-web: DI keeps core decoupled',
);
assert.ok(
    /pairingInfo/.test(coreFactorySrc),
    'core builder returns pairingInfo: caller persists via flows.registerSigner',
);

function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

const coreFactoryIndexSrc = readFileSync(coreFactoryIndex, 'utf8');
assert.ok(
    /export \{ makeTrezorFactory \}/.test(coreFactoryIndexSrc),
    'core signerFactories/index.js re-exports makeTrezorFactory',
);

const extFactorySrc = readFileSync(extFactory, 'utf8');
assert.ok(
    /@trezor\/connect-web/.test(extFactorySrc),
    'extension factory references @trezor/connect-web',
);
assert.ok(
    /export async function getTrezorConnect/.test(extFactorySrc),
    'extension factory exports getTrezorConnect',
);
assert.ok(
    /export async function pairTrezorSigner/.test(extFactorySrc),
    'extension factory exports pairTrezorSigner',
);
assert.ok(
    /TrezorConnect\.init\(/.test(extFactorySrc),
    'extension factory calls TrezorConnect.init',
);
assert.ok(
    /manifest/.test(extFactorySrc),
    'extension factory supplies a Trezor manifest',
);
assert.ok(
    /makeTrezorFactory/.test(extFactorySrc),
    'extension factory delegates to core makeTrezorFactory',
);
assert.ok(
    /\.\.\/\.\.\/\.\.\/core\/src\/signerFactories\/index\.js/.test(extFactorySrc),
    'extension factory imports core builder via cross-package relative path',
);
assert.ok(
    /import\(.@trezor\/connect-web.\)/.test(extFactorySrc),
    'extension factory lazy-imports @trezor/connect-web (so the SDK only loads at pair time)',
);

const webFactorySrc = readFileSync(webFactory, 'utf8');
assert.ok(
    /\.\.\/\.\.\/\.\.\/extension\/src\/signers\/trezorFactory\.js/.test(webFactorySrc),
    'web factory uses the cross-package relative path (matches hostBridge.js convention)',
);

// --- 10. Package.json deps --------------------------------------------

const extPkg = JSON.parse(readFileSync(join(ext, 'package.json'), 'utf8'));
assert.ok(
    extPkg.dependencies['@trezor/connect-web'],
    'extension package.json declares @trezor/connect-web',
);
assert.match(
    extPkg.dependencies['@trezor/connect-web'],
    /^\^9\./,
    'extension pins @trezor/connect-web to ^9.x',
);

const webPkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8'));
assert.ok(
    webPkg.dependencies['@trezor/connect-web'],
    'web package.json declares @trezor/connect-web',
);

// --- 10b. Background signer registry handlers + messaging ------------

const bg = readFileSync(
    join(ext, 'src', 'background', 'createBackgroundHost.js'), 'utf8',
);
for (const handler of ['signer.register', 'signer.list', 'signer.unregister']) {
    assert.ok(
        new RegExp(`host\\.register\\('${handler.replace('.', '\\.')}'`).test(bg),
        `background host registers ${handler}`,
    );
}
assert.ok(
    /registerSigner\(\{\s*\.\.\.req,\s*vault\s*\}\)/.test(bg),
    'signer.register handler calls flows.registerSigner with injected vault',
);

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(web, 'src', 'messaging.js')],
]) {
    const m = readFileSync(msgPath, 'utf8');
    for (const fn of ['registerSigner', 'listSigners', 'unregisterSigner']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(m),
            `${shell} messaging.js exports ${fn}`,
        );
    }
    assert.ok(
        /sendMessage\('signer\.register'/.test(m),
        `${shell} messaging.js routes registerSigner via signer.register`,
    );
}

// --- 11. TrezorSigner doesn't import @trezor/connect-web directly ----

const trezorSrc = readFileSync(
    join(trezorPkg, 'src', 'TrezorSigner.js'),
    'utf8',
);
assert.ok(
    !/from ['"]@trezor\/connect-web['"]/.test(trezorSrc),
    'TrezorSigner class does NOT import @trezor/connect-web: DI keeps the package decoupled',
);
assert.ok(
    !/import ['"]@trezor/.test(trezorSrc),
    'TrezorSigner class has no Trezor SDK imports at all',
);

// §9 / G001: TrezorSigner now lives in @xchain-wallet/signers-trezor;
// back-compat shim in core/src/signers/index.js keeps the runtime
// re-export reachable (in-process `signers.TrezorSigner` above) and
// the ENOENT-prone direct path read is gone.
assert.ok(
    !existsSync(join(core, 'src', 'signers', 'TrezorSigner.js')),
    'TrezorSigner.js no longer lives in @xchain-wallet/core (moved to @xchain-wallet/signers-trezor)',
);
assert.ok(
    existsSync(join(trezorPkg, 'package.json')),
    '@xchain-wallet/signers-trezor package.json exists',
);

// --- 12. trezorFormat.js envelope builder exists + exports -----------

const fmtPath = join(trezorPkg, 'src', 'trezorFormat.js');
assert.ok(existsSync(fmtPath), 'trezorFormat.js exists in signers-trezor');
const fmtSrc = readFileSync(fmtPath, 'utf8');
for (const sym of ['pathToAddressN', 'toTrezorSignTransaction', 'chainIdToTrezorCoin']) {
    assert.ok(
        new RegExp(`export (?:function|const) ${sym}\\b`).test(fmtSrc),
        `trezorFormat.js exports ${sym}`,
    );
}

console.log(
    'OK: trezor signer smoke (class conforms to Signer interface against DI mock; getStatus / getAddresses / getPublicKey covered; signPsbt pipes through sdk.decomposePsbt → Trezor envelope builder → connect.signTransaction; signMessage wired; legacy lane emits refTxs; factories declared in both shells; core has zero Trezor SDK imports)',
);
