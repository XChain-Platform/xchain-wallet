// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Trezor Connect envelope builder: pure data transform from the
// SDK's normalized PSBT decomposition (§17.3 / §18.1) into the
// `signTransaction` arguments `@trezor/connect(-web)` expects. Keeps
// all Trezor-specific knowledge (coin-name mapping, SPEND/PAYTO
// script-type enum, address_n integer-array path format, refTxs
// shape) in one file so the signer class itself stays narrow.
//
// The wallet's Signer interface carries signingPaths alongside the
// PSBT; each entry is `{ inputIndex, path, sighashType? }`. This
// converter pairs paths with decomposed inputs by index.

/**
 * Convert a BIP32 path string into Trezor's `address_n` integer
 * array form. Hardened components (`"0'"`) get the top bit set.
 *
 * @param {string} path
 * @returns {number[]}
 */
export function pathToAddressN(path) {
    if (typeof path !== 'string' || !path.startsWith('m/')) {
        throw new Error(`trezorFormat: invalid BIP32 path "${path}"`);
    }
    const out = [];
    for (const seg of path.slice(2).split('/')) {
        if (seg.length === 0) continue;
        const hardened = seg.endsWith("'");
        const raw = hardened ? seg.slice(0, -1) : seg;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 0x7fffffff) {
            throw new Error(`trezorFormat: invalid path segment "${seg}"`);
        }
        out.push(hardened ? (n | 0x80000000) >>> 0 : n);
    }
    return out;
}

/** @type {Record<string, string>} */
const INPUT_SCRIPT_TYPE = {
    p2wpkh: 'SPENDWITNESS',
    'p2sh-p2wpkh': 'SPENDP2SHWITNESS',
    p2pkh: 'SPENDADDRESS',
};

// The only sighash this seam signs under; see the refusal in
// toTrezorSignTransaction for why an override is refused, never forwarded.
const SIGHASH_ALL = 1;

/**
 * The data payload of a nulldata (OP_RETURN) scriptPubKey, or `null` when the
 * script is not one. Returned WITHOUT the 6a opcode or the push prefix, which
 * is the shape Trezor Connect's `op_return_data` takes.
 *
 * Strict on purpose: the payload is consensus-visible data the device shows
 * and signs, so a push whose declared length does not match the bytes that
 * follow, or a push opcode this parser does not know, throws rather than
 * emitting a truncated or padded payload.
 *
 * @param {string} scriptPubKeyHex
 * @returns {string | null}
 */
export function opReturnPayloadHex(scriptPubKeyHex) {
    if (typeof scriptPubKeyHex !== 'string') return null;
    const hex = scriptPubKeyHex.toLowerCase();
    if (!hex.startsWith('6a')) return null;
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
        throw new Error('trezorFormat: OP_RETURN scriptPubKey is not valid hex');
    }
    // A bare OP_RETURN carries no payload.
    if (hex.length === 2) return '';
    const opcode = parseInt(hex.slice(2, 4), 16);
    let dataStart;
    let dataLen;
    if (opcode >= 0x01 && opcode <= 0x4b) {
        dataStart = 4;
        dataLen = opcode;
    } else if (opcode === 0x4c) {
        // OP_PUSHDATA1: one length byte.
        dataStart = 6;
        dataLen = parseInt(hex.slice(4, 6), 16);
    } else if (opcode === 0x4d) {
        // OP_PUSHDATA2: two length bytes, little-endian.
        dataStart = 8;
        dataLen = parseInt(hex.slice(4, 6), 16) | (parseInt(hex.slice(6, 8), 16) << 8);
    } else {
        throw new Error(
            `trezorFormat: unsupported OP_RETURN push opcode 0x${hex.slice(2, 4)}; `
            + 'only a single direct push, OP_PUSHDATA1 or OP_PUSHDATA2 is carried',
        );
    }
    if (Number.isNaN(dataLen) || hex.length - dataStart !== dataLen * 2) {
        throw new Error(
            'trezorFormat: OP_RETURN push length does not match the script bytes; '
            + 'refusing to emit a truncated or padded payload',
        );
    }
    return hex.slice(dataStart);
}

/**
 * Build the `signTransaction` argument payload for Trezor Connect.
 *
 * @param {Object} opts
 * @param {import('../../core/src/signers/types.js').DecomposedPsbt} opts.decomposed   from sdk.wallet.decomposePsbt
 * @param {string} opts.coin                                    Trezor coin short name ('btc' | 'ltc' | 'doge'). Testnet/regtest are deliberately absent (see CHAIN_ID_TO_TREZOR_COIN).
 * @param {Array<{inputIndex: number, path: string, sighashType?: number}>} opts.signingPaths
 * @returns {{ coin: string, inputs: object[], outputs: object[], refTxs: object[] }}
 */
export function toTrezorSignTransaction({ decomposed, coin, signingPaths }) {
    if (!decomposed || !Array.isArray(decomposed.inputs)) {
        throw new Error('toTrezorSignTransaction: decomposed PSBT is required');
    }
    if (typeof coin !== 'string' || coin.length === 0) {
        throw new Error('toTrezorSignTransaction: coin is required');
    }
    if (!Array.isArray(signingPaths) || signingPaths.length === 0) {
        throw new Error('toTrezorSignTransaction: signingPaths must be a non-empty array');
    }

    // REFUSE a nonzero locktime; never drop one silently. The payload built
    // below is `{ coin, inputs, outputs }` and carries no locktime, so a PSBT
    // asking for a timelock comes back from the device spendable immediately
    // while the signer reports success under the requested timelock. Forwarding
    // it instead is not verifiable from this repo: @trezor/connect is T-RSL and
    // is not installed here, so neither the signTransaction envelope's locktime
    // key nor the firmware's input-sequence requirement when one is set can be
    // checked. Refusing mirrors the sighash and scriptType posture this same
    // function already takes: carry a field faithfully or refuse it. No wallet
    // send flow sets a nonzero locktime, so only a pasted or cosigner PSBT can
    // reach this.
    if (typeof decomposed.locktime === 'number' && decomposed.locktime !== 0) {
        throw new Error(
            `toTrezorSignTransaction: PSBT requests locktime ${decomposed.locktime}; `
            + 'this signer supports only locktime 0. '
            + 'Re-request the signature without a timelock.',
        );
    }

    /** @type {Map<number, { path: string, sighashType?: number }>} */
    const pathByIndex = new Map();
    for (const sp of signingPaths) {
        if (typeof sp.inputIndex !== 'number' || !sp.path) {
            throw new Error(
                'toTrezorSignTransaction: every signingPaths entry needs { inputIndex, path }',
            );
        }
        // REFUSE a sighash override; never forward one. Trezor Connect's
        // signTransaction input type has no per-input sighash key, so a value
        // copied onto the envelope is not consumed: the device signs under its
        // default SIGHASH_ALL while the signer reports success under the
        // requested sighash, and TrezorSigner.signPsbt accepts any returned
        // serializedTx without checking the flag. A wrong-sighash signature is
        // worse than a refused one; this mirrors toLedgerCreatePayment so both
        // vendor seams take the same posture. No wallet flow sets the field on
        // a hardware path today, so this side refuses nothing being asked for -
        // which is also why it is only half the contract: the flag a PASTED
        // PSBT declares per input is refused in the input loop below.
        if (sp.sighashType !== undefined && sp.sighashType !== null
            && sp.sighashType !== SIGHASH_ALL) {
            throw new Error(
                `toTrezorSignTransaction: Trezor cannot sign under sighashType ${sp.sighashType} `
                + `(input ${sp.inputIndex}); this signer supports only the default SIGHASH_ALL `
                + `(${SIGHASH_ALL}). Re-request the signature without a sighash override.`,
            );
        }
        pathByIndex.set(sp.inputIndex, sp);
    }

    const inputs = decomposed.inputs.map((inp, idx) => {
        const sp = pathByIndex.get(idx);
        if (!sp) {
            throw new Error(
                `toTrezorSignTransaction: no signingPath for input index ${idx}`,
            );
        }
        const scriptType = INPUT_SCRIPT_TYPE[inp.scriptType];
        if (!scriptType) {
            throw new Error(
                `toTrezorSignTransaction: unsupported input scriptType "${inp.scriptType}" at index ${idx}`,
            );
        }
        // The PSBT carries its OWN per-input sighash (sdk.wallet.decomposePsbt
        // emits it; types.js DecomposedPsbtInput.sighashType), and the
        // signingPaths refusal above never reads it. Connect's input type has no
        // per-input sighash key either way, so a PSBT asking for SIGHASH_SINGLE /
        // ANYONECANPAY would be signed under the device default and reported as
        // success. auth.signPsbt.hw builds signingPaths as { inputIndex, path }
        // only, so on a pasted PSBT this is the only side that can fire.
        if (inp.sighashType !== undefined && inp.sighashType !== null
            && inp.sighashType !== SIGHASH_ALL) {
            throw new Error(
                `toTrezorSignTransaction: PSBT input ${idx} requests sighashType ${inp.sighashType}; `
                + `this signer supports only the default SIGHASH_ALL (${SIGHASH_ALL}). `
                + 'Re-request the signature without a sighash override.',
            );
        }
        return {
            address_n: pathToAddressN(sp.path),
            prev_hash: inp.prevTxHash,
            prev_index: inp.prevTxIndex,
            amount: String(inp.value),
            script_type: scriptType,
            sequence: inp.sequence,
        };
    });

    const outputs = decomposed.outputs.map((out, idx) => {
        // OP_RETURN first: the default small-action lane and every native-coin
        // send carry the action as an address-less nulldata output, which
        // Connect takes as PAYTOOPRETURN + op_return_data (hex payload, no
        // opcode). Ledger serializes the raw script and never needed this.
        const payloadHex = opReturnPayloadHex(out.scriptPubKeyHex);
        if (payloadHex !== null) {
            // Connect requires amount 0 on this script type; a funded nulldata
            // output is a burn, so it is refused rather than coerced.
            if (Number(out.value) !== 0) {
                throw new Error(
                    `toTrezorSignTransaction: OP_RETURN output ${idx} carries value ${out.value}; `
                    + 'a funded data output would burn coin, refusing to sign it',
                );
            }
            return { amount: '0', op_return_data: payloadHex, script_type: 'PAYTOOPRETURN' };
        }
        if (!out.address) {
            throw new Error(
                `toTrezorSignTransaction: output ${idx} has no address (raw script outputs other than OP_RETURN not yet supported)`,
            );
        }
        return {
            address: out.address,
            amount: String(out.value),
            script_type: 'PAYTOADDRESS',
        };
    });

    const refTxs = [];
    const seenRefs = new Set();
    for (const inp of decomposed.inputs) {
        if (inp.scriptType === 'p2pkh' && inp.prevTxInfo) {
            if (seenRefs.has(inp.prevTxInfo.hash)) continue;
            seenRefs.add(inp.prevTxInfo.hash);
            refTxs.push(inp.prevTxInfo);
        }
    }

    const payload = { coin, inputs, outputs };
    if (refTxs.length > 0) payload.refTxs = refTxs;
    return payload;
}

// Trezor firmware coin set. Bitcoin ships mainnet / testnet / regtest
// coin definitions, but Litecoin and Dogecoin are MAINNET-ONLY on Trezor:
// their testnets are not in the firmware, so the device cannot derive or
// validate LTC/DOGE testnet addresses at all. Those chainIds intentionally
// fall through to the throw in chainIdToTrezorCoin, and the wallet uses a
// software signer for them. Do not "fix" this by pointing them at 'test':
// that yields Bitcoin-testnet-format addresses, not valid LTC/DOGE ones.
//
// bitcoin-testnet and bitcoin-regtest are both excluded even though the
// firmware HAS 'test' and 'regtest' coins: both force SLIP-44 coin-type 1',
// while the wallet's descriptor anchor deliberately pins 0' on every Bitcoin
// network (software-signer/backend parity). A 1' hardware derivation silently
// yields addresses the rest of the wallet cannot see (funds appear missing),
// so both networks are hardware-unsupported instead. Do not "fix" this by
// restoring 'test'/'regtest' unless the firmware can be driven at 0'.
//
// Exported so TrezorSigner.coinTypeFor can resolve a coin short name back to
// its chain family, and so the cross-signer parity suite can derive its
// coverage set from the chains this seam actually supports instead of a
// hand-listed copy that a new family would silently miss.
/** @type {Record<string, string>} */
export const CHAIN_ID_TO_TREZOR_COIN = {
    'bitcoin-mainnet': 'btc',
    'litecoin-mainnet': 'ltc',
    'dogecoin-mainnet': 'doge',
};

/**
 * Map an XChain chainId to Trezor's coin short name. Shared between
 * the signer class (for `signMessage`) and format converter (for
 * `signTransaction`). Unsupported chains throw because there is no safe
 * default for a signer.
 *
 * @param {string} chainId
 * @returns {string}
 */
export function chainIdToTrezorCoin(chainId) {
    const coin = CHAIN_ID_TO_TREZOR_COIN[chainId];
    if (!coin) {
        if (chainId === 'bitcoin-testnet' || chainId === 'bitcoin-regtest') {
            throw new Error(
                `This hardware device can't be used on ${chainId} - use a software `
                + 'wallet for this network. (On this network the device would derive a '
                + 'different set of addresses than the rest of the wallet, so any funds '
                + 'would appear missing.)',
            );
        }
        throw new Error(
            `trezorFormat: unsupported chainId "${chainId}". Trezor firmware has `
            + 'no Litecoin/Dogecoin testnet coin; use a software wallet for this network.',
        );
    }
    return coin;
}
