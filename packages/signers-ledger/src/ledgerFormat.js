// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Ledger hw-app-btc envelope builder: pure data transform from the
// SDK's normalized PSBT decomposition (§17.4 / §18.2) into the
// `createPaymentTransaction` arguments `@ledgerhq/hw-app-btc`
// expects. Paired with LedgerSigner.signPsbt.
//
// Ledger's `createPaymentTransaction` takes:
//   - inputs: Array<[splitTxOrHex, vout, redeemScript?, sequence?]>
//   - associatedKeysets: string[]       BIP32 path per input
//   - outputScriptHex: string           serialized outputs (varint + outs)
//   - changePath?: string
//   - sigHashType?: number
//   - segwit: boolean
//   - additionals: string[]             e.g. ['bech32'] for native segwit
//
// For p2wpkh inputs the PSBT only carries a witnessUtxo (scriptPubKey
// + value). Ledger still wants a prev-transaction structure to
// compute BIP143 sighashes, so the converter synthesizes a minimal
// valid raw tx for each segwit input that places the right output at
// the right vout. The caller passes the resulting `inputs[i].prevTxHex`
// to the signer, which runs `app.splitTransaction` on it at call time.

/**
 * Map an XChain chainId to the Ledger Bitcoin app currency string used
 * for `additionals`. Matches the `format` / `additionals` conventions
 * of `@ledgerhq/hw-app-btc`.
 *
 * @param {string} chainId
 * @returns {string}
 */
export function chainIdToLedgerCurrency(chainId) {
    // Ledger currencies map to installed device apps. There are Bitcoin,
    // Bitcoin Test, Litecoin, and Dogecoin apps, but NO Litecoin-testnet,
    // Dogecoin-testnet, or regtest apps. Those chainIds fall through to the
    // throw, and the wallet uses a software signer for them.
    //
    // bitcoin-testnet is excluded even though the Bitcoin Test app exists: that
    // app forces SLIP-44 coin-type 1', while the wallet's descriptor anchor
    // deliberately pins 0' on every Bitcoin network (software-signer/backend
    // parity). A 1' hardware derivation silently yields addresses the rest of
    // the wallet cannot see, so the network is hardware-unsupported instead.
    switch (chainId) {
        case 'bitcoin-mainnet': return 'bitcoin';
        case 'litecoin-mainnet': return 'litecoin';
        case 'dogecoin-mainnet': return 'dogecoin';
        case 'bitcoin-testnet':
            throw new Error(
                'ledgerFormat: bitcoin-testnet is not supported on this hardware '
                + 'signer; use a software wallet for this network. (On this network '
                + 'the device would derive a different set of addresses than the rest '
                + 'of the wallet, so any funds would appear missing.)',
            );
        default:
            throw new Error(
                `ledgerFormat: unsupported chainId "${chainId}". No Ledger app `
                + 'exists for Litecoin/Dogecoin testnet or regtest; use a software '
                + 'wallet for this network.',
            );
    }
}

/**
 * Serialize a non-negative integer as a Bitcoin varint.
 *
 * @param {number} n
 * @returns {number[]}  byte values
 */
function varint(n) {
    if (n < 0xfd) return [n];
    if (n <= 0xffff) return [0xfd, n & 0xff, (n >> 8) & 0xff];
    if (n <= 0xffffffff) {
        return [
            0xfe,
            n & 0xff,
            (n >> 8) & 0xff,
            (n >> 16) & 0xff,
            (n >>> 24) & 0xff,
        ];
    }
    throw new Error('ledgerFormat: varint > u32 not supported');
}

/**
 * Little-endian 8-byte encoding of a non-negative integer value.
 * Uses BigInt internally so values above 2^53 serialize correctly.
 *
 * @param {number} n
 * @returns {number[]}
 */
function u64le(n) {
    const out = new Array(8);
    let v = BigInt(n);
    for (let i = 0; i < 8; i += 1) {
        out[i] = Number(v & 0xffn);
        v >>= 8n;
    }
    return out;
}

function hexToBytes(hex) {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) {
        throw new Error('ledgerFormat: hex string has odd length');
    }
    const out = new Array(clean.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return out;
}

function bytesToHex(bytes) {
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
}

/**
 * Serialize the outputs section of a Bitcoin tx: varint(count) +
 * for each output 8-byte LE value + varint(scriptLen) + script.
 *
 * @param {Array<{ value: number, scriptPubKeyHex: string }>} outputs
 * @returns {string}  hex
 */
export function serializeOutputs(outputs) {
    const buf = [];
    buf.push(...varint(outputs.length));
    for (const out of outputs) {
        buf.push(...u64le(out.value));
        const scriptBytes = hexToBytes(out.scriptPubKeyHex);
        buf.push(...varint(scriptBytes.length));
        buf.push(...scriptBytes);
    }
    return bytesToHex(buf);
}

/**
 * Build a minimal valid raw transaction hex placing the given output
 * at `vout`. Used for segwit inputs where the PSBT only carries a
 * witnessUtxo (no full prev-tx). Ledger treats the synthesized tx as
 * a carrier for scriptPubKey + value at the given vout; the inputs
 * and surrounding outputs are zeroed.
 *
 * Layout (non-segwit): version(4 LE) + inputCount(varint) + inputs +
 * outputCount(varint) + outputs + locktime(4 LE).
 *
 * NOT USABLE FOR BUILDING A SPEND, and no longer used by
 * `toLedgerCreatePayment` . Ledger takes the outpoint it signs
 * from the bytes of the prev tx it is handed, and a synthesized tx
 * hashes to a different txid than the real one by construction, so
 * feeding this in makes the device sign a spend of an outpoint that
 * does not exist. Kept only as a carrier for scriptPubKey + value in
 * contexts where the txid is irrelevant.
 *
 * @param {number} vout
 * @param {number} value
 * @param {string} scriptPubKeyHex
 * @returns {string}  raw tx hex
 */
export function synthesizeMinimalPrevTx(vout, value, scriptPubKeyHex) {
    if (!Number.isInteger(vout) || vout < 0) {
        throw new Error('synthesizeMinimalPrevTx: vout must be a non-negative integer');
    }
    const buf = [];
    // nVersion = 1
    buf.push(0x01, 0x00, 0x00, 0x00);
    // one dummy input: null prev hash + 0xffffffff vout + empty script + max sequence
    buf.push(0x01);
    for (let i = 0; i < 32; i += 1) buf.push(0x00);
    buf.push(0xff, 0xff, 0xff, 0xff);
    buf.push(0x00);
    buf.push(0xff, 0xff, 0xff, 0xff);
    // outputs: (vout+1) entries; the target sits at [vout], others are
    // zero-value zero-script placeholders.
    buf.push(...varint(vout + 1));
    for (let i = 0; i < vout; i += 1) {
        buf.push(...u64le(0));
        buf.push(0x00);
    }
    buf.push(...u64le(value));
    const scriptBytes = hexToBytes(scriptPubKeyHex);
    buf.push(...varint(scriptBytes.length));
    buf.push(...scriptBytes);
    // locktime = 0
    buf.push(0x00, 0x00, 0x00, 0x00);
    return bytesToHex(buf);
}

/**
 * Resolve the prev-tx hex to feed into Ledger's splitTransaction for
 * an input. Prefer the real nonWitnessUtxoHex (legacy lane); fall
 * back to a synthesized minimal tx when the PSBT only carries a
 * witnessUtxo (segwit lane).
 *
 * @param {import('./types.js').DecomposedPsbtInput} inp
 * @returns {string}
 */
function prevTxHexForInput(inp) {
    if (inp.nonWitnessUtxoHex) return inp.nonWitnessUtxoHex;

    // A synthesized prev tx CANNOT be used to build a spend, and this used
    // to do exactly that for every witnessUtxo-only input .
    // Ledger derives the outpoint it signs from the bytes of the prev tx it
    // is handed, and a synthesized tx hashes to a different txid than the
    // real one by construction. The device happily produced a fully-formed,
    // correctly-witnessed transaction that spent an outpoint which does not
    // exist, so it could never be broadcast. Verified on a real device: the
    // signed input matched the synthesized txid, not the PSBT's.
    //
    // This is the wallet's DEFAULT path, not an edge case: the encoder
    // builds segwit inputs with witnessUtxo only (XChainEncoder.js), and
    // p2wpkh is the default address type. Fail closed; refusing to sign is
    // strictly better than emitting an invalid signature over the wrong
    // outpoint. See test/README-hardware.md for the completing fix, which
    // has to supply the real prev tx.
    if (inp.witnessUtxoScriptHex) {
        throw new Error(
            'ledgerFormat: input has only a witnessUtxo, so the previous transaction is '
            + 'unavailable. Ledger takes the outpoint from the previous transaction it is '
            + 'given, so signing here would spend a different outpoint than this PSBT names. '
            + 'Supply the input\'s nonWitnessUtxo (the full previous transaction) to sign it '
            + 'on hardware.',
        );
    }
    throw new Error(
        'ledgerFormat: input has neither nonWitnessUtxoHex nor witnessUtxoScriptHex',
    );
}

/**
 * @param {string} scriptType
 * @returns {boolean}  whether the whole tx should sign as segwit for Ledger
 */
function isSegwitScriptType(scriptType) {
    return scriptType === 'p2wpkh'
        || scriptType === 'p2sh-p2wpkh'
        || scriptType === 'p2wsh'
        || scriptType === 'p2sh-p2wsh';
}

/**
 * Build the Ledger `createPaymentTransaction` payload as a pure JS
 * object. The signer then feeds each `inputs[i].prevTxHex` through
 * `app.splitTransaction(...)` at call time.
 *
 * @param {Object} opts
 * @param {import('./types.js').DecomposedPsbt} opts.decomposed
 * @param {string} opts.chainId
 * @param {Array<{inputIndex: number, path: string}>} opts.signingPaths
 * @param {number} [opts.lockTime]
 * @returns {{
 *   inputs: Array<{ prevTxHex: string, vout: number, redeemScriptHex: (string|null), sequence: number }>,
 *   associatedKeysets: string[],
 *   outputScriptHex: string,
 *   lockTime: number,
 *   segwit: boolean,
 *   additionals: string[],
 *   currency: string,
 * }}
 */
export function toLedgerCreatePayment({ decomposed, chainId, signingPaths, lockTime }) {
    if (!decomposed || !Array.isArray(decomposed.inputs)) {
        throw new Error('toLedgerCreatePayment: decomposed PSBT is required');
    }
    if (!Array.isArray(signingPaths) || signingPaths.length === 0) {
        throw new Error('toLedgerCreatePayment: signingPaths must be non-empty');
    }

    /** @type {Map<number, { path: string }>} */
    const pathByIndex = new Map();
    for (const sp of signingPaths) {
        if (typeof sp.inputIndex !== 'number' || !sp.path) {
            throw new Error(
                'toLedgerCreatePayment: every signingPaths entry needs { inputIndex, path }',
            );
        }
        pathByIndex.set(sp.inputIndex, sp);
    }

    const segwit = decomposed.inputs.every((i) => isSegwitScriptType(i.scriptType));
    const anyNative = decomposed.inputs.some((i) => i.scriptType === 'p2wpkh' || i.scriptType === 'p2wsh');
    const additionals = anyNative ? ['bech32'] : [];

    const inputs = decomposed.inputs.map((inp, idx) => {
        const sp = pathByIndex.get(idx);
        if (!sp) throw new Error(`toLedgerCreatePayment: no signingPath for input index ${idx}`);
        return {
            prevTxHex: prevTxHexForInput(inp),
            vout: inp.prevTxIndex,
            redeemScriptHex: inp.redeemScriptHex ?? null,
            sequence: inp.sequence,
        };
    });

    const associatedKeysets = inputs.map((_, idx) => pathByIndex.get(idx).path);

    const outputScriptHex = serializeOutputs(
        decomposed.outputs.map((o) => ({
            value: o.value,
            scriptPubKeyHex: o.scriptPubKeyHex,
        })),
    );

    return {
        inputs,
        associatedKeysets,
        outputScriptHex,
        lockTime: typeof lockTime === 'number' ? lockTime : decomposed.locktime || 0,
        segwit,
        additionals,
        currency: chainIdToLedgerCurrency(chainId),
    };
}

/** @type {Record<string, number>} */
const HEADER_BASE_BY_ADDRESS_TYPE = {
    p2pkh: 31,          // compressed p2pkh
    'p2sh-p2wpkh': 35,  // compressed segwit nested
    p2wpkh: 39,         // compressed native segwit
};

/**
 * Address type implied by a BIP44 path's purpose component. Matches
 * the purpose constants used across xchain-wallet address derivation.
 *
 * @param {string} path
 * @returns {'p2pkh'|'p2sh-p2wpkh'|'p2wpkh'}
 */
export function addressTypeFromPath(path) {
    const m = /^m\/(\d+)'/.exec(path);
    const purpose = m?.[1];
    if (purpose === '84') return 'p2wpkh';
    if (purpose === '49') return 'p2sh-p2wpkh';
    if (purpose === '44') return 'p2pkh';
    throw new Error(`ledgerFormat: cannot infer address type from path "${path}"`);
}

/**
 * Ledger's `signMessage` returns `{ v, r, s }` with `v` as the
 * recovery id (0 or 1). Bitcoin's compact message-signature format is
 * 65 bytes: [header][r:32][s:32] where the header byte encodes both
 * the recovery id and the address type. This function composes the
 * header from the address type implied by the path, concatenates the
 * 32-byte r + s, and base64-encodes the result, matching xchain-sdk's
 * `auth.signMessage` output so verification can round-trip.
 *
 * @param {{ v: number, r: string, s: string }} sig
 * @param {string} path
 * @returns {string}  base64-encoded 65-byte compact signature
 */
export function composeBitcoinCompactSignature(sig, path) {
    if (!sig || typeof sig.v !== 'number' || typeof sig.r !== 'string' || typeof sig.s !== 'string') {
        throw new Error('composeBitcoinCompactSignature: sig must be { v, r, s }');
    }
    const addressType = addressTypeFromPath(path);
    const headerBase = HEADER_BASE_BY_ADDRESS_TYPE[addressType];
    if (typeof headerBase !== 'number') {
        throw new Error(`composeBitcoinCompactSignature: no header base for "${addressType}"`);
    }
    const recId = sig.v & 1;
    const header = headerBase + recId;
    const r = sig.r.padStart(64, '0');
    const s = sig.s.padStart(64, '0');
    const bytes = [header, ...hexToBytes(r), ...hexToBytes(s)];
    if (bytes.length !== 65) {
        throw new Error(`composeBitcoinCompactSignature: expected 65 bytes, got ${bytes.length}`);
    }
    // Node Buffer is available in extension + Electron renderers; web
    // pages get Buffer via vite-plugin-node-polyfills. btoa with
    // String.fromCharCode is the pure-JS fallback, but Buffer keeps
    // this aligned with the rest of xchain-wallet.
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(bytes).toString('base64');
    }
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return globalThis.btoa(bin);
}
