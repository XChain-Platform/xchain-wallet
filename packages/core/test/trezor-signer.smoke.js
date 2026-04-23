// Smoke for Phase 2 — Step 13 (piece 4b) — TrezorSigner class +
// per-target transport factories.
//
// Coverage strategy (matches the user's directive for Step 13):
//   1. Run the TrezorSigner class against a hand-written mock Connect
//      — no hardware, no @trezor/connect-web dependency exercised by
//      the smoke. Covers the shape the class demands of the transport.
//   2. Static-check the factories: extension ships the real path,
//      web re-exports it via a cross-package relative import.
//   3. Confirm signPsbt + signMessage throw NotImplementedError with
//      clear messages — PSBT↔Trezor conversion is explicitly deferred.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    'different device_id returns "disconnected" — protects against swapped device',
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

// --- 6. signPsbt + signMessage deferred -------------------------------

await assert.rejects(
    signer.signPsbt({ psbtHex: '', chainId: 'bitcoin-mainnet', signingPaths: [] }),
    /NotImplementedError.*signPsbt/,
    'signPsbt throws NotImplementedError with a clear deferral message',
);
await assert.rejects(
    signer.signMessage({ message: 'hi', chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" }),
    /NotImplementedError.*signMessage/,
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

const extFactory = join(ext, 'src', 'signers', 'trezorFactory.js');
const webFactory = join(web, 'src', 'signers', 'trezorFactory.js');
assert.ok(existsSync(extFactory), 'extension trezorFactory.js exists');
assert.ok(existsSync(webFactory), 'web trezorFactory.js exists');

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
    /pairingInfo/.test(extFactorySrc),
    'pairTrezorSigner returns pairingInfo — caller persists via flows.registerSigner',
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
    join(core, 'src', 'signers', 'TrezorSigner.js'),
    'utf8',
);
assert.ok(
    !/from ['"]@trezor\/connect-web['"]/.test(trezorSrc),
    'TrezorSigner class does NOT import @trezor/connect-web — DI keeps core decoupled',
);
assert.ok(
    !/import ['"]@trezor/.test(trezorSrc),
    'TrezorSigner class has no Trezor SDK imports at all',
);

console.log(
    'OK — trezor signer smoke (class conforms to Signer interface against DI mock; getStatus / getAddresses / getPublicKey covered; signPsbt + signMessage deferred with clear messages; factories declared in both shells; core has zero Trezor SDK imports)',
);
