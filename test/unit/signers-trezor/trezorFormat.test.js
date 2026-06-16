// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: signers-trezor/trezorFormat.js — pure data transforms.

import { describe, it, expect } from 'vitest';
import {
    pathToAddressN,
    toTrezorSignTransaction,
    chainIdToTrezorCoin,
} from '../../../packages/signers-trezor/src/trezorFormat.js';

describe('chainIdToTrezorCoin', () => {
    it('maps bitcoin-mainnet to btc', () => {
        expect(chainIdToTrezorCoin('bitcoin-mainnet')).toBe('btc');
    });

    it('maps bitcoin-testnet to test', () => {
        expect(chainIdToTrezorCoin('bitcoin-testnet')).toBe('test');
    });

    it('maps litecoin-mainnet to ltc', () => {
        expect(chainIdToTrezorCoin('litecoin-mainnet')).toBe('ltc');
    });

    it('maps dogecoin-mainnet to doge', () => {
        expect(chainIdToTrezorCoin('dogecoin-mainnet')).toBe('doge');
    });

    it('throws for unsupported chainId', () => {
        expect(() => chainIdToTrezorCoin('unknown-chain')).toThrow(/unsupported chainId/);
    });
});

describe('pathToAddressN', () => {
    it('converts a simple non-hardened path', () => {
        expect(pathToAddressN('m/0/1')).toEqual([0, 1]);
    });

    it('converts a BIP44 hardened path', () => {
        const result = pathToAddressN("m/44'/0'/0'/0/0");
        expect(result).toHaveLength(5);
        expect(result[0]).toBe((44 | 0x80000000) >>> 0);
        expect(result[1]).toBe((0 | 0x80000000) >>> 0);
        expect(result[2]).toBe((0 | 0x80000000) >>> 0);
        expect(result[3]).toBe(0);
        expect(result[4]).toBe(0);
    });

    it('converts a BIP84 path (native segwit)', () => {
        const result = pathToAddressN("m/84'/0'/0'/0/5");
        expect(result[0]).toBe((84 | 0x80000000) >>> 0);
        expect(result[4]).toBe(5);
    });

    it('throws on path not starting with m/', () => {
        expect(() => pathToAddressN('44/0/0')).toThrow(/invalid BIP32 path/);
        expect(() => pathToAddressN(null)).toThrow();
    });

    it('throws on invalid segment value', () => {
        expect(() => pathToAddressN("m/abc'")).toThrow(/invalid path segment/);
    });

    it('handles empty path (m/ only)', () => {
        expect(pathToAddressN('m/')).toEqual([]);
    });
});

describe('toTrezorSignTransaction', () => {
    function makeDecomposed(scriptType = 'p2wpkh') {
        return {
            inputs: [{
                scriptType,
                prevTxHash: 'a'.repeat(64),
                prevTxIndex: 0,
                value: 1000,
                sequence: 0xffffffff,
            }],
            outputs: [{
                value: 900,
                scriptPubKeyHex: '0014' + 'c'.repeat(40),
                address: 'bc1qrecipient',
            }],
        };
    }

    const signingPaths = [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }];

    it('throws when decomposed is null', () => {
        expect(() => toTrezorSignTransaction({ decomposed: null, coin: 'btc', signingPaths }))
            .toThrow(/required/);
    });

    it('throws when coin is empty', () => {
        expect(() => toTrezorSignTransaction({ decomposed: makeDecomposed(), coin: '', signingPaths }))
            .toThrow(/coin is required/);
    });

    it('throws when signingPaths is empty', () => {
        expect(() => toTrezorSignTransaction({ decomposed: makeDecomposed(), coin: 'btc', signingPaths: [] }))
            .toThrow(/non-empty/);
    });

    it('throws on signingPaths entry missing path', () => {
        expect(() => toTrezorSignTransaction({
            decomposed: makeDecomposed(),
            coin: 'btc',
            signingPaths: [{ inputIndex: 0 }],
        })).toThrow(/inputIndex.*path/i);
    });

    it('throws when no signingPath for input index', () => {
        expect(() => toTrezorSignTransaction({
            decomposed: makeDecomposed(),
            coin: 'btc',
            signingPaths: [{ inputIndex: 99, path: "m/84'/0'/0'/0/0" }],
        })).toThrow(/no signingPath for input index 0/);
    });

    it('throws for unsupported scriptType', () => {
        const d = makeDecomposed('p2tr');
        expect(() => toTrezorSignTransaction({ decomposed: d, coin: 'btc', signingPaths }))
            .toThrow(/unsupported input scriptType/);
    });

    it('throws when output has no address', () => {
        const d = makeDecomposed();
        d.outputs[0].address = undefined;
        expect(() => toTrezorSignTransaction({ decomposed: d, coin: 'btc', signingPaths }))
            .toThrow(/has no address/);
    });

    it('builds a valid p2wpkh payload', () => {
        const payload = toTrezorSignTransaction({ decomposed: makeDecomposed('p2wpkh'), coin: 'btc', signingPaths });
        expect(payload.coin).toBe('btc');
        expect(payload.inputs).toHaveLength(1);
        expect(payload.inputs[0].script_type).toBe('SPENDWITNESS');
        expect(payload.outputs[0].script_type).toBe('PAYTOADDRESS');
        expect(Array.isArray(payload.inputs[0].address_n)).toBe(true);
        expect(payload.inputs[0].address_n).toHaveLength(5);
    });

    it('builds a valid p2sh-p2wpkh payload', () => {
        const payload = toTrezorSignTransaction({ decomposed: makeDecomposed('p2sh-p2wpkh'), coin: 'btc', signingPaths });
        expect(payload.inputs[0].script_type).toBe('SPENDP2SHWITNESS');
    });

    it('builds a valid p2pkh payload', () => {
        const payload = toTrezorSignTransaction({ decomposed: makeDecomposed('p2pkh'), coin: 'btc', signingPaths });
        expect(payload.inputs[0].script_type).toBe('SPENDADDRESS');
    });

    it('sets sighash when sighashType provided', () => {
        const paths = [{ inputIndex: 0, path: "m/84'/0'/0'/0/0", sighashType: 1 }];
        const payload = toTrezorSignTransaction({ decomposed: makeDecomposed(), coin: 'btc', signingPaths: paths });
        expect(payload.inputs[0].sighash).toBe(1);
    });

    it('includes refTxs only for p2pkh inputs with prevTxInfo', () => {
        const d = makeDecomposed('p2pkh');
        d.inputs[0].prevTxInfo = { hash: 'a'.repeat(64), inputs: [], outputs: [], version: 1, locktime: 0 };
        const payload = toTrezorSignTransaction({ decomposed: d, coin: 'btc', signingPaths });
        expect(payload.refTxs).toHaveLength(1);
    });

    it('no refTxs for p2wpkh (segwit) inputs', () => {
        const payload = toTrezorSignTransaction({ decomposed: makeDecomposed('p2wpkh'), coin: 'btc', signingPaths });
        expect(payload.refTxs).toBeUndefined();
    });

    it('deduplicates refTxs by hash', () => {
        const d = makeDecomposed('p2pkh');
        const prevTxInfo = { hash: 'a'.repeat(64), inputs: [], outputs: [], version: 1, locktime: 0 };
        d.inputs = [
            { ...d.inputs[0], prevTxInfo },
            { ...d.inputs[0], prevTxIndex: 1, prevTxInfo },
        ];
        const paths = [
            { inputIndex: 0, path: "m/44'/0'/0'/0/0" },
            { inputIndex: 1, path: "m/44'/0'/0'/0/1" },
        ];
        const payload = toTrezorSignTransaction({ decomposed: d, coin: 'btc', signingPaths: paths });
        // Only one refTx entry despite two inputs pointing to same hash.
        expect(payload.refTxs).toHaveLength(1);
    });
});
