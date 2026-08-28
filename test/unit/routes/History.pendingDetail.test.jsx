// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2.3 driven through the real History route: the row-level pending
// state, the detail branch behind it, and the handoff when the
// transaction confirms while the user is reading it.
//
// The row half is not decoration. Acceptance test 3 asks for a
// transaction the network never reported to be findable in a LIST, and
// the list said "unconfirmed" for every blockless row: the same word for
// a healthy send and for one that never reached a node.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { History } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const THEIRS = 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1';
const SEEN_HASH = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';
const LOCAL_HASH = '1122334455667788990011223344556677889900aabbccddeeff001122334455';
const REPLACEMENT_HASH = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa998877665544332211ff';

function stubMessaging({ mempool = [], pendingTxs = [], history = [] } = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OURS }] }),
        getAddressHistory: vi.fn().mockResolvedValue(history),
        getLinksForAddress: vi.fn().mockResolvedValue([]),
        getAddressMempool: vi.fn().mockResolvedValue(mempool),
        getPendingTxsForAddress: vi.fn().mockResolvedValue(pendingTxs),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: null }),
        getMultisigReceiveAddress: vi.fn().mockRejectedValue(new Error('none')),
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getActionByIndex: vi.fn().mockResolvedValue(null),
    };
}

function mountHistory(fixtures) {
    const messaging = stubMessaging(fixtures);
    const view = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(History, { walletId: 'w1', accountId: 'a1' }),
        ),
    );
    return { messaging, view };
}

/** An incoming mempool row in the explorer's own wire vocabulary. */
function mempoolRow(over = {}) {
    return {
        tx_hash: SEEN_HASH,
        source: THEIRS,
        action: 'SEND',
        // Both amounts are above zero on purpose: the decoder mirrors the
        // SDK's `isPosNum`, which fails the whole action on a zero output,
        // and this fixture is here for the pairing rather than for that.
        data: `SEND|2|XCHAIN|100|${OURS}|SPARE|7|${THEIRS}|thanks`,
        first_seen: Math.floor(Date.now() / 1000) - 30,
        destinations: [OURS],
        ...over,
    };
}

/** Our own broadcast, old enough that no node should still be silent. */
function staleLocalSend(over = {}) {
    return {
        id: 'ptx-stale',
        chain: 'LTC',
        network: 'regtest',
        fromAddress: OURS,
        toAddress: THEIRS,
        action: 'SEND',
        actionSummary: 'Send 100 XCHAIN',
        txid: LOCAL_HASH,
        status: 'broadcast',
        createdAt: new Date(Date.now() - 700000).toISOString(),
        broadcastAt: new Date(Date.now() - 600000).toISOString(),
        mempoolSeenAt: null,
        rbfReplacement: null,
        tick: 'XCHAIN',
        amount: '100',
        ...over,
    };
}

function confirmedRow(txHash, over = {}) {
    return {
        action_index: '1255',
        action: 'SEND',
        block_index: 7707,
        timestamp: Math.floor(Date.now() / 1000) - 10,
        tx_hash: txHash,
        source: THEIRS,
        ...over,
    };
}

/** The row button carrying a given pending state, ready to click. */
function rowFor(view, state) {
    const label = view.container.querySelector(`[data-pending-state="${state}"]`);
    return label ? label.closest('button') : null;
}

async function openRow(view, state) {
    await waitFor(() => expect(rowFor(view, state)).toBeTruthy());
    fireEvent.click(rowFor(view, state));
    return screen.getByRole('region', { name: 'Action detail' });
}

/**
 * The pending panel inside an open detail card. Scoped, because the
 * status timeline beside it reads the same state from the same helper
 * and renders the same words, which is the point of one copy table.
 */
function panelIn(region) {
    return within(region).getByRole('region', { name: 'Pending transaction' });
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('History row labels a pending transaction by state', () => {
    it('never prints the word "unconfirmed" at the user', async () => {
        const { view } = mountHistory({ mempool: [mempoolRow()] });
        await waitFor(() => expect(rowFor(view, 'seen')).toBeTruthy());
        expect(view.container.textContent).not.toMatch(/unconfirmed/i);
        expect(rowFor(view, 'seen').textContent).toContain('pending');
    });

    it('separates a transaction no node has reported from healthy pending', async () => {
        // Both rows are blockless, both used to read "unconfirmed", and
        // one of them may never have reached the network at all.
        const { view } = mountHistory({
            mempool: [mempoolRow()],
            pendingTxs: [staleLocalSend()],
        });
        await waitFor(() => expect(rowFor(view, 'not-seen')).toBeTruthy());
        const healthy = view.container.querySelector('[data-pending-state="seen"]');
        const warned = view.container.querySelector('[data-pending-state="not-seen"]');

        expect(warned.textContent).toContain('not seen by network');
        expect(healthy.textContent).not.toContain('not seen by network');
        // Visibly distinct, not merely differently worded: the warning
        // state carries a treatment the healthy one does not.
        expect(warned.className).toMatch(/pendingLabelWarning/);
        expect(healthy.className).not.toMatch(/pendingLabelWarning/);
    });

    it('marks a transaction this wallet has already replaced', async () => {
        const { view } = mountHistory({
            pendingTxs: [staleLocalSend({
                status: 'rbf-replaced',
                rbfReplacement: REPLACEMENT_HASH,
            })],
        });
        await waitFor(() => expect(rowFor(view, 'replaced')).toBeTruthy());
        expect(rowFor(view, 'replaced').textContent).toContain('replaced');
    });
});

describe('History pending detail branch', () => {
    it('says the indexer has not validated the action', async () => {
        const { view } = mountHistory({ mempool: [mempoolRow()] });
        const region = await openRow(view, 'seen');
        const panel = panelIn(region);
        expect(within(panel).getByText('Pending, not yet validated by the indexer.')).toBeTruthy();
        expect(within(panel).getByText('In the mempool, waiting for a block')).toBeTruthy();
        // Nothing on the page may claim acceptance before an indexer has
        // seen the block: a mempool row is pre-validation.
        expect(region.textContent).not.toMatch(/\bAccepted\b/);
    });

    it('reads the SEND outputs off the action data, paired correctly', async () => {
        // A v2 two-output SEND: the second output's amount sits four
        // segments away from the first, so a layout read loosely pairs
        // one output's amount with another output's destination.
        const { view } = mountHistory({ mempool: [mempoolRow()] });
        const region = await openRow(view, 'seen');
        expect(within(region).getByText(`100 XCHAIN to ${OURS}`)).toBeTruthy();
        expect(within(region).getByText(`7 SPARE to ${THEIRS}`)).toBeTruthy();
    });

    it('shows raw segments for an action it cannot decode, and invents no amounts', async () => {
        const { view } = mountHistory({
            mempool: [mempoolRow({ action: 'MINT', data: 'MINT|0|XCHAIN|100|^397' })],
        });
        const region = await openRow(view, 'seen');
        expect(within(region).getByText(/does not read MINT data/)).toBeTruthy();
        expect(within(region).getByText('^397')).toBeTruthy();
        expect(region.textContent).not.toContain('100 XCHAIN to');
    });

    it('labels our own record as ours when the network has reported nothing', async () => {
        const { view } = mountHistory({ pendingTxs: [staleLocalSend()] });
        const panel = panelIn(await openRow(view, 'not-seen'));
        expect(within(panel).getByText('Not seen by the network')).toBeTruthy();
        // Exact, apostrophe included: an ICU template treats a quote as
        // an escape in some positions, and a swallowed one would ship a
        // sentence nobody wrote.
        expect(within(panel).getByText(
            'Taken from this wallet\'s own record of the send. '
            + 'The network has not reported the transaction data yet.',
        )).toBeTruthy();
        expect(within(panel).getByText(`100 XCHAIN to ${THEIRS}`)).toBeTruthy();
    });

    it('upgrades the open detail in place when the transaction confirms', async () => {
        // Acceptance test 1's last clause. The pending entry is keyed on
        // its hash and the confirmed one on its action index, so the row
        // the user is reading changes key underneath them.
        const { messaging, view } = mountHistory({ mempool: [mempoolRow()] });
        const region = await openRow(view, 'seen');
        expect(within(region).getByText('Pending, not yet validated by the indexer.')).toBeTruthy();

        messaging.getAddressMempool.mockResolvedValue([]);
        messaging.getAddressHistory.mockResolvedValue([confirmedRow(SEEN_HASH)]);
        window.dispatchEvent(new Event('focus'));

        await waitFor(() => {
            expect(screen.queryByText('Pending, not yet validated by the indexer.')).toBeNull();
        });
        // Same view, still open, now showing the confirmed form.
        const upgraded = screen.getByRole('region', { name: 'Action detail' });
        expect(within(upgraded).getAllByText('Confirmed').length).toBeGreaterThan(0);
        expect(view.container.querySelector('[data-pending-state]')).toBeNull();
    });
});

describe('History offers replacement only where it can still work', () => {
    it('offers Speed up on an eligible pending entry with no explorer links', async () => {
        // Regtest pending: no action index for the XChain link and no
        // third-party explorer, which is precisely the transaction Speed
        // up exists for.
        const { view } = mountHistory({ pendingTxs: [staleLocalSend()] });
        const region = await openRow(view, 'not-seen');
        fireEvent.click(within(region).getByText('More'));
        expect(within(region).getByText('Speed up')).toBeTruthy();
        expect(within(region).getByText('Cancel transaction')).toBeTruthy();
    });

    it('withdraws the offer once the transaction has been replaced', async () => {
        const { view } = mountHistory({
            pendingTxs: [staleLocalSend({
                status: 'rbf-replaced',
                rbfReplacement: REPLACEMENT_HASH,
            })],
        });
        const region = await openRow(view, 'replaced');
        // The follow-up menu only renders when something is on offer, so
        // open it if it is there at all: with the guard removed the
        // button comes back carrying exactly the option under test.
        const more = within(region).queryByText('More');
        if (more) fireEvent.click(more);
        expect(within(region).queryByText('Speed up')).toBeNull();
        expect(within(region).queryByText('Cancel transaction')).toBeNull();
    });
});
