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

/**
 * Build the `signTransaction` argument payload for Trezor Connect.
 *
 * @param {Object} opts
 * @param {import('./types').DecomposedPsbt} opts.decomposed   from sdk.wallet.decomposePsbt
 * @param {string} opts.coin                                    Trezor coin short name ('btc' | 'test' | 'regtest' | 'ltc' | 'doge')
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

    /** @type {Map<number, { path: string, sighashType?: number }>} */
    const pathByIndex = new Map();
    for (const sp of signingPaths) {
        if (typeof sp.inputIndex !== 'number' || !sp.path) {
            throw new Error(
                'toTrezorSignTransaction: every signingPaths entry needs { inputIndex, path }',
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
        /** @type {any} */
        const out = {
            address_n: pathToAddressN(sp.path),
            prev_hash: inp.prevTxHash,
            prev_index: inp.prevTxIndex,
            amount: String(inp.value),
            script_type: scriptType,
            sequence: inp.sequence,
        };
        if (typeof sp.sighashType === 'number') {
            out.script_sig = undefined;
            out.sighash = sp.sighashType;
        }
        return out;
    });

    const outputs = decomposed.outputs.map((out, idx) => {
        if (!out.address) {
            throw new Error(
                `toTrezorSignTransaction: output ${idx} has no address (raw script outputs not yet supported)`,
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
/** @type {Record<string, string>} */
const CHAIN_ID_TO_TREZOR_COIN = {
    'bitcoin-mainnet': 'btc',
    'bitcoin-testnet': 'test',
    'bitcoin-regtest': 'regtest',
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
        throw new Error(
            `trezorFormat: unsupported chainId "${chainId}". Trezor firmware has `
            + 'no Litecoin/Dogecoin testnet coin; use a software wallet for this network.',
        );
    }
    return coin;
}
