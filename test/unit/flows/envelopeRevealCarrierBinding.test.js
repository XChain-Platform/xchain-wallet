// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The reveal check can run an injected carrier binding rule after its own
// checks pass. The rule is a stub here; a throw is a refusal.

import { describe, it, expect, vi } from 'vitest';
import { checkEnvelopeReveal } from '../../../packages/core/src/flows/envelopeRevealCheck.js';

const ACTION = 'FILE|0|big.bin|application/octet-stream|Taproot test||';
const SOURCE = 'bcrt1qsource';
const COMMIT_SCRIPT = `5120${'ee'.repeat(32)}`;
const EXPECTED_REVEAL = 'REVEAL_HEX_BUILT';
const ENVELOPE = Object.freeze({
    commitTxid: 'aa'.repeat(32),
    commitVout: 0,
    commitValue: 60000,
    commitAddress: 'bcrt1pcommit',
});

const COMMIT = Object.freeze({
    inputs: [{ prevTxHash: 'ff'.repeat(32), prevTxIndex: 1, value: 100000, scriptPubKeyHex: '0014', address: SOURCE }],
    outputs: [
        { address: ENVELOPE.commitAddress, scriptPubKeyHex: COMMIT_SCRIPT, scriptType: 'p2tr', value: ENVELOPE.commitValue },
        { address: SOURCE, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 39000 },
    ],
});

function revealOf(overrides = {}) {
    return {
        inputs: [{
            prevTxHash: ENVELOPE.commitTxid,
            prevTxIndex: ENVELOPE.commitVout,
            value: ENVELOPE.commitValue,
            scriptPubKeyHex: COMMIT_SCRIPT,
            address: ENVELOPE.commitAddress,
        }],
        outputs: [{ address: SOURCE, scriptPubKeyHex: '0014', scriptType: 'p2wpkh', value: 546 }],
        ...overrides,
    };
}

const base = (extra = {}) => ({
    commit: COMMIT,
    reveal: revealOf(),
    envelope: ENVELOPE,
    ownAddresses: [SOURCE],
    actionString: ACTION,
    decodeRevealAction: () => ({ ok: true, actionString: ACTION }),
    revealPsbt: EXPECTED_REVEAL,
    network: 'regtest',
    ...extra,
});

describe('checkEnvelopeReveal carrier binding rule', () => {
    it('hands the rule the reveal, the action and the network, and accepts when it returns', () => {
        const rule = vi.fn();
        expect(checkEnvelopeReveal(base({ assertEnvelopeCarrierBinding: rule }))).toEqual({ ok: true });
        expect(rule).toHaveBeenCalledTimes(1);
        expect(rule).toHaveBeenCalledWith({ revealPsbt: EXPECTED_REVEAL, actionString: ACTION, network: 'regtest' });
    });

    it('refuses a substituted reveal when the rule throws', () => {
        const rule = vi.fn(({ revealPsbt }) => {
            if (revealPsbt !== EXPECTED_REVEAL) throw new Error('carrier mismatch');
        });
        const verdict = checkEnvelopeReveal(base({ revealPsbt: 'SUBSTITUTED', assertEnvelopeCarrierBinding: rule }));
        expect(verdict).toEqual({ ok: false, reason: 'REVEAL_CARRIER_BINDING' });
    });

    it('keeps a structural refusal and never calls the rule', () => {
        const rule = vi.fn();
        const verdict = checkEnvelopeReveal(base({
            reveal: revealOf({ outputs: [{ address: 'bcrt1qattacker', scriptPubKeyHex: '0014', value: 546 }] }),
            assertEnvelopeCarrierBinding: rule,
        }));
        expect(verdict).toEqual({ ok: false, reason: 'REVEAL_PAYS_FOREIGN_ADDRESS' });
        expect(rule).not.toHaveBeenCalled();
    });

    it('keeps the action mismatch refusal and never calls the rule', () => {
        const rule = vi.fn();
        const verdict = checkEnvelopeReveal(base({
            decodeRevealAction: () => ({ ok: true, actionString: 'SEND|0|XCHAIN|1' }),
            assertEnvelopeCarrierBinding: rule,
        }));
        expect(verdict.reason).toBe('REVEAL_ACTION_MISMATCH');
        expect(rule).not.toHaveBeenCalled();
    });

    it('accepts with no rule passed', () => {
        expect(checkEnvelopeReveal(base())).toEqual({ ok: true });
    });
});
