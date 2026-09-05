// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2 acceptance test 1's last clause, on the page it actually happens on.
//
// Clicking a History row does not expand it in place on the real shells: every
// App.jsx wires `onSelectEntry` to navigate to this standalone ActionDetail,
// handing it a SNAPSHOT of the entry and never revisiting it. For a confirmed
// action that is fine. For a pending one it is the bug, because the whole
// point of showing a transaction early is that it will change while the user
// is looking at it, and the acceptance test says "the SAME entry upgrades in
// place to the confirmed detail with SPV/LINK back".

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const THEIRS = 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1';
const HASH = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';

/** The merged pending entry History hands over, in its real shape. */
const pendingEntry = {
    key: `pending:${CHAIN}:${HASH}`,
    chainId: CHAIN,
    address: OURS,
    actionIndex: '',
    action: 'SEND',
    blockIndex: 0,
    timestamp: Date.now() - 30000,
    txHash: HASH,
    source: THEIRS,
    raw: { source: THEIRS, destination: OURS },
    link: null,
    pending: {
        origin: 'mempool',
        firstSeenMs: Date.now() - 30000,
        observedAtMs: Date.now() - 30000,
        broadcastAtMs: null,
        lastMempoolSeenMs: Date.now() - 30000,
        direction: 'in',
        destinations: [OURS],
        data: `SEND|2|XCHAIN|100|${OURS}`,
        localStatus: null,
        pendingTxId: null,
        replaced: false,
        replacementTxHash: null,
    },
};

/** The confirmed row for the SAME transaction, as the explorer publishes it. */
function confirmedRow(over = {}) {
    return {
        action_index: '1255',
        action: 'SEND',
        block_index: 7707,
        timestamp: Math.floor(Date.now() / 1000),
        tx_hash: HASH,
        source: THEIRS,
        ...over,
    };
}

function mount(history) {
    const messaging = {
        getAddressHistory: vi.fn().mockImplementation(() => Promise.resolve(history())),
        getActionByIndex: vi.fn().mockResolvedValue(null),
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
    };
    const view = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ActionDetail, {
                entry: pendingEntry, walletId: 'w1', onBack: () => {},
            }),
        ),
    );
    return { messaging, view };
}

/**
 * Push past one poll interval and let the resulting promises settle. Real
 * timers elsewhere in the file: only the two upgrade tests need the clock.
 */
async function advancePoll() {
    await act(async () => {
        vi.advanceTimersByTime(21000);
        await Promise.resolve();
        await Promise.resolve();
    });
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the standalone detail page upgrades in place when the action confirms', () => {
    it('opens on the pending form and says the indexer has not validated it', async () => {
        mount(() => []);
        await waitFor(() => expect(
            screen.getByText(/not yet validated by the service/i),
        ).toBeTruthy());
        // A pending action has no index, and the title must not invent one:
        // "#0" is a real action index on every chain.
        expect(screen.queryByText(/#0\b/)).toBeNull();
    });

    it('re-resolves the SAME transaction into the confirmed detail without a remount', async () => {
        // The explorer has nothing at first, then publishes the confirmed row,
        // exactly as a real chain does while the page is open.
        // Installed BEFORE the mount: fake timers only govern intervals
        // created after they are in place, and the poll starts on mount.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        let landed = false;
        const { messaging } = mount(() => (landed ? [confirmedRow()] : []));
        await waitFor(() => expect(messaging.getAddressHistory).toHaveBeenCalled());
        expect(screen.getByText(/not yet validated by the service/i)).toBeTruthy();

        landed = true;
        // The page re-looks on the same 20s beat as the list, so the clock has
        // to move for this to be a test of the product rather than of patience.
        await advancePoll();
        await waitFor(() => {
            expect(screen.queryByText(/not yet validated by the service/i)).toBeNull();
        });
        // The confirmed identity is now on screen: the block it landed in and
        // the action index it was assigned.
        expect(screen.getByText(/7,707/)).toBeTruthy();
        expect(screen.getByText(/1,255/)).toBeTruthy();
    });

    it('matches the confirmed row case-insensitively', async () => {
        // The merge lowercases the hash because it is the merge key; the
        // explorer is under no obligation to.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        let landed = false;
        mount(() => (landed ? [confirmedRow({ tx_hash: HASH.toUpperCase() })] : []));
        await waitFor(() => expect(
            screen.getByText(/not yet validated by the service/i),
        ).toBeTruthy());
        landed = true;
        await advancePoll();
        await waitFor(() => {
            expect(screen.queryByText(/not yet validated by the service/i)).toBeNull();
        });
    });

    it('does NOT upgrade to a row the explorer carries without a block', async () => {
        // The explorer can list a transaction before it has a block. Swapping
        // to that would lose the pending detail and gain nothing.
        mount(() => [confirmedRow({ block_index: 0, action_index: '1255' })]);
        await waitFor(() => expect(
            screen.getByText(/not yet validated by the service/i),
        ).toBeTruthy());
        await new Promise((r) => setTimeout(r, 150));
        // "Still pending" is not enough to prove no swap happened: a blockless
        // row renders as pending too. What only survives a NON-swap is the
        // pending METADATA, which a normalized explorer row does not carry, so
        // the state-specific headline is the distinguishing evidence.
        expect(screen.getByText(/In the mempool, waiting for a block/i)).toBeTruthy();
        expect(screen.getByText(/not yet validated by the service/i)).toBeTruthy();
    });

    it('ignores an unrelated transaction on the same address', async () => {
        mount(() => [confirmedRow({ tx_hash: 'ffffffffffffffffffffffffffffffff' })]);
        await waitFor(() => expect(
            screen.getByText(/not yet validated by the service/i),
        ).toBeTruthy());
        await new Promise((r) => setTimeout(r, 150));
        expect(screen.getByText(/not yet validated by the service/i)).toBeTruthy();
    });

    it('does not poll at all for an already-confirmed entry', async () => {
        const messaging = {
            getAddressHistory: vi.fn().mockResolvedValue([]),
            getActionByIndex: vi.fn().mockResolvedValue(null),
            getSettings: vi.fn().mockResolvedValue({}),
            listContacts: vi.fn().mockResolvedValue([]),
            verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
        };
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(ActionDetail, {
                    entry: { ...pendingEntry, blockIndex: 7707, actionIndex: '1255', pending: undefined },
                    walletId: 'w1',
                    onBack: () => {},
                }),
            ),
        );
        await new Promise((r) => setTimeout(r, 150));
        expect(messaging.getAddressHistory).not.toHaveBeenCalled();
    });

    it('survives an explorer that is failing, staying on the pending detail', async () => {
        const messaging = {
            getAddressHistory: vi.fn().mockRejectedValue(new Error('explorer down')),
            getActionByIndex: vi.fn().mockResolvedValue(null),
            getSettings: vi.fn().mockResolvedValue({}),
            listContacts: vi.fn().mockResolvedValue([]),
            verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
        };
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(ActionDetail, {
                    entry: pendingEntry, walletId: 'w1', onBack: () => {},
                }),
            ),
        );
        await waitFor(() => expect(messaging.getAddressHistory).toHaveBeenCalled());
        expect(screen.getByText(/not yet validated by the service/i)).toBeTruthy();
    });
});
