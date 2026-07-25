// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-03 callback config: normalizeTokenInfo's `callback` passthrough
// (CALLBACK_TICK / CALLBACK_AMOUNT / CALLBACK_BLOCK) and the
// locks.callback flag the editor + execution surfaces read. Mirrors
// xchain-explorer db.js getToken() `callback: { tick, price, block,
// amount }` shape.

import { describe, it, expect } from 'vitest';
import { normalizeTokenInfo } from '../../../packages/core/src/flows/tokenInfo.js';

describe('normalizeTokenInfo callback-configuration fields', () => {
    it('extracts callback.* as strings', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'JDOG', {
            info: { description: 'd', owner: 'addr' },
            callback: { tick: 'XCHAIN', price: null, block: 950000, amount: '0.5' },
        });
        expect(info.callbackTick).toBe('XCHAIN');
        expect(info.callbackAmount).toBe('0.5');
        expect(info.callbackBlock).toBe('950000');
    });

    it('distinguishes a real 0 amount/block from unset (unlike the mint fields)', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'JDOG', {
            callback: { tick: 'XCHAIN', block: 0, amount: '0' },
        });
        // A configured 0 stays 0 (callback fields are not run through Number()
        // in the explorer, so 0 and NULL are distinguishable on the wire).
        expect(info.callbackBlock).toBe('0');
        expect(info.callbackAmount).toBe('0');
    });

    it('defaults to null when the callback object is absent', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'JDOG', { info: {} });
        expect(info.callbackTick).toBeNull();
        expect(info.callbackAmount).toBeNull();
        expect(info.callbackBlock).toBeNull();
    });

    it('empty-string callback fields normalize to null', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'JDOG', {
            callback: { tick: '', block: '', amount: '' },
        });
        expect(info.callbackTick).toBeNull();
        expect(info.callbackAmount).toBeNull();
        expect(info.callbackBlock).toBeNull();
    });

    it('passes through locks.callback for the editability gate', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'JDOG', {
            locks: { callback: true },
        });
        expect(info.locks.callback).toBe(true);
    });
});
