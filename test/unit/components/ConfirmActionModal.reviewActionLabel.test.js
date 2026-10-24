// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import { reviewActionLabel } from '../../../packages/core/src/shared/components/ConfirmActionModal.jsx';

const label = (summary) => reviewActionLabel({ summary, details: [] }, 'Approve', 'Bitcoin');

describe('reviewActionLabel on a category list', () => {
    it('does not cut a sweep list at three words with a trailing comma', () => {
        expect(label('Sweep balances, ownerships, open orders, open dispensers on Bitcoin to bcrt1q'))
            .toBe('Sweep');
    });

    it('does not leave a dangling word from a cut list', () => {
        expect(label('Sweep balances, open orders on Bitcoin to bcrt1q')).toBe('Sweep');
    });

    it('keeps a short complete list as written', () => {
        expect(label('Sweep balances, ownerships on Bitcoin to bcrt1q')).toBe('Sweep balances, ownerships');
        expect(label('Sweep open orders on Bitcoin to bcrt1q')).toBe('Sweep open orders');
    });
});
