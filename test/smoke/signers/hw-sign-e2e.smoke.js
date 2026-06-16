// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for HW Sign Step 5 — end-to-end hardware-signer chain.
//
// Proves the full primitives chain runs:
//
//   caller -> RemoteSigner.signPsbt
//          -> transport (mock of the renderer↔background port)
//          -> renderer-side TrezorSigner.signPsbt
//          -> sdk.wallet.decomposePsbt (mock)
//          -> trezorFormat.toTrezorSignTransaction
//          -> connect.signTransaction (mock Connect)
//          -> serializedTx returned back up the chain
//          -> sdk.wallet.txidOf (mock) for the txid
//          -> RemoteSigner returns { txHex, txid, signedPsbtHex: '' }
//
// Also exercises the resolveSigner / buildRemoteSigner flow helpers:
// given a persisted HW Address record + SignerRecord, produce the
// right descriptor, then build a RemoteSigner against a transport.
//
// Explicitly NOT covered here (deferred to shell-wiring step):
//   - The physical renderer↔background port RPC protocol
//     (signer.sign.request / signer.sign.response messages).
//   - Per-form HW branches (Send/Issue/Mint/... all show
//     HwSignBlock instead of a password input). Architectural
//     primitives land here; per-form wiring is follow-up.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    flows,
    signers,
} from '../../../packages/core/src/index.js';

const { RemoteSigner, TrezorSigner } = signers;
const {
    resolveSigner,
    buildRemoteSigner,
    SignerResolutionError,
} = flows;

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');

// ---------------------------------------------------------------
// Mock renderer-side TrezorSigner + transport
// ---------------------------------------------------------------

// The renderer's job: hold live TrezorSigner / LedgerSigner instances
// keyed by signerId, and expose a dispatch that routes ops from the
// background by signerId. We simulate that with a plain map.
const rendererSigners = new Map();

function makeMockSdkRegistry(decomposed) {
    return {
        get() {
            return {
                wallet: {
                    decomposePsbt: () => decomposed,
                    txidOf: (txHex) => `txid-of-${txHex.slice(0, 8)}`,
                },
            };
        },
    };
}

function makeMockConnect({ serializedTx }) {
    return {
        async getFeatures() {
            return {
                success: true,
                payload: { device_id: 'mock-trezor-device', internal_model: 'T2T1' },
            };
        },
        async signTransaction(args) {
            makeMockConnect.lastSignArgs = args;
            return { success: true, payload: { serializedTx, signatures: [] } };
        },
        async signMessage() {
            return { success: true, payload: { signature: 'ILmockSigBase64==' } };
        },
        async getAddress({ path }) {
            return { success: true, payload: { address: `bc1qmock-${path}`, path } };
        },
        async getPublicKey({ path }) {
            return {
                success: true,
                payload: { publicKey: `02mock${path.replace(/[^0-9]/g, '')}`, chainCode: 'cc', fingerprint: 0 },
            };
        },
    };
}

const decomposedFixture = {
    txVersion: 2,
    locktime: 0,
    network: 'bitcoin-mainnet',
    inputs: [{
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
    }],
    outputs: [{
        address: 'bc1qmockoutput',
        scriptPubKeyHex: '0014' + 'cc'.repeat(20),
        scriptType: 'p2wpkh',
        value: 90_000,
    }],
};

// Build a real TrezorSigner (the renderer-side signer) wired to a
// mock Connect + mock sdkRegistry. RemoteSigner on the background
// side forwards to this.
const mockConnect = makeMockConnect({ serializedTx: '02000000faceb00c' });
const rendererTrezor = new TrezorSigner({
    id: 'sig-trezor-1',
    displayName: 'My Trezor (T2T1)',
    model: 'T2T1',
    deviceIdentifier: 'mock-trezor-device',
    connect: mockConnect,
    sdkRegistry: makeMockSdkRegistry(decomposedFixture),
});
rendererSigners.set('sig-trezor-1', rendererTrezor);

// Mock transport: simulates the background → renderer RPC. The
// background RemoteSigner calls this; in production this would post
// a `signer.sign.request` message over a chrome.runtime port and
// await the reply. Here we dispatch directly to the signer map.
const transportCalls = [];
async function mockRendererTransport({ op, payload }) {
    transportCalls.push({ op, payload });
    const signer = rendererSigners.get(payload.signerId);
    if (!signer) {
        throw new Error(`no renderer signer with id "${payload.signerId}"`);
    }
    switch (op) {
        case 'status':
            return signer.getStatus(payload);
        case 'getAddresses':
            return signer.getAddresses(payload);
        case 'getPublicKey':
            return signer.getPublicKey(payload);
        case 'signPsbt':
            return signer.signPsbt(payload);
        case 'signMessage':
            return signer.signMessage(payload);
        default:
            throw new Error(`mock transport: unknown op "${op}"`);
    }
}

// ---------------------------------------------------------------
// 1. resolveSigner descriptor logic
// ---------------------------------------------------------------

function makeVault(signersList) {
    return {
        signers: {
            async find(id) {
                return signersList.find((s) => s.id === id) || null;
            },
        },
    };
}

const signerRecord = {
    id: 'sig-trezor-1',
    walletId: 'wallet-1',
    kind: 'trezor',
    vendor: 'trezor',
    model: 'T2T1',
    deviceIdentifier: 'mock-trezor-device',
    label: 'My Trezor',
    firmwareVersion: '2.7.2',
    pairedAt: '2026-04-01T00:00:00Z',
    lastSeenAt: '2026-04-23T00:00:00Z',
};
const vault = makeVault([signerRecord]);

// 1a. software HD address → 'software' descriptor.
{
    const desc = await resolveSigner({
        vault,
        address: {
            id: 'addr-hd-1',
            address: 'bc1qhd',
            publicKey: '02hd',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    });
    assert.equal(desc.kind, 'software');
    assert.equal(desc.address.id, 'addr-hd-1');
}

// 1b. imported-wif → 'software'.
{
    const desc = await resolveSigner({
        vault,
        address: {
            id: 'addr-imp-1',
            address: 'bc1qimp',
            publicKey: '02imp',
            derivationPath: null,
            source: 'imported-wif',
        },
    });
    assert.equal(desc.kind, 'software');
}

// 1c. trezor address with matching SignerRecord → 'trezor' descriptor.
{
    const desc = await resolveSigner({
        vault,
        address: {
            id: 'addr-hw-1',
            address: 'bc1qhw',
            publicKey: '02hw',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'trezor',
            signerId: 'sig-trezor-1',
        },
    });
    assert.equal(desc.kind, 'trezor');
    assert.equal(desc.signerRecord.id, 'sig-trezor-1');
}

// 1d. watch-only → explicit refusal.
await assert.rejects(
    resolveSigner({
        vault,
        address: { id: 'addr-wo', address: 'bc1qwo', publicKey: '02wo', source: 'watch-only' },
    }),
    /watch-only/,
);

// 1e. HW source without signerId → refusal.
await assert.rejects(
    resolveSigner({
        vault,
        address: { id: 'addr-hw-bad', address: 'bc1qbad', publicKey: '02b', source: 'trezor' },
    }),
    /no signerId/,
);

// 1f. HW source pointing at missing SignerRecord → refusal.
await assert.rejects(
    resolveSigner({
        vault,
        address: { id: 'x', address: 'bc1qx', publicKey: '02x', source: 'trezor', signerId: 'missing' },
    }),
    /no SignerRecord/,
);

// 1g. HW source whose kind doesn't match SignerRecord.kind → refusal
//     (defends against a corrupted Address record).
const mismatchVault = makeVault([{
    ...signerRecord,
    kind: 'ledger', // address says 'trezor', record says 'ledger'
}]);
await assert.rejects(
    resolveSigner({
        vault: mismatchVault,
        address: {
            id: 'x', address: 'bc1qx', publicKey: '02x',
            source: 'trezor', signerId: 'sig-trezor-1',
        },
    }),
    /doesn't match signer kind/,
);

// 1h. Errors are SignerResolutionError with useful fields.
try {
    await resolveSigner({
        vault,
        address: { id: 'x', address: 'bc1qx', publicKey: '02x', source: 'watch-only' },
    });
    assert.fail('expected throw');
} catch (err) {
    assert.ok(err instanceof SignerResolutionError);
    assert.equal(err.source, 'watch-only');
    assert.equal(err.addressId, 'x');
}

// ---------------------------------------------------------------
// 2. buildRemoteSigner constructs a RemoteSigner with the right shape
// ---------------------------------------------------------------

const descriptor = await resolveSigner({
    vault,
    address: {
        id: 'addr-hw-1',
        address: 'bc1qhw',
        publicKey: '02hw',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'trezor',
        signerId: 'sig-trezor-1',
    },
});

const remote = buildRemoteSigner(descriptor, mockRendererTransport);
assert.ok(remote instanceof RemoteSigner);
assert.equal(remote.id, 'sig-trezor-1');
assert.equal(remote.kind, 'trezor');
assert.equal(remote.displayName, 'My Trezor');  // uses SignerRecord.label

// Falls back to "vendor model" when label is empty.
const unlabelledDesc = {
    kind: 'trezor',
    address: descriptor.address,
    signerRecord: { ...signerRecord, label: '' },
};
const unlabelled = buildRemoteSigner(unlabelledDesc, mockRendererTransport);
assert.equal(unlabelled.displayName, 'trezor T2T1');

// buildRemoteSigner refuses non-HW descriptors.
assert.throws(
    () => buildRemoteSigner({ kind: 'software', address: {} }, mockRendererTransport),
    /descriptor must be HW/,
);
assert.throws(
    () => buildRemoteSigner(descriptor, 'not a fn'),
    /transport must be a function/,
);

// ---------------------------------------------------------------
// 3. End-to-end: RemoteSigner.signPsbt routes through the transport,
//    through TrezorSigner, through sdk.decomposePsbt + trezorFormat,
//    through connect.signTransaction, back to a signed tx.
// ---------------------------------------------------------------

const signedResult = await remote.signPsbt({
    psbtHex: '70736274ff01aabb',
    chainId: 'bitcoin-mainnet',
    signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/5" }],
});

assert.equal(signedResult.txHex, '02000000faceb00c');
assert.equal(signedResult.txid, 'txid-of-02000000');
assert.equal(signedResult.signedPsbtHex, '');

// Confirm the transport received the signPsbt op with signerId.
const sigCall = transportCalls.find((c) => c.op === 'signPsbt');
assert.ok(sigCall);
assert.equal(sigCall.payload.signerId, 'sig-trezor-1');
assert.equal(sigCall.payload.psbtHex, '70736274ff01aabb');
assert.equal(sigCall.payload.chainId, 'bitcoin-mainnet');

// Confirm Connect received the translated Trezor envelope.
assert.ok(makeMockConnect.lastSignArgs);
assert.equal(makeMockConnect.lastSignArgs.coin, 'btc');
assert.equal(makeMockConnect.lastSignArgs.inputs[0].script_type, 'SPENDWITNESS');
assert.deepEqual(
    makeMockConnect.lastSignArgs.inputs[0].address_n,
    [
        (84 | 0x80000000) >>> 0,
        (0 | 0x80000000) >>> 0,
        (0 | 0x80000000) >>> 0,
        0,
        5,
    ],
);

// ---------------------------------------------------------------
// 4. signMessage round-trip
// ---------------------------------------------------------------

const msg = await remote.signMessage({
    message: 'hello',
    chainId: 'bitcoin-mainnet',
    path: "m/84'/0'/0'/0/0",
});
assert.equal(msg.signature, 'ILmockSigBase64==');

// ---------------------------------------------------------------
// 5. getStatus round-trip
// ---------------------------------------------------------------

const status = await remote.getStatus();
assert.equal(status, 'available', 'transport → TrezorSigner.getStatus → "available"');

// ---------------------------------------------------------------
// 6. submitAction accepts an injected signer + skips password unlock
// ---------------------------------------------------------------

const submitActionSrc = readFileSync(
    join(core, 'src', 'flows', 'submitAction.js'), 'utf8',
);
assert.ok(
    /@property \{import\('\.\.\/signers\/Signer\.js'\)\.Signer\} \[signer\]/.test(submitActionSrc),
    'submitAction JSDoc advertises the optional signer param',
);
assert.ok(
    /signer: injectedSigner/.test(submitActionSrc),
    'submitAction destructures the signer param',
);
assert.ok(
    /const signer = injectedSigner\s*\n\s*\?\s*injectedSigner/.test(submitActionSrc),
    'submitAction skips unlockWallet when a signer is injected',
);
assert.ok(
    /if \(!injectedSigner && typeof signer\.lock === 'function'\)/.test(submitActionSrc),
    'submitAction only .lock()s when it built the signer itself',
);
assert.ok(
    /either `password` or `signer` is required/.test(submitActionSrc),
    'submitAction guards against neither-supplied',
);

// ---------------------------------------------------------------
// 7. normalizeSource admits HW sources (was a hard reject pre-Step 5)
// ---------------------------------------------------------------

const { normalizeSource } = flows;
const normalized = normalizeSource({
    address: 'bc1qhw',
    publicKey: '02hw',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'trezor',
});
assert.equal(normalized.address, 'bc1qhw');
assert.equal(normalized.derivationPath, "m/84'/0'/0'/0/0");
assert.throws(
    () => normalizeSource({
        address: 'bc1qwo', publicKey: '02wo', source: 'watch-only',
    }),
    /watch-only/,
    'watch-only is still rejected',
);

// ---------------------------------------------------------------
// 8. Shared UI primitives exist (component files + hook)
// ---------------------------------------------------------------

const hookPath = join(core, 'src', 'shared', 'hooks', 'useSignerStatus.js');
assert.ok(existsSync(hookPath), 'useSignerStatus hook exists');
const hookSrc = readFileSync(hookPath, 'utf8');
assert.ok(/export function useSignerStatus/.test(hookSrc));
assert.ok(/getStatus/.test(hookSrc));

const blockPath = join(core, 'src', 'shared', 'components', 'HwSignBlock.jsx');
const blockCssPath = join(core, 'src', 'shared', 'components', 'HwSignBlock.module.css');
assert.ok(existsSync(blockPath), 'HwSignBlock.jsx exists');
assert.ok(existsSync(blockCssPath), 'HwSignBlock.module.css exists');
const blockSrc = readFileSync(blockPath, 'utf8');
assert.ok(/export function HwSignBlock/.test(blockSrc));
assert.ok(/DerivationPathCrossCheck/.test(blockSrc), 'HwSignBlock composes the §18.5 cross-check block');
assert.ok(/useSignerStatus/.test(blockSrc), 'HwSignBlock uses the useSignerStatus hook');
assert.ok(/wrong-app/.test(blockSrc), 'HwSignBlock handles wrong-app');

// ---------------------------------------------------------------
// 9. Extension background: signerBridge registry + action.send.hw
//    + signer.status handlers (static + behavioral checks)
// ---------------------------------------------------------------

const ext = join(wsRoot, 'packages', 'extension');

const bridgePath = join(ext, 'src', 'background', 'signerBridge.js');
assert.ok(existsSync(bridgePath), 'signerBridge.js exists in extension background');
const bridgeSrc = readFileSync(bridgePath, 'utf8');
for (const sym of ['setTransport', 'getTransport', 'clearTransport', 'clearAll', 'registeredIds']) {
    assert.ok(
        new RegExp(`export function ${sym}\\b`).test(bridgeSrc),
        `signerBridge exports ${sym}`,
    );
}

// Runtime-check the module (import with file: URL since the test
// runner doesn't resolve the @xchain-wallet/extension workspace
// name).
const signerBridge = await import(
    `file://${bridgePath}`
);
assert.deepEqual(signerBridge.registeredIds(), []);
const mockPortTransport = async () => 'available';
signerBridge.setTransport('sig-x', mockPortTransport);
assert.deepEqual(signerBridge.registeredIds(), ['sig-x']);
assert.equal(signerBridge.getTransport('sig-x'), mockPortTransport);
assert.equal(signerBridge.getTransport('sig-y'), null);
signerBridge.clearTransport('sig-x');
assert.equal(signerBridge.getTransport('sig-x'), null);
signerBridge.setTransport('sig-x', mockPortTransport);
signerBridge.setTransport('sig-y', mockPortTransport);
signerBridge.clearAll();
assert.deepEqual(signerBridge.registeredIds(), []);

// Guard-rails.
assert.throws(() => signerBridge.setTransport('', mockPortTransport), /signerId/);
assert.throws(() => signerBridge.setTransport('sig-x', 'not a fn'), /must be a function/);

const bgPath = join(ext, 'src', 'background', 'createBackgroundHost.js');
const bgSrc = readFileSync(bgPath, 'utf8');
// signer.status is registered directly; the `.hw` action handlers go
// through the shared `registerHwHandler` helper.
assert.ok(
    /host\.register\('signer\.status'/.test(bgSrc),
    'background host registers signer.status',
);
for (const action of [
    'action.send.hw',
    'action.issue.hw',
    'action.mint.hw',
    'action.destroy.hw',
    'action.broadcast.hw',
    'action.dispenser.hw',
    'action.dividend.hw',
    'action.createList.hw',
    'action.airdrop.hw',
    'action.advanced.hw',
]) {
    assert.ok(
        new RegExp(`registerHwHandler\\('${action.replace(/\./g, '\\.')}'`).test(bgSrc),
        `background host registers ${action} via registerHwHandler`,
    );
}
assert.ok(
    /resolveSigner,\s*\n\s*buildRemoteSigner,/.test(bgSrc),
    'createBackgroundHost imports resolveSigner + buildRemoteSigner from core flows',
);
assert.ok(
    /signerBridge\.getTransport\(/.test(bgSrc),
    'action.send.hw looks up the transport via signerBridge',
);
assert.ok(
    /Hardware signer is not connected\./.test(bgSrc),
    'action.send.hw has a clear "not connected" error message',
);

// ---------------------------------------------------------------
// 10. Shell messaging helpers expose sendAssetHw + getSignerStatus
// ---------------------------------------------------------------

for (const [shell, msgPath] of [
    ['popup', join(ext, 'src', 'popup', 'messaging.js')],
    ['web', join(wsRoot, 'packages', 'web', 'src', 'messaging.js')],
    ['desktop', join(wsRoot, 'packages', 'desktop', 'renderer', 'messaging.js')],
]) {
    const msg = readFileSync(msgPath, 'utf8');
    for (const fn of ['sendAssetHw', 'getSignerStatus']) {
        assert.ok(
            new RegExp(`export function ${fn}\\b`).test(msg),
            `${shell} messaging exports ${fn}`,
        );
    }
    assert.ok(
        /sendMessage\('action\.send\.hw'/.test(msg),
        `${shell} sendAssetHw routes via action.send.hw`,
    );
    assert.ok(
        /sendMessage\('signer\.status'/.test(msg),
        `${shell} getSignerStatus routes via signer.status`,
    );
}

// ---------------------------------------------------------------
// 11. Send.jsx HW branch — renders HwSignBlock, not password
// ---------------------------------------------------------------

const sendSrc = readFileSync(
    join(core, 'src', 'shared', 'routes', 'Send.jsx'), 'utf8',
);
assert.ok(/import \{ HwSignBlock \}/.test(sendSrc), 'Send.jsx imports HwSignBlock');
assert.ok(/isHwSource/.test(sendSrc), 'Send.jsx gates on isHwSource');
assert.ok(
    /fromAddress\?\.source === 'trezor' \|\| fromAddress\?\.source === 'ledger'/.test(sendSrc),
    'Send.jsx detects HW source',
);
assert.ok(
    /messaging\.sendAssetHw\(/.test(sendSrc),
    'Send.jsx calls messaging.sendAssetHw in HW branch',
);
assert.ok(
    /messaging\.getSignerStatus\(/.test(sendSrc),
    'Send.jsx polls signer status via messaging.getSignerStatus',
);
assert.ok(
    /Sign on \$\{fromAddress\.source === 'trezor' \? 'Trezor' : 'Ledger'\}/.test(sendSrc),
    'Send.jsx shows "Sign on Trezor" / "Sign on Ledger" button copy',
);
assert.ok(
    /hwStatus !== 'available'/.test(sendSrc),
    'Send.jsx disables Submit until status=available',
);

// ---------------------------------------------------------------
// 12. Port-RPC wiring (core protocol + extension adapters)
// ---------------------------------------------------------------

// 12a. Core protocol module exports.
const protoPath = join(core, 'src', 'signers', 'signerPortProtocol.js');
assert.ok(existsSync(protoPath), 'signerPortProtocol.js exists in core');
const protoSrc = readFileSync(protoPath, 'utf8');
for (const sym of ['bindRendererPortBridge', 'createBackgroundTransport']) {
    assert.ok(
        new RegExp(`export function ${sym}\\b`).test(protoSrc),
        `signerPortProtocol exports ${sym}`,
    );
}
// Core barrel re-exports both.
assert.equal(typeof signers.bindRendererPortBridge, 'function');
assert.equal(typeof signers.createBackgroundTransport, 'function');

// 12b. Popup-side bridge module.
const popupBridgePath = join(ext, 'src', 'popup', 'signerBridge.js');
assert.ok(existsSync(popupBridgePath), 'popup signerBridge.js exists');
const popupBridgeSrc = readFileSync(popupBridgePath, 'utf8');
for (const sym of ['registerSigner', 'unregisterSigner', 'registeredIds']) {
    assert.ok(
        new RegExp(`export function ${sym}\\b`).test(popupBridgeSrc),
        `popup signerBridge exports ${sym}`,
    );
}
assert.ok(
    /chrome\.runtime\.connect/.test(popupBridgeSrc) || /chromeRuntime\.connect/.test(popupBridgeSrc),
    'popup signerBridge opens chrome.runtime.connect',
);
assert.ok(
    /name: 'signer-bridge'/.test(popupBridgeSrc),
    'popup signerBridge uses the agreed port name',
);
assert.ok(
    /bindRendererPortBridge/.test(popupBridgeSrc),
    'popup signerBridge imports the core bridge binder',
);

// 12c. Background-side port listener.
const bgListenerPath = join(ext, 'src', 'background', 'signerBridgeListener.js');
assert.ok(existsSync(bgListenerPath), 'background signerBridgeListener.js exists');
const bgListenerSrc = readFileSync(bgListenerPath, 'utf8');
assert.ok(
    /export function attachSignerBridgeListener/.test(bgListenerSrc),
    'attachSignerBridgeListener exported',
);
assert.ok(
    /onConnect/.test(bgListenerSrc) && /signer-bridge/.test(bgListenerSrc),
    'listener filters on the signer-bridge port name',
);
assert.ok(
    /signerBridge\.setTransport/.test(bgListenerSrc),
    'listener populates signerBridge.setTransport on register',
);
assert.ok(
    /signerBridge\.clearTransport/.test(bgListenerSrc),
    'listener drops registrations on disconnect',
);
assert.ok(
    /createBackgroundTransport/.test(bgListenerSrc),
    'listener wraps the port via createBackgroundTransport',
);

// 12d. Background entrypoint calls attachSignerBridgeListener.
const bgEntryPath = join(ext, 'src', 'background.js');
const bgEntrySrc = readFileSync(bgEntryPath, 'utf8');
assert.ok(
    /attachSignerBridgeListener\(\)/.test(bgEntrySrc),
    'background.js attaches the signer-bridge listener at startup',
);

// 12e. PairSignerForm threads the live signer through onSignerPaired.
const pairSrc = readFileSync(
    join(core, 'src', 'shared', 'routes', 'PairSignerForm.jsx'), 'utf8',
);
assert.ok(/onSignerPaired/.test(pairSrc), 'PairSignerForm accepts onSignerPaired');
assert.ok(
    /setLiveSigner\(signer\)/.test(pairSrc),
    'PairSignerForm captures the live signer from the pair factory',
);
assert.ok(
    /onSignerPaired\(record\.id, liveSigner\)/.test(pairSrc),
    'PairSignerForm calls onSignerPaired after the SignerRecord is persisted',
);

// 12f. Popup App.jsx wires the signer bridge as onSignerPaired.
const popupAppSrc = readFileSync(
    join(ext, 'src', 'popup', 'App.jsx'), 'utf8',
);
assert.ok(
    /registerSigner as registerLocalSigner/.test(popupAppSrc),
    'popup App imports the bridge registerSigner',
);
assert.ok(
    /onSignerPaired=\{registerLocalSigner\}/.test(popupAppSrc),
    'popup App passes onSignerPaired={registerLocalSigner} to PairSignerForm',
);

// ---------------------------------------------------------------
// 13. Slice-4 multi-stage form HW branches
// ---------------------------------------------------------------

// 13a. DispenserForm — create path.
const dispFormSrc = readFileSync(
    join(core, 'src', 'shared', 'routes', 'DispenserForm.jsx'), 'utf8',
);
assert.ok(
    /SignCredentials/.test(dispFormSrc) && /isHwSource/.test(dispFormSrc),
    'DispenserForm imports SignCredentials + isHwSource',
);
assert.ok(
    /messaging\.dispenserActionHw\(/.test(dispFormSrc),
    'DispenserForm calls messaging.dispenserActionHw in HW branch',
);
assert.ok(
    /hwStatus !== 'available'/.test(dispFormSrc),
    'DispenserForm gates submit on HW status=available',
);

// 13b. DispenserDetail — owner-cancel + non-owner-buy submit points.
const dispDetailSrc = readFileSync(
    join(core, 'src', 'shared', 'routes', 'DispenserDetail.jsx'), 'utf8',
);
assert.ok(
    /SignCredentials/.test(dispDetailSrc) && /isHwSource/.test(dispDetailSrc),
    'DispenserDetail imports SignCredentials + isHwSource',
);
assert.ok(
    /messaging\.sendAssetHw\(/.test(dispDetailSrc),
    'DispenserDetail buy path calls messaging.sendAssetHw for HW buyers',
);
assert.ok(
    /messaging\.dispenserActionHw\(/.test(dispDetailSrc),
    'DispenserDetail cancel path calls messaging.dispenserActionHw for HW owners',
);
assert.ok(
    /buyHwStatus/.test(dispDetailSrc) && /cancelHwStatus/.test(dispDetailSrc),
    'DispenserDetail tracks buy + cancel HW statuses separately',
);

// 13c. AirdropForm — two independent sign points.
const airdropFormSrc = readFileSync(
    join(core, 'src', 'shared', 'routes', 'AirdropForm.jsx'), 'utf8',
);
assert.ok(
    /SignCredentials/.test(airdropFormSrc) && /isHwSource/.test(airdropFormSrc),
    'AirdropForm imports SignCredentials + isHwSource',
);
assert.ok(
    /messaging\.createListHw\(/.test(airdropFormSrc),
    'AirdropForm LIST sign calls messaging.createListHw in HW branch',
);
assert.ok(
    /messaging\.airdropActionHw\(/.test(airdropFormSrc),
    'AirdropForm AIRDROP sign calls messaging.airdropActionHw in HW branch',
);
assert.ok(
    /confirm on your hardware device twice/.test(airdropFormSrc),
    'AirdropForm explains two-sign cadence to HW users',
);

// ---------------------------------------------------------------
// 14. Desktop ipc port RPC — signerBridge + listener + App wiring
// ---------------------------------------------------------------

const desktop = join(wsRoot, 'packages', 'desktop');

// 14a. Renderer-side bridge module.
const desktopBridgePath = join(desktop, 'renderer', 'signerBridge.js');
assert.ok(existsSync(desktopBridgePath), 'desktop renderer signerBridge.js exists');
const desktopBridgeSrc = readFileSync(desktopBridgePath, 'utf8');
for (const sym of ['registerSigner', 'unregisterSigner', 'registeredIds']) {
    assert.ok(
        new RegExp(`export function ${sym}\\b`).test(desktopBridgeSrc),
        `desktop signerBridge exports ${sym}`,
    );
}
assert.ok(
    /bindRendererPortBridge/.test(desktopBridgeSrc),
    'desktop signerBridge uses the core port-bridge binder',
);
assert.ok(
    /xchainWalletSignerBridge/.test(desktopBridgeSrc),
    'desktop signerBridge reads the preload-exposed window bridge',
);

// 14b. Main-process listener.
const desktopListenerPath = join(desktop, 'main', 'signerBridgeListener.js');
assert.ok(existsSync(desktopListenerPath), 'desktop main signerBridgeListener.js exists');
const desktopListenerSrc = readFileSync(desktopListenerPath, 'utf8');
assert.ok(
    /export function attachSignerBridgeListener/.test(desktopListenerSrc),
    'desktop listener exports attachSignerBridgeListener',
);
assert.ok(
    /createBackgroundTransport/.test(desktopListenerSrc),
    'desktop listener wraps ipc into createBackgroundTransport',
);
assert.ok(
    /signerBridge\.setTransport/.test(desktopListenerSrc)
    && /signerBridge\.clearTransport/.test(desktopListenerSrc),
    'desktop listener populates + clears signerBridge transports',
);
assert.ok(
    /xchain-wallet:signer-bridge/.test(desktopListenerSrc),
    'desktop listener uses the agreed ipc channel name',
);

// 14c. Preload exposes the duplex bridge surface.
const preloadSrc = readFileSync(join(desktop, 'preload.js'), 'utf8');
assert.ok(
    /xchainWalletSignerBridge/.test(preloadSrc)
    && /contextBridge\.exposeInMainWorld/.test(preloadSrc),
    'desktop preload exposes xchainWalletSignerBridge via contextBridge',
);
assert.ok(
    /postMessage/.test(preloadSrc) && /onMessage/.test(preloadSrc),
    'desktop preload exposes postMessage + onMessage',
);

// 14d. Main index wires the listener at startup.
const desktopMainSrc = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
assert.ok(
    /attachSignerBridgeListener\(\{ ipcMain \}\)/.test(desktopMainSrc),
    'desktop main index calls attachSignerBridgeListener with ipcMain',
);

// 14e. Desktop App.jsx threads registerLocalSigner into PairSignerForm.
const desktopAppSrc = readFileSync(join(desktop, 'renderer', 'App.jsx'), 'utf8');
assert.ok(
    /registerSigner as registerLocalSigner/.test(desktopAppSrc),
    'desktop App imports the bridge registerSigner',
);
assert.ok(
    /onSignerPaired=\{registerLocalSigner\}/.test(desktopAppSrc),
    'desktop App passes onSignerPaired={registerLocalSigner} to PairSignerForm',
);

console.log(
    'OK — hw-sign-e2e smoke (resolveSigner descriptor branches; buildRemoteSigner; full RemoteSigner → TrezorSigner → sdk.decomposePsbt → trezorFormat → Connect chain; submitAction signer param bypass; normalizeSource admits HW; shared UI primitives; signerBridge registry; action.send.hw + signer.status handlers wired; sendAssetHw + getSignerStatus exposed in popup/web/desktop messaging; Send.jsx renders HwSignBlock for HW sources with "Sign on [device]" button; signerPortProtocol bridge both ends + popup bridge + background listener wired; PairSignerForm + popup App register live signer with the bridge; slice-4 HW branches on DispenserForm + DispenserDetail (cancel + buy) + AirdropForm (LIST + AIRDROP); desktop ipc port RPC — renderer signerBridge + main signerBridgeListener + preload duplex bridge + desktop App onSignerPaired)',
);
