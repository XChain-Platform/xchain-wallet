// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// An action whose encoder answer names no carrier lane the wallet knows, or a
// carrier lane holding no carrier, carries no action at all. Each content check
// skips the lanes it does not own, so the lane check is what refuses such a
// transaction before it is signed as the approved action.

import { describe, it, expect, vi } from 'vitest';
import {
    assertNoTamper, buildExpectedOutputs, TamperDetectedError,
} from '../../../packages/core/src/flows/confirmChecks.js';
import { assertBuiltActionMatchesIntent } from '../../../packages/core/src/flows/verifyBuiltAction.js';

const OWN = ['ownChangeAddr'];
const PAYEE = { address: 'payee', scriptType: 'p2wpkh', scriptPubKeyHex: '0014dd', value: 5000 };
const CHANGE = { address: 'ownChangeAddr', scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 55000 };
const MULTISIG_CARRIER = { address: null, scriptPubKeyHex: '5121aa', scriptType: 'unknown', value: 800 };
const ACTION = 'SEND|0|JDOG|1|payee|memo';

function run({ encoding, outputs, actionString = ACTION }) {
    const expected = buildExpectedOutputs({ customOutputs: [{ address: 'payee', value: 5000 }], encoding });
    return () => assertNoTamper({
        psbtHex: 'built', expected, ownAddresses: OWN,
        decomposePsbt: () => ({ outputs }),
        actionString,
        decodeActionFromPsbt: () => ({ ok: false, reason: 'no-op-return' }),
        psbt: 'built', carrierScripts: [],
        verifyCarrierScripts: () => ({ ok: false, reason: 'SCRIPTS_MISSING' }),
    });
}

function reasonOf(fn) {
    try { fn(); } catch (err) {
        expect(err).toBeInstanceOf(TamperDetectedError);
        return err.details.reason;
    }
    return 'passed';
}

describe('assertNoTamper refuses an action lane it cannot verify', () => {
    it.each([undefined, null, '', 'BOGUS', 'p2sh', 'taproot', 'op_return', 'AUTO'])(
        'refuses encoding %j for an action carrying only expected outputs and change',
        (encoding) => {
            expect(reasonOf(run({ encoding, outputs: [PAYEE, CHANGE] }))).toBe('unknown-encoding');
        });

    it('refuses a MULTISIGN answer that holds no carrier output', () => {
        expect(reasonOf(run({ encoding: 'MULTISIGN', outputs: [PAYEE, CHANGE] }))).toBe('carrier-missing');
    });

    it('accepts a MULTISIGN answer with its bare-multisig carrier', () => {
        expect(reasonOf(run({ encoding: 'MULTISIGN', outputs: [PAYEE, MULTISIG_CARRIER, CHANGE] }))).toBe('passed');
    });

    it('leaves a bare native payment with no carrier passing', () => {
        expect(reasonOf(run({ encoding: null, outputs: [PAYEE, CHANGE], actionString: null }))).toBe('passed');
    });

    it('carries the raw reported encoding beside the normalised one', () => {
        expect(buildExpectedOutputs({ encoding: 'p2sh' })).toMatchObject({ encoding: 'P2SH', reportedEncoding: 'p2sh' });
        expect(buildExpectedOutputs({ encoding: undefined }).reportedEncoding).toBeNull();
    });
});

describe('assertBuiltActionMatchesIntent refuses an action lane it cannot verify', () => {
    const sdk = (outputs) => ({
        config: { network: 'regtest' },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs }) },
        decoder: { decodeActionStringFromPsbt: vi.fn(), verifyCarrierScripts: vi.fn() },
    });
    const args = (encoding, outputs) => ({
        sdk: sdk(outputs),
        encoded: { psbt: 'BUILT', encoding },
        actionString: ACTION,
        bareNativePayment: false,
        customOutputs: [{ address: 'payee', value: 5000 }],
        ownAddresses: ['ownChangeAddr'],
    });

    it('refuses an answer with no encoding', () => {
        expect(() => assertBuiltActionMatchesIntent(args(undefined, [PAYEE, CHANGE])))
            .toThrow(/does not match what you approved/);
    });

    it('refuses a MULTISIGN answer with no carrier', () => {
        expect(() => assertBuiltActionMatchesIntent(args('MULTISIGN', [PAYEE, CHANGE])))
            .toThrow(/does not match what you approved/);
    });

    it('refuses a TAPROOT label that arrives with no reveal or recovery record', () => {
        expect(() => assertBuiltActionMatchesIntent(args('TAPROOT', [PAYEE, CHANGE])))
            .toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'envelope-incomplete' }) }));
    });

    it.each(['FOO', 'AUTO', 'taproot', 'op_return'])('refuses an answer labelled %j, since lanes match by exact case', (encoding) => {
        expect(() => assertBuiltActionMatchesIntent(args(encoding, [PAYEE, CHANGE])))
            .toThrow(/does not match what you approved/);
    });

    it('refuses a reveal pair that arrives under a label other than TAPROOT', () => {
        const built = args('OP_RETURN', [PAYEE, CHANGE]);
        built.encoded = { ...built.encoded, revealPsbt: 'R', envelope: { commitAddress: 'a', commitValue: 1 } };
        expect(() => assertBuiltActionMatchesIntent(built))
            .toThrow(expect.objectContaining({ details: expect.objectContaining({ reason: 'envelope-label-mismatch' }) }));
    });
});
