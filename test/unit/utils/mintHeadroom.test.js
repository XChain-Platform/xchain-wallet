// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// : mint headroom is min(MAX_MINT, MAX_SUPPLY - supply). The case
// that made the defect visible is a token exactly at its cap, where the
// answer has to be a hard '0' and not "whatever you happen to hold".

import { describe, it, expect } from 'vitest';
import {
    mintHeadroom,
    exceedsHeadroom,
    subtractDecimal,
    compareDecimal,
    mintWindowState,
    mintWindowMessage,
} from '../../../packages/core/src/shared/utils/mintHeadroom.js';

describe('mintHeadroom', () => {
    it('is 0 for a token at its supply cap (S18PROBE, 5000 of 5000)', () => {
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: '5000' })).toBe('0');
    });

    it('is the remaining supply when only MAX_SUPPLY binds', () => {
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: '1200' })).toBe('3800');
    });

    it('is MAX_MINT when the per-transaction cap binds first', () => {
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: '1000', mintMax: '100' }))
            .toBe('100');
    });

    it('is the supply headroom when MAX_MINT is the looser of the two', () => {
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: '4990', mintMax: '100' }))
            .toBe('10');
    });

    it('is MAX_MINT alone for an uncapped token that sets a per-tx cap', () => {
        expect(mintHeadroom({ maxSupply: null, totalSupply: '9000', mintMax: '250' }))
            .toBe('250');
    });

    it('is null when nothing bounds the mint (uncapped, no MAX_MINT)', () => {
        expect(mintHeadroom({ maxSupply: null, totalSupply: '9000', mintMax: null }))
            .toBeNull();
    });

    it('is null when the token record has not loaded', () => {
        expect(mintHeadroom({})).toBeNull();
        expect(mintHeadroom()).toBeNull();
    });

    it('never goes negative when supply somehow exceeds the cap', () => {
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: '5001' })).toBe('0');
    });

    it('keeps divisible amounts exact (no float drift at 8 decimals)', () => {
        expect(mintHeadroom({ maxSupply: '21000000', totalSupply: '20999999.99999999' }))
            .toBe('0.00000001');
        expect(mintHeadroom({ maxSupply: '1000.5', totalSupply: '0.3' })).toBe('1000.2');
    });

    it('treats an unparseable supply figure as unknown rather than inventing one', () => {
        expect(mintHeadroom({ maxSupply: '5,000', totalSupply: '1000' })).toBeNull();
        expect(mintHeadroom({ maxSupply: '5000', totalSupply: 'unlimited' })).toBeNull();
    });
});

describe('exceedsHeadroom', () => {
    it('flags any positive mint against a headroom of 0', () => {
        expect(exceedsHeadroom('5000', '0')).toBe(true);
        expect(exceedsHeadroom('0.00000001', '0')).toBe(true);
    });

    it('allows a mint exactly at the headroom', () => {
        expect(exceedsHeadroom('3800', '3800')).toBe(false);
    });

    it('stays quiet when the headroom is unknown, leaving the form ungated', () => {
        expect(exceedsHeadroom('5000', null)).toBe(false);
    });
});

describe('decimal helpers', () => {
    it('subtracts exactly and floors at zero', () => {
        expect(subtractDecimal('1', '0.9')).toBe('0.1');
        expect(subtractDecimal('0.3', '0.1')).toBe('0.2');
        expect(subtractDecimal('1', '5')).toBe('0');
        expect(subtractDecimal('1', 'x')).toBeNull();
    });

    it('compares across differing scales', () => {
        expect(compareDecimal('1.10', '1.1')).toBe(0);
        expect(compareDecimal('1.10', '1.2')).toBe(-1);
        expect(compareDecimal('2', '1.999999')).toBe(1);
        expect(compareDecimal('2', null)).toBeNull();
    });
});

// D-164: the window is the bound `mintHeadroom` cannot express, because it is
// not a quantity. A token can have a full transaction's worth of supply left
// and still be un-mintable at this height, which is exactly the state the Mint
// form used to advertise as "10 available to mint" while the network refused
// that amount on the same screen.

describe('mintWindowState', () => {
    it('is open when neither bound is set, without needing a tip at all', () => {
        expect(mintWindowState({}).state).toBe('open');
        expect(mintWindowState({ tip: null }).state).toBe('open');
    });

    it('reads 0 as UNSET, the way the explorer renders these fields', () => {
        // Same collapse `mintMax` documents. A start block of 0 must not mean
        // "opens at genesis and is therefore always shut before it".
        expect(mintWindowState({ mintStartBlock: 0, mintStopBlock: 0, tip: 10 }).state)
            .toBe('open');
    });

    it('is before the window below MINT_START_BLOCK, and says how far', () => {
        const w = mintWindowState({ mintStartBlock: 4642, tip: 4635 });
        expect(w.state).toBe('before');
        expect(w.blocksAway).toBe(7);
    });

    it('opens exactly AT the start block, which is what the chain does', () => {
        // `mint.js` refuses on `BLOCK_INDEX < MINT_START_BLOCK`, so the start
        // block itself is inside the window. An off-by-one here would block a
        // mint the chain accepts.
        expect(mintWindowState({ mintStartBlock: 4642, tip: 4642 }).state).toBe('open');
    });

    it('is closed only ABOVE the stop block, matching the chain the same way', () => {
        expect(mintWindowState({ mintStopBlock: 5000, tip: 5000 }).state).toBe('open');
        expect(mintWindowState({ mintStopBlock: 5000, tip: 5001 }).state).toBe('closed');
    });

    it('is unknown when a bound exists and the tip does not', () => {
        // Deliberately not "shut": an unreadable tip must not block a mint the
        // chain would accept, the same direction `exceedsHeadroom` fails in.
        expect(mintWindowState({ mintStartBlock: 4642, tip: null }).state).toBe('unknown');
    });
});

describe('mintWindowMessage', () => {
    it('names the block and what the network will do until then', () => {
        const msg = mintWindowMessage(mintWindowState({ mintStartBlock: 4642, tip: 4635 }), 'edt1');
        expect(msg).toContain('EDT1');
        expect(msg).toContain('block 4642');
        expect(msg).toContain('7 blocks away');
        expect(msg).toMatch(/refuses mints until then/i);
        // The one sentence this replaces claimed the opposite remedy.
        expect(msg).not.toMatch(/waiting will not change this/i);
    });

    it('says a closed edition is over rather than telling anyone to wait', () => {
        const msg = mintWindowMessage(mintWindowState({ mintStopBlock: 5000, tip: 5100 }), 'EDT1');
        expect(msg).toContain('closed at block 5000');
        expect(msg).toMatch(/no more can be minted/i);
    });

    it('is silent for an open window and for an unknown one', () => {
        expect(mintWindowMessage(mintWindowState({ tip: 10 }), 'EDT1')).toBeNull();
        expect(mintWindowMessage(mintWindowState({ mintStartBlock: 99, tip: null }), 'EDT1'))
            .toBeNull();
    });
});
