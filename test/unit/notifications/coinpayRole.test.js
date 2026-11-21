// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { coinpayRole } from '../../../packages/core/src/notifications/NotificationService.js';

describe('coinpayRole', () => {
    it('returns payer first when both party fields match', () => {
        expect(coinpayRole({ payer_address: 'mine', payee_address: 'mine' }, 'mine')).toBe('payer');
    });

    it('returns payee when only the payee field matches', () => {
        expect(coinpayRole({ payer_address: 'other', payee_address: 'mine' }, 'mine')).toBe('payee');
    });

    it.each([
        [{ payer_address: 'other', payee_address: 'another' }, 'mine'],
        [{}, 'mine'],
        [undefined, 'mine'],
    ])('returns neutral when neither party field matches', (data, address) => {
        expect(coinpayRole(data, address)).toBe('neutral');
    });
});
