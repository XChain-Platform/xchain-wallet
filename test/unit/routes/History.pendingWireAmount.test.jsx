// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The wallet's pending decoder claims to mirror the SDK's
// `parseActionString`, which drops a whole action the moment one output's
// amount fails `isPosNum`. The wallet copy used to accept any non-empty
// segment, so `SEND|0|XCHAIN|abc|<addr>` reached the screen as
// "receiving abc XCHAIN": a garbage string wearing an amount's clothes,
// in the same slot a settled figure occupies.
//
// Driven through the real route, because the question is what the row
// and the detail panel show, not what a helper returns. The verbatim
// big-decimal case is the one that must never regress: the guard has to
// read the string's shape, since a round-trip through a JS number turns
// 92233720368547758.07 into a different number.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const THEIRS = 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1';
const PENDING_HASH = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';

function mountHistory({ mempool = [] } = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue(mempool),
        getPendingTxsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getActionByIndex: vi.fn().mockResolvedValue(null),
    };
    const view = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(History, { walletId: 'w1', accountId: 'a1' }),
        ),
    );
    return { messaging, view };
}

/**
 * An incoming pending SEND carrying `amount` in the v0 amount position.
 * `first_seen` stays recent: the default 30-day window drops older rows,
 * and an invisible row proves nothing about what it would have rendered.
 */
function sendRow(amount, over = {}) {
    return {
        tx_hash: PENDING_HASH,
        source: THEIRS,
        action: 'SEND',
        data: `SEND|0|XCHAIN|${amount}|${OURS}|`,
        first_seen: Math.floor(Date.now() / 1000) - 30,
        destinations: [OURS],
        ...over,
    };
}

/** The row's amount annotation, or null when the row declined to print one. */
function annotation(view) {
    return view.container.querySelector('[data-pending-amount]');
}

/** Open the pending row's detail card and return its pending panel. */
async function openPendingPanel(view) {
    await waitFor(() => {
        expect(view.container.querySelector('[data-pending-state]')).toBeTruthy();
    });
    fireEvent.click(view.container.querySelector('[data-pending-state]').closest('button'));
    const region = screen.getByRole('region', { name: 'Action detail' });
    return within(region).getByRole('region', { name: 'Pending transaction' });
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    try { window.localStorage.clear(); } catch { /* jsdom without storage */ }
});

describe('History refuses a pending SEND whose amount is not an amount', () => {
    it('prints no figure for a non-numeric amount and shows the raw segments instead', async () => {
        const { view } = mountHistory({ mempool: [sendRow('abc')] });
        await waitFor(() => expect(view.container.textContent).toContain('pending'));

        expect(annotation(view)).toBeNull();
        expect(view.container.textContent).not.toContain('abc XCHAIN');

        const panel = await openPendingPanel(view);
        expect(within(panel).getByText(/does not read SEND data/)).toBeTruthy();
        expect(within(panel).getByText('abc')).toBeTruthy();
        expect(panel.textContent).not.toContain(`abc XCHAIN to ${OURS}`);
    });

    // Each of these passes the layout's segment count and fails the SDK's
    // `isPosNum`, so each must fail here too or the two parsers disagree
    // about the same wire string.
    const REJECTED = [
        ['zero', '0'],
        ['zero with a decimal tail', '0.00'],
        ['a negative', '-5'],
        ['a leading plus', '+5'],
        ['exponent notation', '1e3'],
        ['surrounding whitespace', ' 100 '],
        ['a thousands separator', '1,000'],
        ['a bare decimal point', '.5'],
        ['a hex literal', '0x10'],
        ['a trailing decimal point', '100.'],
    ];

    for (const [label, amount] of REJECTED) {
        it(`declines ${label} in the amount position`, async () => {
            const { view } = mountHistory({ mempool: [sendRow(amount)] });
            await waitFor(() => expect(view.container.textContent).toContain('pending'));

            expect(annotation(view)).toBeNull();
            const panel = await openPendingPanel(view);
            expect(within(panel).getByText(/does not read SEND data/)).toBeTruthy();
            expect(panel.textContent).not.toContain(`${amount} XCHAIN to`);
        });
    }

    it('drops the whole action when only the second output is malformed', async () => {
        // The SDK returns null for the action, not for the one output, so
        // a good first output must not survive a bad second one.
        const { view } = mountHistory({
            mempool: [sendRow('unused', {
                data: `SEND|3|XCHAIN|100|${OURS}|m1|PEPE|abc|${OURS}|m2`,
            })],
        });
        await waitFor(() => expect(view.container.textContent).toContain('pending'));

        expect(annotation(view)).toBeNull();
        expect(view.container.textContent).not.toContain('100 XCHAIN');
    });
});

describe('History still shows a well-formed pending amount exactly', () => {
    it('renders a plain amount on the row and in the panel', async () => {
        const { view } = mountHistory({ mempool: [sendRow('100')] });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        expect(annotation(view).textContent).toBe('receiving 100 XCHAIN');

        const panel = await openPendingPanel(view);
        expect(within(panel).getByText(`100 XCHAIN to ${OURS}`)).toBeTruthy();
    });

    it('carries a decimal past float precision through verbatim', async () => {
        // 92233720368547758.07 is not representable as a JS number; any
        // guard that parses it hands the screen 92233720368547760.
        const exact = '92233720368547758.07';
        const { view } = mountHistory({ mempool: [sendRow(exact)] });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        expect(annotation(view).textContent).toBe(`receiving ${exact} XCHAIN`);

        const panel = await openPendingPanel(view);
        expect(within(panel).getByText(`${exact} XCHAIN to ${OURS}`)).toBeTruthy();
    });

    it('keeps a small amount whose float round-trip becomes exponent notation', async () => {
        const exact = '0.000000010000000001';
        const { view } = mountHistory({ mempool: [sendRow(exact)] });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        expect(annotation(view).textContent).toBe(`receiving ${exact} XCHAIN`);
    });

    it('accepts an amount with more digits than a number can hold', async () => {
        const exact = '123456789012345678901234567890';
        const { view } = mountHistory({ mempool: [sendRow(exact)] });
        await waitFor(() => expect(annotation(view)).toBeTruthy());
        expect(annotation(view).textContent).toBe(`receiving ${exact} XCHAIN`);
    });
});
