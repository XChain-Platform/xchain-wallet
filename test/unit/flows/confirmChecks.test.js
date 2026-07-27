// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Single-encode pipeline tamper checks ( §5.3.2-3).

import { describe, it, expect } from 'vitest';
import {
    buildExpectedOutputs, checkOutputSet, checkActionByteMatch, assertNoTamper, TamperDetectedError,
    checkCarrierScripts,
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

        it('P2SH: a SECOND unexpected P2SH output is tamper when the action fits one chunk', () => {
            // No actionByteLen supplied -> single-carrier default (a small,
            // single-chunk payload). The second P2SH output is unexpected.
            const psbt = 'p2sh2';
            const expected = buildExpectedOutputs({ customOutputs: [], encoding: 'P2SH' });
            expect(expected.carrierAllowance).toBe(1);
            const res = checkOutputSet({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [
                    { address: 'carrier', scriptType: 'p2sh', scriptPubKeyHex: 'a914', value: 100000 },
                    { address: 'sneaky', scriptType: 'p2sh', scriptPubKeyHex: 'a914', value: 50000 },
                ] }),
            });
            expect(res.ok).toBe(false);
        });

        // D-24 : a real contract DEPLOY spreads its base64 CODE across
        // several P2SH data-carrier outputs (one per ~476-byte chunk). The
        // allowance is derived from the action size so all legitimate chunk
        // carriers pass, while an EXTRA carrier beyond the count is still tamper.
        it('multi-chunk P2SH: allows the N carriers a large payload legitimately needs', () => {
            const psbt = 'p2shN';
            // actionByteLen 900 -> ceil((900+16)/476)+1 = 2+1 = 3 carriers.
            const expected = buildExpectedOutputs({ customOutputs: [], encoding: 'P2SH', actionByteLen: 900 });
            expect(expected.carrierAllowance).toBe(3);
            const carrier = (v) => ({ address: 'chunk', scriptType: 'p2sh', scriptPubKeyHex: 'a914', value: v });
            const res = checkOutputSet({
                psbtHex: psbt, expected, ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [carrier(700), carrier(700), carrier(700), CHANGE] }),
            });
            expect(res.ok).toBe(true);
            expect(res.unexpected).toEqual([]);
        });

        it('multi-chunk P2SH: a carrier BEYOND the size-derived count is still tamper', () => {
            const psbt = 'p2shExtra';
            const expected = buildExpectedOutputs({ customOutputs: [], encoding: 'P2SH', actionByteLen: 900 });
            expect(expected.carrierAllowance).toBe(3);
            const carrier = (v) => ({ address: 'chunk', scriptType: 'p2sh', scriptPubKeyHex: 'a914', value: v });
            const res = checkOutputSet({
                psbtHex: psbt, expected, ownAddresses: OWN,
                // 4 P2SH carriers when only 3 are legitimate -> the 4th is unexpected.
                decomposePsbt: decomposerFor({ [psbt]: [carrier(700), carrier(700), carrier(700), carrier(700)] }),
            });
            expect(res.ok).toBe(false);
            expect(res.unexpected).toHaveLength(1);
        });

        it('OP_RETURN carrier allowance is exactly one regardless of action size', () => {
            expect(buildExpectedOutputs({ customOutputs: [], encoding: 'OP_RETURN', actionByteLen: 5000 }).carrierAllowance).toBe(1);
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

    // Check 3: the P2SH/P2WSH chunk lanes (spec 5.3.2). The verification
    // itself lives in the SDK and is tested there against real scripts; what
    // matters here is the GATING - that a bad carrier result blocks signing,
    // and that a chunk lane with no verifier wired does not read as a pass.
    describe('carrier-script check (chunk lanes)', () => {

        const chunkExpected = () => buildExpectedOutputs({ customOutputs: [], encoding: 'P2WSH' });
        // A P2WSH-shaped carrier: the OP_RETURN fixture would be rejected by
        // the OUTPUT-SET check first, and the carrier assertions below would
        // then pass for the wrong reason.
        const CARRIER_P2WSH = { address: null, scriptType: 'p2wsh', scriptPubKeyHex: '0020' + 'ab'.repeat(32), value: 1000 };

        it('skips non-chunk encodings instead of demanding scripts', () => {
            const r = checkCarrierScripts({
                psbt: 'x', carrierScripts: [], encoding: 'OP_RETURN',
                actionString: 'SEND|0|JDOG|1|addr', verifyCarrierScripts: () => ({ ok: false }),
            });
            expect(r.ok).toBe(true);
            expect(r.skipped).toBe(true);
        });

        // A chunk lane whose verifier was never injected is a WIRING failure.
        // Returning ok there is how an inert check ends up looking shipped.
        it('FAILS CLOSED on a chunk lane with no verifier wired', () => {
            const r = checkCarrierScripts({
                psbt: 'x', carrierScripts: ['aa'], encoding: 'P2WSH',
                actionString: 'SEND|0|JDOG|1|addr', verifyCarrierScripts: undefined,
            });
            expect(r.ok).toBe(false);
            expect(r.reason).toBe('no-verifier');
        });

        it('throws TamperDetectedError when the carrier check fails', () => {
            const psbt = 'chunked';
            expect(() => assertNoTamper({
                psbtHex: psbt, expected: chunkExpected(), ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [CARRIER_P2WSH, CHANGE] }),
                actionString: 'SEND|0|JDOG|1|addr',
                decodeActionFromPsbt: () => ({ ok: true, actionString: 'SEND|0|JDOG|1|addr' }),
                psbt, carrierScripts: ['deadbeef'],
                verifyCarrierScripts: () => ({ ok: false, reason: 'PAYLOAD_MISMATCH', checked: 1 }),
            })).toThrow(TamperDetectedError);
        });

        it('passes when the carrier check holds', () => {
            const psbt = 'chunked-ok';
            const out = assertNoTamper({
                psbtHex: psbt, expected: chunkExpected(), ownAddresses: OWN,
                decomposePsbt: decomposerFor({ [psbt]: [CARRIER_P2WSH, CHANGE] }),
                actionString: 'SEND|0|JDOG|1|addr',
                decodeActionFromPsbt: () => ({ ok: true, actionString: 'SEND|0|JDOG|1|addr' }),
                psbt, carrierScripts: ['deadbeef'],
                verifyCarrierScripts: () => ({ ok: true, reason: null, checked: 2 }),
            });
            expect(out.carrier.ok).toBe(true);
        });
    });
});
