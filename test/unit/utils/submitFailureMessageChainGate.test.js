// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A per-chain action-gate refusal reaches the user as a sentence, never as the
// composer name, raw action key or chain id the thrown text carries for logs.

import { describe, it, expect } from 'vitest';
import {
    chainGateErrorMessage,
    submitFailureMessage,
} from '../../../packages/core/src/shared/utils/submitFailureMessage.js';

const LEAKS = /buildBatchCommand|advancedAction|contractStakeAction|stakeAction|-mainnet|-testnet|-regtest|litecoin|dogecoin|:/;

const GATE_ERRORS = [
    'buildBatchCommand: STAKE version 1 is accepted on Bitcoin only, not on litecoin-mainnet',
    'advancedAction: STAKE version 1 is accepted on Bitcoin only, not on litecoin-regtest',
    'buildBatchCommand: XBRIDGE version 1 is not accepted on Bitcoin',
    'stakeAction: validator staking actions are accepted on Bitcoin only, not on dogecoin-testnet',
    'buildBatchCommand: STAKE version is unreadable in a nested sub-action',
];

describe('chainGateErrorMessage', () => {
    it('maps every gate refusal shape to plain copy with no composer name or chain id', () => {
        for (const text of GATE_ERRORS) {
            const msg = chainGateErrorMessage(new Error(text));
            expect(msg, text).toBeTruthy();
            expect(msg, text).not.toMatch(LEAKS);
        }
    });

    it('names the action by its display label', () => {
        expect(chainGateErrorMessage(new Error(GATE_ERRORS[0]))).toMatch(/^Stake version 1 works only on Bitcoin\./);
        expect(chainGateErrorMessage(new Error(GATE_ERRORS[2]))).toMatch(/^Bridge transfer version 1 cannot be sent/);
    });

    it('returns null for an unrelated error', () => {
        expect(chainGateErrorMessage(new Error('buildBatchCommand: this SDK build has no BATCH support'))).toBeNull();
        expect(chainGateErrorMessage(new Error('insufficient funds'))).toBeNull();
        expect(chainGateErrorMessage(null)).toBeNull();
    });
});

describe('submitFailureMessage with a chain-gate refusal', () => {
    it('replaces the raw text even when the caller passes the raw message as its fallback', () => {
        for (const text of GATE_ERRORS) {
            const err = new Error(text);
            const msg = submitFailureMessage(err, { chainId: 'litecoin-mainnet', fallback: err.message });
            expect(msg, text).toBe(chainGateErrorMessage(err));
            expect(msg, text).not.toMatch(LEAKS);
        }
    });
});
