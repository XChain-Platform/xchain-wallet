// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// "not enough" and "too low" alone also appear in node fee rejections, which
// are the network refusing the transaction, not the user's balance running
// short. The funds classification needs a funds word beside the phrase.
import { describe, it, expect } from 'vitest';
import { humanizeError } from '../../../packages/core/src/shared/utils/humanizeError.js';

describe('humanizeError loose phrase matches', () => {
    it('does not read a relay fee rejection as insufficient funds', () => {
        expect(humanizeError({ message: 'min relay fee not met, too low' }).cause).not.toBe('insufficient_funds');
        expect(humanizeError({ message: 'fee rate too low' }).cause).not.toBe('insufficient_funds');
    });

    it('still reads real shortfalls as insufficient funds', () => {
        for (const message of [
            'you do not have enough funds',
            'not enough funds',
            'Insufficient funds',
            'balance is too low',
            'balance too low',
        ]) {
            expect(humanizeError({ message }).cause).toBe('insufficient_funds');
        }
    });
});
