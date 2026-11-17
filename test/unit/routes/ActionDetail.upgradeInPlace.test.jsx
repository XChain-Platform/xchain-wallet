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
import { render, screen, waitFor, cleanup, act, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';
import { fact } from '../../helpers/detailFacts.js';

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
 * Push past one poll interval and let the resulting promises settle. Tests
 * that exercise polling install fake timers before mounting the page.
 */
async function advancePoll() {
    await act(async () => {
        vi.advanceTimersByTime(21000);
        await Promise.resolve();
        await Promise.resolve();
    });
}

/**
 * The step the page's status bar marks as current, read as its accessible
 * text ("Confirmed, In Progress"); null once every step is complete. The bar
 * alone says where a pending action is (operator ruling 2026-11-13).
 */
function currentStep() {
    const bar = screen.getByRole('list', { name: 'Transaction Status' });
    const step = within(bar).getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'step');
    return step ? step.textContent : null;
}

const PENDING_STEP = 'Confirmed, In Progress';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the standalone detail page upgrades in place when the action confirms', () => {
    it('opens on the pending status with no pending notice text', async () => {
        mount(() => []);
        await waitFor(() => expect(currentStep()).toBe(PENDING_STEP));
        expect(screen.queryByText(/not yet validated by the service/i)).toBeNull();
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
        expect(currentStep()).toBe(PENDING_STEP);

        landed = true;
        // The page re-looks on the same 20s beat as the list, so the clock has
        // to move for this to be a test of the product rather than of patience.
        await advancePoll();
        await waitFor(() => expect(currentStep()).toBeNull());
        // The confirmed identity is now on screen: the action index it was
        // assigned in the title, and the block it landed in under Details.
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/^Receive #1255$/);
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(fact('Block')).toHaveTextContent(/^7707$/);
    });

    it('matches the confirmed row case-insensitively', async () => {
        // The merge lowercases the hash because it is the merge key; the
        // explorer is under no obligation to.
        vi.useFakeTimers({ shouldAdvanceTime: true });
        let landed = false;
        mount(() => (landed ? [confirmedRow({ tx_hash: HASH.toUpperCase() })] : []));
        await waitFor(() => expect(currentStep()).toBe(PENDING_STEP));
        landed = true;
        await advancePoll();
        await waitFor(() => expect(currentStep()).toBeNull());
    });

    it('does NOT upgrade to a row the explorer carries without a block', async () => {
        // The explorer can list a transaction before it has a block. Swapping
        // to that would lose the pending detail and gain nothing.
        const { messaging } = mount(() => [confirmedRow({ block_index: 0, action_index: '1255' })]);
        await waitFor(() => expect(currentStep()).toBe(PENDING_STEP));
        await act(async () => { await messaging.getAddressHistory.mock.results[0].value; });
        // "Still pending" is not enough to prove no swap happened: a blockless
        // row renders as pending too. What only survives a NON-swap is the
        // pending METADATA, which a normalized explorer row does not carry, so
        // the First seen fact under Details is the distinguishing evidence.
        expect(currentStep()).toBe(PENDING_STEP);
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(fact('First seen')).toBeTruthy();
    });

    it('ignores an unrelated transaction on the same address', async () => {
        const { messaging } = mount(() => [confirmedRow({ tx_hash: 'ffffffffffffffffffffffffffffffff' })]);
        await waitFor(() => expect(currentStep()).toBe(PENDING_STEP));
        await act(async () => { await messaging.getAddressHistory.mock.results[0].value; });
        expect(currentStep()).toBe(PENDING_STEP);
    });

    it('does not poll at all for an already-confirmed entry', async () => {
        vi.useFakeTimers();
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
        await advancePoll();
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
        expect(currentStep()).toBe(PENDING_STEP);
    });

    it('never polls the explorer for a demo wallet pending row (issue #82)', async () => {
        // The demo History carries a pending sample row on the wallet's real
        // address; on mainnet a poll would hand that address to a public
        // explorer, and the sample row never confirms anyway.
        globalThis.localStorage.setItem('xc:demoWalletId', 'w1');
        try {
            const { messaging } = mount(() => []);
            await waitFor(() => expect(currentStep()).toBe(PENDING_STEP));
            await new Promise((r) => setTimeout(r, 150));
            expect(messaging.getAddressHistory).not.toHaveBeenCalled();
        } finally {
            globalThis.localStorage.removeItem('xc:demoWalletId');
        }
    });
});
