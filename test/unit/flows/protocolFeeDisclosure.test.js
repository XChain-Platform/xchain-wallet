// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// : the XCHAIN-lane protocol-fee line for the confirm screen.
//
// The fee the wallet charges in its DEFAULT payment mode was the one cost the
// confirm screen never showed: the native lane quotes its fee (and 
// prices it into the deltas), while the XCHAIN lane quoted nothing. 
// made `/preflight` echo the fee record the dry-run already staged, so the
// number is on `report.quote.xchainFee` for every confirm; these are the rules
// for turning it into a line, including the four cases where the honest answer
// is to say nothing at all.

import { describe, it, expect } from 'vitest';
import {
    xchainProtocolFeeLine,
    PROTOCOL_FEE_TICK,
} from '../../../packages/core/src/flows/protocolFeeDisclosure.js';

const reportWith = (xchainFee) => ({ verdict: 'pass', findings: [], quote: { xchainFee } });

describe('xchainProtocolFeeLine', () => {

    it('discloses the fee in the default (XCHAIN) mode', () => {
        const line = xchainProtocolFeeLine({ report: reportWith('0.50000000'), composed: { quote: null } });
        expect(line).toBeTruthy();
        expect(line.tick).toBe(PROTOCOL_FEE_TICK);
        expect(line.amount).toBe('0.5');
        expect(line.text).toMatch(/Protocol fee: 0\.5 XCHAIN/);
    });

    it('says which balance pays it and that it is only charged on acceptance', () => {
        // Both facts are unguessable from a bare number, and the second is the
        // one that distinguishes this lane from the native one (where the fee
        // is spent on broadcast whether or not the action is accepted).
        const { text } = xchainProtocolFeeLine({ report: reportWith('1.00000000') });
        expect(text).toMatch(/from your XCHAIN balance/);
        expect(text).toMatch(/only if the action is accepted/);
    });

    it('trims the 8dp wire format down to what a human reads', () => {
        expect(xchainProtocolFeeLine({ report: reportWith('1.00000000') }).amount).toBe('1');
        expect(xchainProtocolFeeLine({ report: reportWith('0.00012300') }).amount).toBe('0.000123');
        expect(xchainProtocolFeeLine({ report: reportWith('12.34567891') }).amount).toBe('12.34567891');
    });

    it('keeps full precision on a fee no float could carry exactly', () => {
        // Parsed and re-formatted through a Number this would come back
        // 0.10000000000000001; the amount must be the string the indexer sent.
        expect(xchainProtocolFeeLine({ report: reportWith('0.10000001') }).amount).toBe('0.10000001');
    });

    it('accepts a numeric fee as well as the decimal string', () => {
        expect(xchainProtocolFeeLine({ report: reportWith(2) }).amount).toBe('2');
    });

    it('stays silent when the fee is being paid in the native coin', () => {
        //  already shows that fee as a coin debit; a second line here
        // would read as a second, separate charge.
        expect(xchainProtocolFeeLine({
            report: reportWith('0.50000000'),
            composed: { quote: { requiredFeeSats: 2000 }, protocolFeeSats: 2000 },
        })).toBeNull();
    });

    it('stays silent on the deferred-fee (chunk) lane, where only the quote is set', () => {
        //  moves the fee output to the reveal tx, so `protocolFeeSats`
        // can be null while the action still pays natively.
        expect(xchainProtocolFeeLine({
            report: reportWith('0.50000000'),
            composed: { quote: { requiredFeeSats: 5000 }, protocolFeeSats: null },
        })).toBeNull();
    });

    it('stays silent when there is no report, or a report from a pre- explorer', () => {
        expect(xchainProtocolFeeLine({ report: null })).toBeNull();
        expect(xchainProtocolFeeLine({ report: { verdict: 'pass', findings: [], quote: null } })).toBeNull();
        // Legacy /feequote answers carry no xchainFee at all.
        expect(xchainProtocolFeeLine({ report: { quote: { requiredFeeSats: 0, supported: true } } })).toBeNull();
        expect(xchainProtocolFeeLine()).toBeNull();
    });

    it('stays silent when the dry-run staged no fee record (xchainFee null)', () => {
        // The action was rejected before the handler recorded a fee, so "no
        // fee" would be a claim about an action that is not going to run.
        expect(xchainProtocolFeeLine({ report: reportWith(null) })).toBeNull();
    });

    it('stays silent on a genuinely zero fee', () => {
        expect(xchainProtocolFeeLine({ report: reportWith('0.00000000') })).toBeNull();
        expect(xchainProtocolFeeLine({ report: reportWith('0') })).toBeNull();
    });

    it('refuses a fee it cannot read rather than rendering junk', () => {
        expect(xchainProtocolFeeLine({ report: reportWith('not-a-number') })).toBeNull();
        expect(xchainProtocolFeeLine({ report: reportWith('-1.00000000') })).toBeNull();
    });
});
