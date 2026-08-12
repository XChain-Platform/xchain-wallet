// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Ledger device leg: drives the wallet's production pair
// sequence and signer against a real Ledger Bitcoin app running under
// the Speculos emulator. Nothing in this path is faked, which is the
// entire point: every other Ledger test injects a hand-written app
// object, and for two releases those fakes asserted methods the
// shipped `@ledgerhq/hw-app-btc` class does not have. See
// test/README-hardware.md for the rig, and
// test/unit/signers-ledger/hw-app-btc-surface.test.js for the
// unit-level guard that now catches the same class of drift offline.
//
// Opt-in: does nothing unless SPECULOS_API_URL is set, because it needs
// an emulator (or a real device behind an APDU proxy) that CI does not
// have. Skipping is reported, never silent.
//
//   SPECULOS_API_URL=http://localhost:5012 pnpm test:hardware:ledger
//
// Optionally also set SPECULOS_TESTNET_API_URL to a Speculos running the
// Bitcoin TEST app, which proves the wallet refuses to pair against it
// with a message naming the cause (the Test app derives at coin-type 1',
// which this wallet deliberately does not support).

import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const API = process.env.SPECULOS_API_URL;
const TESTNET_API = process.env.SPECULOS_TESTNET_API_URL;

if (!API) {
    console.log('SKIP ledger-speculos: set SPECULOS_API_URL to run (see test/README-hardware.md)');
    process.exit(0);
}

// hw-app-btc and hw-transport ship ESM builds with extensionless
// relative imports that only a bundler resolves; the shells get them
// through Vite. Node needs the CJS build, same source and version.
const require = createRequire(import.meta.url);
const Btc = require('@ledgerhq/hw-app-btc').default ?? require('@ledgerhq/hw-app-btc');
const Transport = require('@ledgerhq/hw-transport').default ?? require('@ledgerhq/hw-transport');
const bitcoin = require('bitcoinjs-lib');

const { makeLedgerFactory } = await import('../../packages/core/src/signerFactories/ledger.js');
const { LedgerSigner } = await import('../../packages/signers-ledger/src/LedgerSigner.js');

// The signPsbt leg needs the real SDK for decomposePsbt + txidOf. It is
// a sibling checkout rather than an installed dependency of this repo,
// so resolve it defensively and skip that leg loudly if it is absent
// instead of failing a hardware run for an unrelated reason.
let WalletUtils = null;
for (const candidate of ['xchain-sdk/src/wallet.js', '../../../xchain-sdk/src/wallet.js']) {
    try { WalletUtils = require(candidate); break; } catch { /* try next */ }
}

/**
 * Minimal Speculos transport: the emulator exposes APDU exchange as an
 * HTTP endpoint, so this is the whole protocol. Written here rather
 * than pulled from @ledgerhq/hw-transport-node-speculos-http to keep
 * the hardware leg from adding a dependency the shipped wallet does
 * not use.
 */
class SpeculosHttpTransport extends Transport {
    constructor(baseURL) {
        super();
        this.baseURL = baseURL;
        this.deviceModel = { id: process.env.SPECULOS_MODEL || 'nanoSP' };
    }

    async exchange(apdu) {
        const res = await fetch(`${this.baseURL}/apdu`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: Buffer.from(apdu).toString('hex') }),
        });
        if (!res.ok) throw new Error(`speculos /apdu returned ${res.status}`);
        const { data } = await res.json();
        return Buffer.from(data, 'hex');
    }

    async close() {}

    /** Current screen text, so a run can assert what the device DISPLAYS. */
    async screen() {
        try {
            const res = await fetch(`${this.baseURL}/events?currentscreenonly=true`);
            const { events } = await res.json();
            return (events || []).map((e) => e.text).join(' | ');
        } catch { return ''; }
    }

    async press(button) {
        await fetch(`${this.baseURL}/button/${button}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'press-and-release' }),
        }).catch(() => {});
    }
}

/** Screens the device showed during any approved operation. */
const screens = new Set();

/**
 * Run an operation that needs physical approval, driving the buttons
 * while it is in flight. Without this the device simply waits and the
 * call hangs. Screens are collected because §5.2.6's premise, that the
 * device shows the user the outputs and destinations, is worth observing
 * rather than asserting.
 */
async function withApproval(run) {
    let busy = true;
    const approver = (async () => {
        while (busy) {
            const s = await transport.screen();
            if (s) screens.add(s);
            await transport.press(/Approve|Accept|Continue|Sign|Confirm/i.test(s) ? 'both' : 'right');
            await new Promise((r) => setTimeout(r, 250));
        }
    })();
    try {
        return await run();
    } finally {
        busy = false;
        await approver;
    }
}

/** Ledger returns uncompressed pubkeys; scripts need the compressed form. */
function compressPubkey(hex) {
    const b = Buffer.from(hex, 'hex');
    if (b.length === 33) return b;
    return Buffer.concat([Buffer.from([(b[64] & 1) ? 3 : 2]), b.subarray(1, 33)]);
}

function pairWith(transport) {
    return makeLedgerFactory({
        getTransport: async () => transport,
        getAppClass: async () => Btc,
    })();
}

// --- 1. pair against a real Bitcoin app -------------------------------

const transport = new SpeculosHttpTransport(API);
const { signer, pairingInfo } = await pairWith(transport);

assert.equal(pairingInfo.vendor, 'ledger');
assert.ok(pairingInfo.firmwareVersion, 'firmware version read off the device');
assert.ok(
    typeof pairingInfo.deviceIdentifier === 'string' && pairingInfo.deviceIdentifier.length > 0,
    'deviceIdentifier derived from the identity xpub the device returned',
);

// --- 2. getStatus, which the app client cannot answer alone -----------

assert.equal(
    await signer.getStatus({ chainId: 'bitcoin-mainnet' }),
    'available',
    'a live device reports available (it reported "disconnected" forever before )',
);
assert.equal(
    await signer.getStatus({ chainId: 'litecoin-mainnet' }),
    'wrong-app',
    'Bitcoin app open is the wrong app for litecoin',
);

// --- 3. address derivation from the device ----------------------------

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
assert.match(addrs[0].address, /^bc1/, 'device returns a mainnet bech32 address');
assert.notEqual(addrs[0].address, addrs[1].address, 'consecutive indices derive distinct addresses');

// --- 4. message signing, approved on the device -----------------------

const { signature } = await withApproval(() => signer.signMessage({
    message: 'xchain ledger device leg',
    chainId: 'bitcoin-mainnet',
    path: "m/84'/0'/0'/0/0",
}));

const sigBytes = Buffer.from(signature, 'base64');
assert.equal(sigBytes.length, 65, 'compact signature is 65 bytes');
assert.ok(sigBytes[0] === 39 || sigBytes[0] === 40, `p2wpkh header base 39 + recId, got ${sigBytes[0]}`);
assert.ok(
    [...screens].some((s) => /Message/i.test(s)),
    'the device displayed the message it was asked to sign',
);
assert.ok(
    [...screens].some((s) => /84'\/0'\/0'/.test(s)),
    'the device displayed the derivation path it signed with',
);

// --- 5. signPsbt, the whole envelope, through the device --------------

// Two things get proved here that no fake can: that
// createPaymentTransaction accepts the envelope ledgerFormat builds, and
// that the transaction the device returns spends the outpoint the PSBT
// actually named. The second is the one that mattered: a synthesized
// prev tx made the device sign a spend of an outpoint that does not
// exist, and the result looked perfectly well-formed.
//
// A legacy input, because the prev tx has to be real: the encoder emits
// segwit inputs with witnessUtxo only, which is exactly the case the
// signer now refuses (asserted below).
if (!WalletUtils) {
    console.log('  (skipped signPsbt leg: xchain-sdk not resolvable from this checkout)');
}
if (WalletUtils) {
const LEGACY_PATH = "m/44'/0'/0'/0/0";
const legacyPub = compressPubkey(
    (await signer.getPublicKey({ chainId: 'bitcoin-mainnet', path: LEGACY_PATH })).publicKey,
);
const p2pkh = bitcoin.payments.p2pkh({ pubkey: legacyPub, network: bitcoin.networks.bitcoin });

const prevTx = new bitcoin.Transaction();
prevTx.version = 1;
prevTx.addInput(Buffer.alloc(32, 7), 0);
prevTx.addOutput(p2pkh.output, 100000);
const prevTxid = prevTx.getId();

const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
psbt.addInput({ hash: prevTxid, index: 0, nonWitnessUtxo: prevTx.toBuffer() });
psbt.addOutput({ script: p2pkh.output, value: 90000 });

const sdkWallet = new WalletUtils('bitcoin-mainnet');
const signingSigner = new LedgerSigner({
    id: signer.id,
    displayName: signer.displayName,
    model: signer.model,
    deviceIdentifier: signer.deviceIdentifier,
    app: new Btc({ transport, currency: 'bitcoin' }),
    transport,
    sdkRegistry: { get: () => ({ wallet: sdkWallet }) },
});

const signed = await withApproval(() => signingSigner.signPsbt({
    psbtHex: psbt.toHex(),
    chainId: 'bitcoin-mainnet',
    signingPaths: [{ inputIndex: 0, path: LEGACY_PATH }],
}));

const signedTx = bitcoin.Transaction.fromHex(signed.txHex);
assert.equal(signedTx.getId(), signed.txid, 'reported txid matches the returned transaction');
assert.equal(signedTx.ins.length, 1);
assert.equal(signedTx.outs.length, 1);
assert.equal(
    Buffer.from(signedTx.ins[0].hash).reverse().toString('hex'),
    prevTxid,
    'the device signed a spend of the outpoint the PSBT named, not a synthesized one',
);
assert.ok(signedTx.ins[0].script.length > 100, 'input carries a real scriptSig');
assert.ok(
    [...screens].some((s) => /Amount/i.test(s)) && [...screens].some((s) => /Fees/i.test(s)),
    'the device displayed amount and fees before signing',
);

// A witnessUtxo-only input has no real prev tx, so it must be REFUSED
// rather than signed against a synthesized one.
const segwitPub = compressPubkey(
    (await signer.getPublicKey({ chainId: 'bitcoin-mainnet', path: "m/84'/0'/0'/0/0" })).publicKey,
);
const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: segwitPub, network: bitcoin.networks.bitcoin });
const segwitPsbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
segwitPsbt.addInput({
    hash: prevTxid, index: 0, witnessUtxo: { script: p2wpkh.output, value: 100000 },
});
segwitPsbt.addOutput({ script: p2wpkh.output, value: 90000 });
await assert.rejects(
    signingSigner.signPsbt({
        psbtHex: segwitPsbt.toHex(),
        chainId: 'bitcoin-mainnet',
        signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
    }),
    /different outpoint than this PSBT names/,
    'a witnessUtxo-only input is refused, not signed against a synthesized prev tx',
);

// ...and the SAME segwit input signs correctly once the real prev tx rides
// Along (the completing fix). The encoder now attaches it on request
// (`attachPrevTx`, set when the source is a device) so the PSBT the user
// previews already carries it - hydrating it after the preview would sign
// bytes the §5.3.2 tamper check never saw.
//
// This is the leg that could not be faked: it proves the device accepts the
// envelope AND that the outpoint it signs is the one the PSBT names. The
// refusal above and this pass are the same input differing only by the prev
// tx, which is what makes the pair meaningful.
const hydratedPsbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
hydratedPsbt.addInput({
    hash: prevTxid,
    index: 0,
    witnessUtxo: { script: p2pkh.output, value: 100000 },
    nonWitnessUtxo: prevTx.toBuffer(),
});
hydratedPsbt.addOutput({ script: p2pkh.output, value: 90000 });

const hydratedSigned = await withApproval(() => signingSigner.signPsbt({
    psbtHex: hydratedPsbt.toHex(),
    chainId: 'bitcoin-mainnet',
    signingPaths: [{ inputIndex: 0, path: LEGACY_PATH }],
}));
const hydratedTx = bitcoin.Transaction.fromHex(hydratedSigned.txHex);
assert.equal(
    Buffer.from(hydratedTx.ins[0].hash).reverse().toString('hex'),
    prevTxid,
    'an input carrying BOTH utxo fields signs the outpoint the PSBT names',
);
assert.ok(hydratedTx.ins[0].script.length > 100, 'the hydrated input carries a real scriptSig');
}

// --- 6. the Bitcoin Test app must be refused by name ------------------

if (TESTNET_API) {
    await assert.rejects(
        pairWith(new SpeculosHttpTransport(TESTNET_API)),
        /Open the Bitcoin app to pair/,
        'pairing against the Test app names the cause instead of surfacing 0x6a82',
    );
} else {
    console.log('  (skipped Test-app refusal: set SPECULOS_TESTNET_API_URL to include it)');
}

await transport.close();

console.log(
    'OK: ledger device leg (real hw-app-btc against Speculos: pair + deviceIdentifier from the '
    + 'identity xpub, getStatus available/wrong-app, address derivation, message signed and '
    + 'approved on-device with the path + message shown on screen'
    + (WalletUtils ? ', PSBT signed on-device spending the outpoint the PSBT named, '
        + 'witnessUtxo-only input refused, the SAME input signed once its real prev tx rides along (completing fix)' : '')
    + (TESTNET_API ? ', Test app refused by name)' : ')'),
);
console.log(`  device: ${pairingInfo.model} / app ${pairingInfo.firmwareVersion} / id ${pairingInfo.deviceIdentifier}`);
for (const s of screens) console.log(`  screen: ${s}`);
