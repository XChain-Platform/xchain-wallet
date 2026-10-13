// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The History card shows whatever this returns when Speed up, Cancel or Undo
// fails, so the flow's developer wording must never come back out of it.

import { describe, it, expect } from 'vitest';
import {
    replaceFromHistoryEntry,
    undoCancel,
    RbfInvalidEntryError,
} from '../../../packages/core/src/flows/rbfReplace.js';
import {
    rbfFailureMessage,
    RBF_UNAVAILABLE_MESSAGE,
} from '../../../packages/core/src/shared/utils/rbfFailureMessage.js';

const FALLBACK = "Couldn't speed up or cancel this transaction. Try again later.";
const pendingSend = { action: 'SEND', txHash: 'ab'.repeat(32), blockIndex: 0, chainId: 'bitcoin-regtest' };
const rbfDescriptor = { displayName: 'Bitcoin', feeStrategy: { rbfSupported: true } };

async function thrownBy(promise) {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    throw new Error('expected the flow to throw');
}

describe('rbfFailureMessage', () => {
    it('says plainly that replacement is unavailable when no engine is wired', async () => {
        const err = await thrownBy(replaceFromHistoryEntry({
            messaging: {}, entry: pendingSend, strategy: 'speedup', descriptor: rbfDescriptor,
        }));
        const msg = rbfFailureMessage(err, FALLBACK);
        expect(msg).toBe(RBF_UNAVAILABLE_MESSAGE);
        expect(msg).not.toMatch(/§|SDK|encoder|engine/);
    });

    it('says the same for an undo on a host with no engine', async () => {
        const snapshot = { chainId: 'bitcoin-regtest', cancelTxHash: 'cd'.repeat(32), originalTxHash: 'ab'.repeat(32) };
        const err = await thrownBy(undoCancel({ messaging: {}, snapshot, cancelBlockIndex: 0 }));
        expect(rbfFailureMessage(err, 'Could not undo the cancellation.')).toBe(RBF_UNAVAILABLE_MESSAGE);
    });

    it('swaps a precondition string for the fallback', () => {
        expect(rbfFailureMessage(new RbfInvalidEntryError('replaceTx: chainId is required'), FALLBACK)).toBe(FALLBACK);
    });

    it('keeps a plain refusal reason the flow wrote for the user', () => {
        expect(rbfFailureMessage(new RbfInvalidEntryError('Already confirmed.'), FALLBACK)).toBe('Already confirmed.');
    });

    it('swaps runtime internals and empty errors for the fallback', () => {
        expect(rbfFailureMessage(new Error('Cannot read properties of undefined'), FALLBACK)).toBe(FALLBACK);
        expect(rbfFailureMessage(null, FALLBACK)).toBe(FALLBACK);
    });
});
