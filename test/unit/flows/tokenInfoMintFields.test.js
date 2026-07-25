// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-01 mint-configuration editor: normalizeTokenInfo's `mints` passthrough
// (MAX_MINT, MINT_ADDRESS_MAX, MINT_START_BLOCK, MINT_STOP_BLOCK) and the
// ISSUE v3 lock-flag map (LOCK_MAX_MINT, LOCK_MINT, LOCK_MINT_SUPPLY,
// LOCK_MAX_SUPPLY) the Mint settings panel disables fields against.
// Mirrors xchain-explorer's db.js getToken() `mints: { max, address_max,
// start_block, stop_block }` shape.

import { describe, it, expect } from 'vitest';
import { normalizeTokenInfo } from '../../../packages/core/src/flows/tokenInfo.js';

describe('normalizeTokenInfo mint-configuration fields', () => {
    it('extracts mints.* as strings', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'MEMA', {
            info: { description: 'd', owner: 'addr' },
            mints: { max: 100, address_max: 500, start_block: 900000, stop_block: 910000 },
        });
        expect(info.mintMax).toBe('100');
        expect(info.mintAddressMax).toBe('500');
        expect(info.mintStartBlock).toBe('900000');
        expect(info.mintStopBlock).toBe('910000');
    });

    it('treats 0 the same as unset (explorer collapses NULL and 0 to the same wire value)', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'MEMA', {
            mints: { max: 0, address_max: 0, start_block: 0, stop_block: 0 },
        });
        expect(info.mintMax).toBeNull();
        expect(info.mintAddressMax).toBeNull();
        expect(info.mintStartBlock).toBeNull();
        expect(info.mintStopBlock).toBeNull();
    });

    it('defaults to null when the mints object is absent entirely', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'MEMA', { info: {} });
        expect(info.mintMax).toBeNull();
        expect(info.mintAddressMax).toBeNull();
        expect(info.mintStartBlock).toBeNull();
        expect(info.mintStopBlock).toBeNull();
    });

    it('passes through the ISSUE v3 lock flags the Mint settings panel disables fields against', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'MEMA', {
            locks: { max_mint: true, mint: false, mint_supply: true, max_supply: false },
        });
        expect(info.locks.max_mint).toBe(true);
        expect(info.locks.mint).toBe(false);
        expect(info.locks.mint_supply).toBe(true);
        expect(info.locks.max_supply).toBe(false);
    });

    it('handles the array-wrapped row shape (Array.isArray(raw) branch)', () => {
        const info = normalizeTokenInfo('bitcoin-mainnet', 'MEMA', [
            { mints: { max: 42, address_max: null, start_block: null, stop_block: null } },
        ]);
        expect(info.mintMax).toBe('42');
        expect(info.mintAddressMax).toBeNull();
    });
});
