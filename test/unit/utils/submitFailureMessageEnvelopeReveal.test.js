// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A refused envelope reveal or phase-2 spend follows a commit that is already on
// the network, so a spend-conflict reason there is not a stale balance: the form
// must not tell the sender their coins are taken and invite a second compose.

import { describe, expect, it } from 'vitest';

import { isSpentCoinsRefusal } from '../../../packages/core/src/shared/utils/submitFailureMessage.js';
import { BROADCAST_FAILED_PERMANENT_NAME } from '../../../packages/core/src/flows/broadcastPermanence.js';

function permanentRefusal(phase, reason = 'bad-txns-inputs-missingorspent') {
    return { name: BROADCAST_FAILED_PERMANENT_NAME, message: `broadcast failed (${phase}): ${reason}` };
}

describe('isSpentCoinsRefusal on a post-commit refusal', () => {
    it('reads a spend conflict on the first broadcast as taken coins', () => {
        expect(isSpentCoinsRefusal(permanentRefusal('phase1'))).toBe(true);
    });

    it('does not read a refused phase-2 spend as taken coins', () => {
        expect(isSpentCoinsRefusal(permanentRefusal('phase2'))).toBe(false);
    });

    it('does not read a refused envelope reveal as taken coins', () => {
        expect(isSpentCoinsRefusal(permanentRefusal('envelope_reveal'))).toBe(false);
        expect(isSpentCoinsRefusal(permanentRefusal('envelope_reveal', 'txn-mempool-conflict'))).toBe(false);
    });
});
