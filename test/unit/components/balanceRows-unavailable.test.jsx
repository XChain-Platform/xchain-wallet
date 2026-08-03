// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §7 Q-1's residual: "when the native source is momentarily unavailable, show
// a 'balance unavailable' state distinct from a true zero rather than $0".
//
// `flows/balances.js` has reported which side of a per-address read failed
// since D-6 (`unavailable: ['native'|'tokens']` plus a reason), and until now
// only TokenPicker read it. On Home the flag was dropped, which produced two
// different lies depending on how many addresses answered:
//
//   - no address answered  -> no native row was built at all, so the coin
//                             simply vanished from the balance list.
//   - some answered        -> the row showed the sum of the ones that did,
//                             presented as the whole balance.
//
// Both are worse than saying nothing, because both are indistinguishable from
// the truth. The second is the more dangerous of the two: a user deciding what
// they can afford to send reads an understated number as fact.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    buildBalanceRows,
    BalanceList,
} from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { registry as registryLib } from '../../../packages/core/src/index.js';

const chainRegistry = registryLib.defaultRegistry();
const CHAIN = 'bitcoin-mainnet';

function entry(address, balances) {
    return { address, balances };
}

/** A healthy native read of `sats` on one address. */
function healthy(address, sats) {
    return entry(address, {
        native: { tick: 'BTC', quantity: String(sats), divisibility: 8 },
        tokens: [],
    });
}

/** An address whose `/address/` call failed, the shape balances.js emits. */
function nativeDown(address) {
    return entry(address, {
        native: null,
        tokens: [],
        unavailable: ['native'],
        unavailableReason: 'explorer /address/ returned HTTP 502',
    });
}

describe('buildBalanceRows: unavailable vs a true zero (Q-1)', () => {
    it('a true zero is still a zero, and carries no unavailable mark', () => {
        // The control. Everything below has to stay distinguishable from this.
        const rows = buildBalanceRows({ [CHAIN]: [healthy('bc1qa', 0)] }, chainRegistry);
        expect(rows).toHaveLength(1);
        expect(rows[0].quantity).toBe('0');
        expect(rows[0].unavailable).toBeUndefined();
    });

    it('when NO address answers, the coin still appears - marked unavailable', () => {
        const rows = buildBalanceRows({ [CHAIN]: [nativeDown('bc1qa')] }, chainRegistry);
        expect(rows,
            'the chain produced no row at all, so an unreadable balance makes the coin vanish '
            + 'from the list rather than explain itself')
            .toHaveLength(1);
        expect(rows[0].kind).toBe('native');
        expect(rows[0].unavailable).toBe('all');
        expect(rows[0].unavailableReason).toMatch(/502/);
    });

    it('when SOME addresses answer, the row is marked partial, not whole', () => {
        const rows = buildBalanceRows(
            { [CHAIN]: [healthy('bc1qa', 100000000), nativeDown('bc1qb')] },
            chainRegistry,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].quantity, 'the addresses that DID answer should still be counted').toBe('100000000');
        expect(rows[0].unavailable,
            'a partial sum was presented as the whole balance, which is what a user decides how '
            + 'much to send against')
            .toBe('partial');
    });

    it('a token-side failure does not mark the native row', () => {
        // The flag is per-side; conflating them would put "unavailable" on a
        // native balance that was read perfectly well.
        const rows = buildBalanceRows({
            [CHAIN]: [entry('bc1qa', {
                native: { tick: 'BTC', quantity: '5', divisibility: 8 },
                tokens: [],
                unavailable: ['tokens'],
                unavailableReason: 'token ledger timed out',
            })],
        }, chainRegistry);
        expect(rows[0].unavailable).toBeUndefined();
        expect(rows[0].quantity).toBe('5');
    });
});

describe('BalanceList rendering of an unavailable balance (Q-1)', () => {
    it('says so instead of printing a zero', () => {
        const rows = buildBalanceRows({ [CHAIN]: [nativeDown('bc1qa')] }, chainRegistry);
        render(<BalanceList rows={rows} />);

        expect(screen.getByText(/Unavailable/i)).toBeTruthy();
        expect(screen.getByText(/couldn't be loaded/i)).toBeTruthy();
        // The whole point: no figure at all, because there is no figure.
        expect(screen.queryByText('0.00000000'),
            'an unread balance is still rendered as a quantity, so it reads as a true zero')
            .toBeNull();
    });

    it('a partial sum is shown, but flagged as a floor rather than a total', () => {
        const rows = buildBalanceRows(
            { [CHAIN]: [healthy('bc1qa', 100000000), nativeDown('bc1qb')] },
            chainRegistry,
        );
        render(<BalanceList rows={rows} />);

        expect(screen.getByText('1.00000000'),
            'the addresses that answered should still be counted and shown')
            .toBeTruthy();
        expect(screen.getByText(/^At least/),
            'a partial total is presented as the whole balance')
            .toBeTruthy();
    });

    it('a healthy zero renders as an ordinary zero, with no unavailable copy', () => {
        const rows = buildBalanceRows({ [CHAIN]: [healthy('bc1qa', 0)] }, chainRegistry);
        render(<BalanceList rows={rows} />);

        expect(screen.getByText('0.00000000')).toBeTruthy();
        expect(screen.queryByText(/Unavailable/i),
            'a genuinely empty wallet is being told its balance could not be read')
            .toBeNull();
        expect(screen.queryByText(/^At least/)).toBeNull();
    });
});

describe('BalanceList network labelling off mainnet (D-60)', () => {
    it('a non-mainnet coin names its network in the row', () => {
        // Demo mode is started with `activeNetwork: 'regtest'` by Onboarding
        // and never says so, so the user reads "Bitcoin / BTC" priced at
        // $7,000,000 for coins worth nothing. The first time the word regtest
        // reached them was a Send-form validation error.
        const rows = buildBalanceRows(
            { 'bitcoin-regtest': [healthy('bcrt1qa', 100000000)] },
            chainRegistry,
        );
        expect(rows, 'the registry has no bitcoin-regtest chain').toHaveLength(1);
        render(<BalanceList rows={rows} />);
        expect(screen.getByText(/regtest/i),
            'a regtest balance is presented indistinguishably from a mainnet one')
            .toBeTruthy();
    });

    it('but a mainnet coin does not, because there the network IS the default', () => {
        // Repeating "mainnet" on every row is the noise the original rule was
        // written to avoid, and that rule is still right where it applies.
        const rows = buildBalanceRows({ [CHAIN]: [healthy('bc1qa', 100000000)] }, chainRegistry);
        render(<BalanceList rows={rows} />);
        expect(screen.queryByText(/mainnet/i)).toBeNull();
    });
});
