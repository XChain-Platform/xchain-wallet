// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2.3 on the standalone detail page and on the card it shares with
// History. The page already tolerated a missing action index by
// accident: the SPV check and the LINK peer fetch happened to no-op on
// the conditions they lean on. This drives the deliberate version, where
// the sections a pending entry cannot fill are suppressed rather than
// rendered empty, and the title stops naming an action index that
// belongs to somebody else's transaction.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';
import { DetailCard } from '../../../packages/core/src/shared/routes/History.jsx';

const CHAIN = 'litecoin-regtest';
const OURS = 'mtkx2FQ7QhPPZmVyLKVWMkfmYmvQRUXCmi';
const THEIRS = 'moV6MFm6cLkPXAhLKGRAGyPTPtFYPMYLW1';
const TX_HASH = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';

function stubMessaging() {
    return {
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getActionByIndex: vi.fn().mockResolvedValue({ action: 'SEND', action_index: '9' }),
        verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
    };
}

/**
 * A pending entry carrying a LINK record. The merge never produces one
 * today (a pending entry has no indexed pairing to point at), and that
 * is exactly why the entry is built by hand here: a suppression that
 * only holds because its input is always empty is not a suppression.
 */
function pendingEntry(over = {}) {
    return {
        key: `pending:${CHAIN}:${TX_HASH}`,
        chainId: CHAIN,
        address: OURS,
        actionIndex: '',
        action: 'SEND',
        blockIndex: 0,
        timestamp: Date.now() - 30000,
        txHash: TX_HASH,
        source: THEIRS,
        raw: { source: THEIRS, destination: OURS, data: `SEND|0|XCHAIN|100|${OURS}|` },
        link: {
            peerChainId: 'bitcoin-regtest',
            peerCoinTicker: 'BTC',
            peerActionIndex: '42',
            linkActionIndex: '43',
        },
        pending: {
            origin: 'mempool',
            firstSeenMs: Date.now() - 30000,
            observedAtMs: Date.now() - 30000,
            broadcastAtMs: null,
            lastMempoolSeenMs: Date.now() - 30000,
            direction: 'in',
            destinations: [OURS],
            data: `SEND|0|XCHAIN|100|${OURS}|`,
            localStatus: null,
            pendingTxId: null,
            replaced: false,
            replacementTxHash: null,
        },
        ...over,
    };
}

function confirmedEntry(over = {}) {
    return {
        key: `${CHAIN}:1255:${OURS}`,
        chainId: CHAIN,
        address: OURS,
        actionIndex: '1255',
        action: 'SEND',
        blockIndex: 7707,
        timestamp: Date.now() - 10000,
        txHash: TX_HASH,
        source: THEIRS,
        raw: { source: THEIRS, destination: OURS },
        link: null,
        ...over,
    };
}

function renderDetail(entry, messaging = stubMessaging()) {
    const view = render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ActionDetail, {
                entry, walletId: 'w1', onBack: () => {},
            }),
        ),
    );
    return { messaging, view };
}

afterEach(() => { cleanup(); });

describe('ActionDetail on a pending entry', () => {
    it('does not title the page with an action index the entry does not have', async () => {
        const { view } = renderDetail(pendingEntry());
        await screen.findByRole('region', { name: 'Pending transaction' });
        // "#0" is a real action on every chain; naming it here would
        // point the user at somebody else's transaction.
        expect(view.container.textContent).not.toContain('#0');
    });

    it('still titles a confirmed entry with its index', async () => {
        const { view } = renderDetail(confirmedEntry());
        await waitFor(() => expect(view.container.textContent).toContain('#1,255'));
    });

    it('asks for no SPV verdict, having no indexed action to check', async () => {
        const { messaging } = renderDetail(pendingEntry());
        await screen.findByRole('region', { name: 'Pending transaction' });
        expect(messaging.verifyAction).not.toHaveBeenCalled();
    });

    it('fetches no LINK peer for a transaction no indexer has paired yet', async () => {
        const { messaging } = renderDetail(pendingEntry());
        await screen.findByRole('region', { name: 'Pending transaction' });
        expect(messaging.getActionByIndex).not.toHaveBeenCalled();
    });

    it('verifies and pairs a confirmed entry, so the suppression is the pending branch', async () => {
        const { messaging } = renderDetail(confirmedEntry({
            link: {
                peerChainId: 'bitcoin-regtest',
                peerCoinTicker: 'BTC',
                peerActionIndex: '42',
                linkActionIndex: '43',
            },
        }));
        await waitFor(() => expect(messaging.getActionByIndex).toHaveBeenCalled());
        await waitFor(() => expect(messaging.verifyAction).toHaveBeenCalled());
    });

    it('carries the pending branch onto the page', async () => {
        renderDetail(pendingEntry());
        const panel = await screen.findByRole('region', { name: 'Pending transaction' });
        expect(within(panel).getByText('Pending, not yet validated by the indexer.')).toBeTruthy();
    });
});

describe('DetailCard suppresses the LINK section on a pending entry', () => {
    function renderCard(entry) {
        const messaging = stubMessaging();
        const view = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(DetailCard, {
                    entry, peerCache: {}, walletId: 'w1',
                }),
            ),
        );
        return { messaging, view };
    }

    it('renders no peer block for a pending entry that carries a link record', async () => {
        const { view } = renderCard(pendingEntry());
        fireEvent.click(screen.getByText('Raw'));
        // The raw payload itself still renders; only the peer half of
        // the tab is gone.
        expect(view.container.querySelector('pre')).toBeTruthy();
        expect(view.container.textContent).not.toContain('Peer ·');
    });

    it('renders the peer block once the same transaction has a block', async () => {
        const { view } = renderCard(confirmedEntry({
            link: {
                peerChainId: 'bitcoin-regtest',
                peerCoinTicker: 'BTC',
                peerActionIndex: '42',
                linkActionIndex: '43',
            },
        }));
        fireEvent.click(screen.getByText('Raw'));
        expect(view.container.textContent).toContain('Peer ·');
    });
});
