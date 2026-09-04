// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: signers-ledger/ledgerFormat.js. Pure data transforms.

import { describe, it, expect } from 'vitest';
import {
    chainIdToLedgerCurrency,
    serializeOutputs,
    synthesizeMinimalPrevTx,
    toLedgerCreatePayment,
    addressTypeFromPath,
    composeBitcoinCompactSignature,
} from '../../../packages/signers-ledger/src/ledgerFormat.js';

describe('chainIdToLedgerCurrency', () => {
    it('maps bitcoin-mainnet to bitcoin', () => {
        expect(chainIdToLedgerCurrency('bitcoin-mainnet')).toBe('bitcoin');
    });

    // A Bitcoin Test app exists, but it derives at SLIP-44 coin-type 1' while
    // the descriptor anchor pins 0' on every Bitcoin network, so mapping it
    // would silently derive addresses the software signer/backend cannot see.
    // Hardware-unsupported instead (see chainIdToLedgerCurrency).
    it("throws for bitcoin-testnet (coin-type parity with the 0' descriptor anchor)", () => {
        expect(() => chainIdToLedgerCurrency('bitcoin-testnet')).toThrow(/software wallet/);
        expect(() => chainIdToLedgerCurrency('bitcoin-testnet')).toThrow(/funds would appear missing/);
    });

    it('maps litecoin-mainnet to litecoin', () => {
        expect(chainIdToLedgerCurrency('litecoin-mainnet')).toBe('litecoin');
    });

    it('maps dogecoin-mainnet to dogecoin', () => {
        expect(chainIdToLedgerCurrency('dogecoin-mainnet')).toBe('dogecoin');
    });

    it('throws for unsupported chainId', () => {
        expect(() => chainIdToLedgerCurrency('unknown-chain')).toThrow(/unsupported chainId/);
    });

    // No Ledger app exists for these, so they throw an actionable hint
    // pointing at the software signer.
    it('throws for litecoin-testnet (no Ledger app)', () => {
        expect(() => chainIdToLedgerCurrency('litecoin-testnet')).toThrow(/software wallet/);
    });

    it('throws for dogecoin-testnet (no Ledger app)', () => {
        expect(() => chainIdToLedgerCurrency('dogecoin-testnet')).toThrow(/software wallet/);
    });

    it('throws for bitcoin-regtest (no Ledger regtest app)', () => {
        expect(() => chainIdToLedgerCurrency('bitcoin-regtest')).toThrow(/software wallet/);
    });
});

describe('serializeOutputs', () => {
    it('serializes a single output correctly (0-value, known scriptPubKey)', () => {
        // P2WPKH scriptPubKey = 0014 + 20-byte witness program
        const scriptPubKeyHex = '0014' + 'a'.repeat(40);
        const hex = serializeOutputs([{ value: 1000, scriptPubKeyHex }]);
        // Should start with varint(1) = 01 for 1 output
        expect(hex.startsWith('01')).toBe(true);
        expect(typeof hex).toBe('string');
        expect(hex.length % 2).toBe(0);
    });

    it('encodes value as 8-byte LE', () => {
        const hex = serializeOutputs([{ value: 1, scriptPubKeyHex: '00' }]);
        // Output count (01) + 8 bytes value + varint script len + script
        // First 2 chars = '01' (count), next 16 chars = value in LE = 0100000000000000
        expect(hex.substring(2, 18)).toBe('0100000000000000');
    });

    it('handles multiple outputs', () => {
        const hex = serializeOutputs([
            { value: 100, scriptPubKeyHex: 'aa' },
            { value: 200, scriptPubKeyHex: 'bb' },
        ]);
        // Starts with varint(2) = 02
        expect(hex.startsWith('02')).toBe(true);
    });

    it('handles empty outputs array', () => {
        const hex = serializeOutputs([]);
        expect(hex).toBe('00');
    });
});

describe('synthesizeMinimalPrevTx', () => {
    it('throws on negative vout', () => {
        expect(() => synthesizeMinimalPrevTx(-1, 0, '00')).toThrow(/non-negative integer/);
    });

    it('throws on non-integer vout', () => {
        expect(() => synthesizeMinimalPrevTx(0.5, 0, '00')).toThrow(/non-negative integer/);
    });

    it('returns a hex string for vout=0', () => {
        const hex = synthesizeMinimalPrevTx(0, 1000, '0014' + 'b'.repeat(40));
        expect(typeof hex).toBe('string');
        expect(hex.length % 2).toBe(0);
        // nVersion = 01000000
        expect(hex.startsWith('01000000')).toBe(true);
    });

    it('returns a hex string for vout=1 (two outputs, target at index 1)', () => {
        const hex = synthesizeMinimalPrevTx(1, 5000, '0014' + 'cc'.repeat(20));
        expect(typeof hex).toBe('string');
        // Output count = 02 for (vout+1=2) outputs
        // structure: nVersion(4) + inputCount(1) + input(41) + outputCount(varint) + outputs + locktime(4)
        expect(hex).toBeTruthy();
    });
});

describe('addressTypeFromPath', () => {
    it('84 purpose → p2wpkh', () => {
        expect(addressTypeFromPath("m/84'/0'/0'/0/0")).toBe('p2wpkh');
    });

    it('49 purpose → p2sh-p2wpkh', () => {
        expect(addressTypeFromPath("m/49'/0'/0'/0/0")).toBe('p2sh-p2wpkh');
    });

    it('44 purpose → p2pkh', () => {
        expect(addressTypeFromPath("m/44'/0'/0'/0/0")).toBe('p2pkh');
    });

    it('throws for unknown purpose', () => {
        expect(() => addressTypeFromPath("m/86'/0'/0'/0/0")).toThrow(/cannot infer address type/);
    });
});

describe('composeBitcoinCompactSignature', () => {
    const r = 'a'.repeat(64);
    const s = 'b'.repeat(64);

    it('returns a base64 string for p2wpkh path + v=0', () => {
        const sig = composeBitcoinCompactSignature(
            { v: 0, r, s },
            "m/84'/0'/0'/0/0",
        );
        expect(typeof sig).toBe('string');
        // Base64 encodes 65 bytes → 88 chars (with padding)
        const decoded = Buffer.from(sig, 'base64');
        expect(decoded.length).toBe(65);
    });

    it('header byte for p2wpkh v=0 is 39 (base) + 0 (recId) = 39', () => {
        const sig = composeBitcoinCompactSignature({ v: 0, r, s }, "m/84'/0'/0'/0/0");
        const decoded = Buffer.from(sig, 'base64');
        expect(decoded[0]).toBe(39);
    });

    it('header byte for p2wpkh v=1 is 40', () => {
        const sig = composeBitcoinCompactSignature({ v: 1, r, s }, "m/84'/0'/0'/0/0");
        const decoded = Buffer.from(sig, 'base64');
        expect(decoded[0]).toBe(40);
    });

    it('header byte for p2pkh v=0 is 31', () => {
        const sig = composeBitcoinCompactSignature({ v: 0, r, s }, "m/44'/0'/0'/0/0");
        const decoded = Buffer.from(sig, 'base64');
        expect(decoded[0]).toBe(31);
    });

    it('header byte for p2sh-p2wpkh v=0 is 35', () => {
        const sig = composeBitcoinCompactSignature({ v: 0, r, s }, "m/49'/0'/0'/0/0");
        const decoded = Buffer.from(sig, 'base64');
        expect(decoded[0]).toBe(35);
    });

    it('throws when sig is missing fields', () => {
        expect(() => composeBitcoinCompactSignature(null, "m/84'/0'/0'/0/0")).toThrow();
        expect(() => composeBitcoinCompactSignature({ r, s }, "m/84'/0'/0'/0/0")).toThrow();
    });
});

describe('toLedgerCreatePayment', () => {
    const signingPaths = [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }];

    // A minimal but REAL previous transaction: one input, one 1000-sat
    // p2wpkh output. Ledger derives the outpoint it signs from these
    // bytes, so a decomposed input that lacks them cannot be signed
    //; the fixture carries them the way a hydrated input does.
    const PREV_TX_HEX = '01000000010000000000000000000000000000000000000000000000000000000000000000'
        + 'ffffffff00ffffffff01e803000000000000160014'
        + 'b'.repeat(40) + '00000000';

    function makeDecomposed(scriptType = 'p2wpkh', { hydrated = true } = {}) {
        return {
            inputs: [{
                scriptType,
                prevTxHash: 'a'.repeat(64),
                prevTxIndex: 0,
                value: 1000,
                sequence: 0xffffffff,
                witnessUtxoScriptHex: '0014' + 'b'.repeat(40),
                nonWitnessUtxoHex: hydrated ? PREV_TX_HEX : null,
                redeemScriptHex: null,
            }],
            outputs: [{
                value: 900,
                scriptPubKeyHex: '0014' + 'c'.repeat(40),
                address: 'bc1qrecipient',
            }],
            locktime: 0,
        };
    }

    it('throws when decomposed is null', () => {
        expect(() => toLedgerCreatePayment({ decomposed: null, chainId: 'bitcoin-mainnet', signingPaths }))
            .toThrow(/required/);
    });

    it('throws when signingPaths is empty', () => {
        expect(() => toLedgerCreatePayment({ decomposed: makeDecomposed(), chainId: 'bitcoin-mainnet', signingPaths: [] }))
            .toThrow(/non-empty/);
    });

    it('throws when a signingPath entry is missing path', () => {
        expect(() => toLedgerCreatePayment({
            decomposed: makeDecomposed(),
            chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0 }],
        })).toThrow(/inputIndex.*path/i);
    });

    it('throws when no signingPath for input index', () => {
        expect(() => toLedgerCreatePayment({
            decomposed: makeDecomposed(),
            chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 99, path: "m/84'/0'/0'/0/0" }],
        })).toThrow(/no signingPath for input index 0/);
    });

    // The device takes the outpoint from the prev tx it is handed, so a
    // synthesized stand-in makes it sign a spend of an outpoint that does
    // not exist. This refused to be silent only after a real device was
    // driven; before that it produced a fully-formed, unbroadcastable
    // transaction.
    it('refuses a witnessUtxo-only input rather than synthesizing a prev tx', () => {
        expect(() => toLedgerCreatePayment({
            decomposed: makeDecomposed('p2wpkh', { hydrated: false }),
            chainId: 'bitcoin-mainnet',
            signingPaths,
        })).toThrow(/different outpoint than this PSBT names/);
    });

    // createPaymentTransaction signs SINGLE-KEY inputs only. Reading `scriptType`
    // for the transaction-level flags without checking it is one this seam can
    // sign hands the device a p2wsh multisig input paired with an 84' path as a
    // single-key p2wpkh spend. The sibling seam refuses these
    // (trezorFormat.js INPUT_SCRIPT_TYPE).
    for (const unsignable of ['p2wsh', 'p2sh-p2wsh', 'p2sh', 'p2tr', 'unknown']) {
        it(`refuses an input this seam cannot sign: ${unsignable}`, () => {
            expect(() => toLedgerCreatePayment({
                decomposed: makeDecomposed(unsignable),
                chainId: 'bitcoin-mainnet',
                signingPaths,
            })).toThrow(new RegExp(`unsupported input scriptType "${unsignable}"`));
        });
    }

    // The refusal must be a TYPE check, not a side effect of prev-tx
    // availability. Most such inputs happen to die in prevTxHexForInput
    // because they carry only a witnessUtxo; one carrying nonWitnessUtxo
    // passed straight through, which is the case that actually reached a
    // device.
    it('refuses an unsignable input even when it carries a real prev tx', () => {
        const d = makeDecomposed('p2wsh');
        d.inputs[0].nonWitnessUtxoHex = PREV_TX_HEX;
        d.inputs[0].witnessUtxoScriptHex = undefined;
        expect(() => toLedgerCreatePayment({ decomposed: d, chainId: 'bitcoin-mainnet', signingPaths }))
            .toThrow(/unsupported input scriptType "p2wsh"/);
    });

    it('names the input index of the unsignable script type', () => {
        expect(() => toLedgerCreatePayment({
            decomposed: makeDecomposed('p2tr'),
            chainId: 'bitcoin-mainnet',
            signingPaths,
        })).toThrow(/at index 0/);
    });

    // The PSBT declares its own per-input sighash and the signingPaths guard
    // below never reads it, so a pasted PSBT asking for SIGHASH_SINGLE /
    // ANYONECANPAY was signed under the device default and reported as
    // success. auth.signPsbt.hw builds signingPaths as { inputIndex, path }
    // only, so on that lane this is the ONLY side that can fire.
    it('refuses a non-default sighashType carried by the PSBT input itself', () => {
        const d = makeDecomposed('p2wpkh');
        d.inputs[0].sighashType = 0x83;
        expect(() => toLedgerCreatePayment({ decomposed: d, chainId: 'bitcoin-mainnet', signingPaths }))
            .toThrow(/PSBT input 0 requests sighashType 131/);
    });

    it('refuses SIGHASH_SINGLE on the PSBT input even when the signing path is silent', () => {
        const d = makeDecomposed('p2wpkh');
        d.inputs[0].sighashType = 3;
        expect(() => toLedgerCreatePayment({ decomposed: d, chainId: 'bitcoin-mainnet', signingPaths }))
            .toThrow(/requests sighashType 3/);
    });

    // An explicit SIGHASH_ALL on the signing path must not license a
    // non-default flag on the corresponding PSBT input: either side being
    // non-default refuses.
    it('an explicit SIGHASH_ALL signing path cannot suppress the PSBT input flag', () => {
        const d = makeDecomposed('p2wpkh');
        d.inputs[0].sighashType = 0x81;
        expect(() => toLedgerCreatePayment({
            decomposed: d,
            chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0", sighashType: 1 }],
        })).toThrow(/PSBT input 0 requests sighashType 129/);
    });

    it('accepts a PSBT input carrying SIGHASH_ALL or no flag at all', () => {
        const explicit = makeDecomposed('p2wpkh');
        explicit.inputs[0].sighashType = 1;
        const nulled = makeDecomposed('p2wpkh');
        nulled.inputs[0].sighashType = null;
        const absent = makeDecomposed('p2wpkh');
        const base = toLedgerCreatePayment({ decomposed: absent, chainId: 'bitcoin-mainnet', signingPaths });
        expect(toLedgerCreatePayment({ decomposed: explicit, chainId: 'bitcoin-mainnet', signingPaths }))
            .toEqual(base);
        expect(toLedgerCreatePayment({ decomposed: nulled, chainId: 'bitcoin-mainnet', signingPaths }))
            .toEqual(base);
    });

    // The shared signing contract (Signer.js SigningPathEntry, bridge-spec
    // PsbtSigningPath) carries an optional per-input sighash override, which
    // trezorFormat.js refuses identically. Were this seam to read only
    // inputIndex and path, the same PSBT + signingPaths would sign under
    // SIGHASH_ALL with nothing surfaced: a signature over a different sighash
    // than the caller asked for. hw-app-btc takes only a transaction-level
    // sigHashType and this signer returns a serialized tx rather than a PSBT,
    // so the refusal is the honest answer, and forwarding the flag would be
    // new device behaviour no wallet flow exercises.
    it('refuses a non-default sighashType rather than silently signing SIGHASH_ALL', () => {
        expect(() => toLedgerCreatePayment({
            decomposed: makeDecomposed('p2wpkh'),
            chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0", sighashType: 0x83 }],
        })).toThrow(/cannot sign under sighashType 131/);
    });

    it('names the input whose override it refused', () => {
        expect(() => toLedgerCreatePayment({
            decomposed: makeDecomposed('p2wpkh'),
            chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0", sighashType: 3 }],
        })).toThrow(/input 0/);
    });

    // An explicit SIGHASH_ALL asks for exactly what the seam already does, so
    // it is honoured rather than refused; so is an absent field, which is
    // every caller reaching Ledger today.
    it('accepts an explicit SIGHASH_ALL and an absent sighashType alike', () => {
        const explicit = toLedgerCreatePayment({
            decomposed: makeDecomposed('p2wpkh'),
            chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0", sighashType: 1 }],
        });
        const absent = toLedgerCreatePayment({
            decomposed: makeDecomposed('p2wpkh'),
            chainId: 'bitcoin-mainnet',
            signingPaths,
        });
        expect(explicit).toEqual(absent);
        // And the payload still carries no sigHashType: the refusal replaces
        // the silent drop, it does not start threading the flag to the device.
        expect(explicit.sigHashType).toBeUndefined();
    });

    it('uses the real prev tx, not a synthesized one, when the input carries it', () => {
        const payload = toLedgerCreatePayment({
            decomposed: makeDecomposed('p2wpkh'),
            chainId: 'bitcoin-mainnet',
            signingPaths,
        });
        expect(payload.inputs[0].prevTxHex).toBe(PREV_TX_HEX);
    });

    it('builds a valid payload for p2wpkh input', () => {
        const payload = toLedgerCreatePayment({
            decomposed: makeDecomposed('p2wpkh'),
            chainId: 'bitcoin-mainnet',
            signingPaths,
        });
        expect(payload.segwit).toBe(true);
        expect(payload.additionals).toContain('bech32');
        expect(payload.currency).toBe('bitcoin');
        expect(payload.inputs).toHaveLength(1);
        expect(typeof payload.inputs[0].prevTxHex).toBe('string');
        expect(typeof payload.outputScriptHex).toBe('string');
    });

    it('segwit=false for p2pkh inputs', () => {
        const d = makeDecomposed('p2pkh');
        d.inputs[0].nonWitnessUtxoHex = '0100000001' + 'aa'.repeat(41) + '00000000';
        d.inputs[0].witnessUtxoScriptHex = undefined;
        const payload = toLedgerCreatePayment({ decomposed: d, chainId: 'bitcoin-mainnet', signingPaths });
        expect(payload.segwit).toBe(false);
    });

    it('uses nonWitnessUtxoHex when available (preferred over witness synthesis)', () => {
        const d = makeDecomposed('p2wpkh');
        const rawTxHex = '01000000' + 'aa'.repeat(20);
        d.inputs[0].nonWitnessUtxoHex = rawTxHex;
        const payload = toLedgerCreatePayment({ decomposed: d, chainId: 'bitcoin-mainnet', signingPaths });
        expect(payload.inputs[0].prevTxHex).toBe(rawTxHex);
    });

    it('throws when input has neither witnessUtxo nor nonWitnessUtxo', () => {
        const d = makeDecomposed('p2wpkh', { hydrated: false });
        d.inputs[0].witnessUtxoScriptHex = undefined;
        expect(() => toLedgerCreatePayment({ decomposed: d, chainId: 'bitcoin-mainnet', signingPaths }))
            .toThrow(/neither nonWitnessUtxoHex nor witnessUtxoScriptHex/);
    });

    it('accepts an explicit lockTime override', () => {
        const payload = toLedgerCreatePayment({
            decomposed: makeDecomposed(),
            chainId: 'bitcoin-mainnet',
            signingPaths,
            lockTime: 750000,
        });
        expect(payload.lockTime).toBe(750000);
    });
});
