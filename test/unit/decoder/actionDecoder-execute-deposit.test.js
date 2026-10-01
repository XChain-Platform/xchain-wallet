// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// EXECUTE carries no amount. A tester called a loan's fundLoan bare and
// could not tell from the confirm page that nothing would be sent, so a
// standalone call says so, and a batch that deposits into the same
// contract drops the line because there the call is funded.

import { describe, it, expect } from 'vitest';
import { decodeAction } from '../../../packages/core/src/decoder/actionDecoder.js';

const NO_DEPOSIT = /sends no tokens to the contract/;
const hasNoDepositLine = (out) => out.warnings.some((w) => NO_DEPOSIT.test(w));

const execute = (idx) => ({ action: 'EXECUTE', params: { CONTRACT_ACTION_INDEX: idx, METHOD: 'fundLoan', PARAMS: [] } });
const deposit = (idx) => ({ action: 'DEPOSIT', params: { CONTRACT_ACTION_INDEX: idx, TICK: 'XCHAIN', QUANTITY: '1000' } });
const batch = (...commands) => decodeAction({ action: 'BATCH', params: { COMMANDS: commands }, chainId: '' });

describe('EXECUTE confirm says when no tokens are attached', () => {
    it('warns on a bare call', () => {
        expect(hasNoDepositLine(decodeAction({ ...execute('3919'), chainId: '' }))).toBe(true);
    });

    it('drops the warning when the batch deposits into the same contract', () => {
        expect(hasNoDepositLine(batch(deposit('3919'), execute('3919')))).toBe(false);
    });

    it('keeps the warning when the batch deposits into a different contract', () => {
        expect(hasNoDepositLine(batch(deposit('12'), execute('3919')))).toBe(true);
    });
});
