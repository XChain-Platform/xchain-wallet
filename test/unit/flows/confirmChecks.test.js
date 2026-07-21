// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Single-encode pipeline tamper checks ( §5.3.2-3).

import { describe, it, expect } from 'vitest';
import {
    buildExpectedOutputs, checkOutputSet, checkActionByteMatch, assertNoTamper, TamperDetectedError,
} from '../../../packages/core/src/flows/confirmChecks.js';

// A decomposePsbt stub keyed by hex -> outputs.
function decomposerFor(map) {
    return (hex) => ({ outputs: map[hex] || [] });
}

const OWN = ['ownChangeAddr'];
const FEE_OUT = { address: 'feeDest', value: 2000 };
const CARRIER_OPRETURN = { address: null, scriptPubKeyHex: '6a1cdeadbeef', scriptType: 'unknown', value: 0 };
const CHANGE = { address: 'ownChangeAddr', scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 55000 };

describe('confirmChecks', () => {

    describe('checkOutputSet (output-set tamper check)', () => {
        it('passes when every output is expected, carrier, or own-change', () => {
            const psbt = 'clean';
            const expected = buildExpectedOutputs({ customOutputs: [FEE_OUT], encoding: 'OP_RETURN' });
            const res = checkOutputSet({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [CARRIER_OPRETURN, { address: 'feeDest', scriptType: 'p2pkh', scriptPubKeyHex: '76a9', value: 2000 }, CHANGE] }),
            });
            expect(res.ok).toBe(true);
            expect(res.unexpected).toEqual([]);
        });

        it('flags an injected extra output as tamper', () => {
            const psbt = 'evil';
            const expected = buildExpectedOutputs({ customOutputs: [FEE_OUT], encoding: 'OP_RETURN' });
            const res = checkOutputSet({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [CARRIER_OPRETURN, { address: 'ATTACKER', scriptType: 'p2wpkh', scriptPubKeyHex: '0014bb', value: 999999 }, CHANGE] }),
            });
            expect(res.ok).toBe(false);
            expect(res.unexpected).toHaveLength(1);
            expect(res.unexpected[0].address).toBe('ATTACKER');
        });

        it('a custom output with the wrong VALUE is tamper (address alone is not enough)', () => {
            const psbt = 'valueTamper';
            const expected = buildExpectedOutputs({ customOutputs: [FEE_OUT], encoding: 'OP_RETURN' });
            const res = checkOutputSet({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [CARRIER_OPRETURN, { address: 'feeDest', scriptType: 'p2pkh', scriptPubKeyHex: '76a9', value: 9999 }] }),
            });
            expect(res.ok).toBe(false);
        });

        it('whitelists the ADS output (present in customOutputs) and flags it isAds', () => {
            const psbt = 'ads';
            const adsOutput = { address: 'donateHere', value: 1500 };
            const expected = buildExpectedOutputs({
                customOutputs: [FEE_OUT, adsOutput], encoding: 'OP_RETURN', adsOutput,
            });
            expect(expected.addressed.find((s) => s.address === 'donateHere').isAds).toBe(true);
            const res = checkOutputSet({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [
                    CARRIER_OPRETURN,
                    { address: 'feeDest', scriptType: 'p2pkh', scriptPubKeyHex: '76a9', value: 2000 },
                    { address: 'donateHere', scriptType: 'p2wpkh', scriptPubKeyHex: '0014cc', value: 1500 },
                ] }),
            });
            expect(res.ok).toBe(true);
        });

        it('P2SH carrier: one carrier of matching script type is accepted (residual encoder trust)', () => {
            const psbt = 'p2sh';
            const expected = buildExpectedOutputs({ customOutputs: [], encoding: 'P2SH' });
            const res = checkOutputSet({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [
                    { address: 'p2shScriptAddr', scriptType: 'p2sh', scriptPubKeyHex: 'a914', value: 100000 },
                    CHANGE,
                ] }),
            });
            expect(res.ok).toBe(true);
        });

        it('P2SH: a SECOND unexpected P2SH output is tamper (only one carrier allowed)', () => {
            const psbt = 'p2sh2';
            const expected = buildExpectedOutputs({ customOutputs: [], encoding: 'P2SH' });
            const res = checkOutputSet({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [
                    { address: 'carrier', scriptType: 'p2sh', scriptPubKeyHex: 'a914', value: 100000 },
                    { address: 'sneaky', scriptType: 'p2sh', scriptPubKeyHex: 'a914', value: 50000 },
                ] }),
            });
            expect(res.ok).toBe(false);
        });
    });

    describe('checkActionByteMatch (inline OP_RETURN cross-check)', () => {
        const decode = (str) => (hex) => (hex === 'match'
            ? { ok: true, actionString: str }
            : hex === 'mismatch'
                ? { ok: true, actionString: 'SEND|0|EVIL|1|attacker' }
                : { ok: false, reason: 'NO_MAGIC_WORD' });

        it('passes when the decoded action string equals the intended one', () => {
            const res = checkActionByteMatch({
                psbtHex: 'match', actionString: 'SEND|0|JDOG|1|addr', encoding: 'OP_RETURN',
                decodeActionFromPsbt: decode('SEND|0|JDOG|1|addr'),
            });
            expect(res.ok).toBe(true);
        });

        it('fails on a mismatched action string', () => {
            const res = checkActionByteMatch({
                psbtHex: 'mismatch', actionString: 'SEND|0|JDOG|1|addr', encoding: 'OP_RETURN',
                decodeActionFromPsbt: decode('SEND|0|JDOG|1|addr'),
            });
            expect(res.ok).toBe(false);
            expect(res.reason).toBe('action-string-mismatch');
        });

        it('fails closed when the PSBT cannot be decoded', () => {
            const res = checkActionByteMatch({
                psbtHex: 'undecodable', actionString: 'X', encoding: 'OP_RETURN',
                decodeActionFromPsbt: decode('X'),
            });
            expect(res.ok).toBe(false);
        });

        it('skips gracefully for non-OP_RETURN encodings (two-phase reveal)', () => {
            const res = checkActionByteMatch({
                psbtHex: 'p2sh', actionString: 'X', encoding: 'P2SH',
                decodeActionFromPsbt: () => { throw new Error('should not be called'); },
            });
            expect(res.ok).toBe(true);
            expect(res.skipped).toBe(true);
        });
    });

    describe('assertNoTamper (throwing path)', () => {
        it('throws TamperDetectedError on an injected output', () => {
            const psbt = 'evil';
            const expected = buildExpectedOutputs({ customOutputs: [], encoding: 'OP_RETURN' });
            expect(() => assertNoTamper({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [CARRIER_OPRETURN, { address: 'ATTACKER', scriptType: 'p2wpkh', scriptPubKeyHex: '0014', value: 1 }] }),
                actionString: 'SEND|0|JDOG|1|addr',
                decodeActionFromPsbt: () => ({ ok: true, actionString: 'SEND|0|JDOG|1|addr' }),
            })).toThrow(TamperDetectedError);
        });

        it('throws on an action-byte mismatch even when outputs are clean', () => {
            const psbt = 'clean';
            const expected = buildExpectedOutputs({ customOutputs: [], encoding: 'OP_RETURN' });
            expect(() => assertNoTamper({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [CARRIER_OPRETURN] }),
                actionString: 'SEND|0|JDOG|1|addr',
                decodeActionFromPsbt: () => ({ ok: true, actionString: 'SEND|0|EVIL|1|x' }),
            })).toThrow(TamperDetectedError);
        });

        it('passes cleanly when both checks hold', () => {
            const psbt = 'clean';
            const expected = buildExpectedOutputs({ customOutputs: [], encoding: 'OP_RETURN' });
            const out = assertNoTamper({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [CARRIER_OPRETURN, CHANGE] }),
                actionString: 'SEND|0|JDOG|1|addr',
                decodeActionFromPsbt: () => ({ ok: true, actionString: 'SEND|0|JDOG|1|addr' }),
            });
            expect(out.outputSet.ok).toBe(true);
            expect(out.actionBytes.ok).toBe(true);
        });
    });
});
