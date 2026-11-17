// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// M2.3 on the standalone detail page and on the inline card History
// expands. The page already tolerated a missing action index by
// accident: the SPV check and the LINK peer fetch happened to no-op on
// the conditions they lean on. This drives the deliberate version, where
// the sections a pending entry cannot fill are suppressed rather than
// rendered empty, and the title stops naming an action index that
// belongs to somebody else's transaction.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';
import { DetailCard } from '../../../packages/core/src/shared/routes/History.jsx';
import { detailsPanel, fact, queryFact } from '../../helpers/detailFacts.js';

const detailStyles = readFileSync('packages/core/src/shared/routes/History.module.css', 'utf8');

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

/** Each status bar step's accessible text, in order. */
function statusSteps() {
    const bar = screen.getByRole('list', { name: 'Transaction Status' });
    return within(bar).getAllByRole('listitem').map((li) => li.textContent);
}

async function findPendingBar() {
    await waitFor(() => expect(statusSteps()).toEqual([
        'Signed, Complete', 'Broadcast, Complete', 'Confirmed, In Progress', 'Processed, Not Started',
    ]));
}

describe('ActionDetail on a pending entry', () => {
    it('does not title the page with an action index the entry does not have', async () => {
        const { view } = renderDetail(pendingEntry());
        await findPendingBar();
        // "#0" is a real action on every chain; naming it here would
        // point the user at somebody else's transaction.
        expect(view.container.textContent).not.toContain('#0');
    });

    it('still titles a confirmed entry with its index', async () => {
        const { view } = renderDetail(confirmedEntry());
        await waitFor(() => expect(view.container.textContent).toContain('#1255'));
        // An action index is an identifier: raw digits, never grouped (G123).
        expect(view.container.textContent).not.toContain('#1,255');
    });

    it('asks for no SPV verdict, having no indexed action to check', async () => {
        const { messaging } = renderDetail(pendingEntry());
        await findPendingBar();
        expect(messaging.verifyAction).not.toHaveBeenCalled();
    });

    it('fetches no LINK peer for a transaction no indexer has paired yet', async () => {
        const { messaging } = renderDetail(pendingEntry());
        await findPendingBar();
        expect(messaging.getActionByIndex).not.toHaveBeenCalled();
    });

    it('verifies a confirmed entry, so the suppression is the pending branch', async () => {
        const { messaging } = renderDetail(confirmedEntry({
            link: {
                peerChainId: 'bitcoin-regtest',
                peerCoinTicker: 'BTC',
                peerActionIndex: '42',
                linkActionIndex: '43',
            },
        }));
        await waitFor(() => expect(messaging.verifyAction).toHaveBeenCalled());
        // The LINK peer showed only under Raw Data, which the page dropped
        // (2026-11-13), so nothing fetches it any more.
        expect(messaging.getActionByIndex).not.toHaveBeenCalled();
    });

    it('shows the pending state only in the status bar, with no notice text', async () => {
        const { view } = renderDetail(pendingEntry());
        await findPendingBar();
        // Operator ruling 2026-11-13: the bar alone says where a pending
        // action is; no second "pending" notice or explanation.
        expect(screen.queryByRole('region', { name: 'Pending transaction' })).toBeNull();
        expect(view.container.textContent).not.toMatch(/not yet validated/i);
        expect(view.container.textContent).not.toMatch(/sign a replacement/i);
    });

    it('uses plain labels, translated action codes, no copy buttons, and explorer links', async () => {
        renderDetail(confirmedEntry());
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        const details = detailsPanel();

        expect(fact('Action').textContent).toBe('Receive');
        expect(fact('Transaction ID')).toBeTruthy();
        expect(fact('From')).toBeTruthy();
        expect(fact('To')).toBeTruthy();
        expect(queryFact('tx_hash')).toBeNull();
        expect(queryFact('block_index')).toBeNull();
        expect(statusSteps()[2]).toBe('Confirmed, Complete');

        // Copying lives in the Actions list; no value in Details carries
        // its own copy button (operator ruling 2026-11-13).
        expect(within(details).queryAllByRole('button', { name: /copy/i })).toHaveLength(0);
        // The explorer link is a row of the Actions view's action list (G101).
        fireEvent.click(screen.getByRole('tab', { name: 'Actions' }));
        expect(screen.getByRole('link', { name: /^View on the explorer/ }).getAttribute('href'))
            .toMatch(/\/RLTC\/action\/1255$/);
    });

    it('wraps long identifiers instead of truncating them', () => {
        expect(detailStyles).toMatch(/\.detailsTable td\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
        expect(detailStyles).toMatch(/\.copyableText\s*\{[^}]*white-space:\s*normal;/s);
        expect(detailStyles).not.toMatch(/\.copyableText\s*\{[^}]*text-overflow:\s*ellipsis;/s);
    });
});

describe('DetailCard shows Actions | Details only', () => {
    function renderCard(entry) {
        const messaging = stubMessaging();
        const view = render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(DetailCard, {
                    entry, walletId: 'w1',
                }),
            ),
        );
        return { messaging, view };
    }

    it('offers no Status or Raw data view and no peer block, pending or confirmed', () => {
        for (const entry of [pendingEntry(), confirmedEntry({
            link: {
                peerChainId: 'bitcoin-regtest',
                peerCoinTicker: 'BTC',
                peerActionIndex: '42',
                linkActionIndex: '43',
            },
        })]) {
            const { view } = renderCard(entry);
            expect(screen.getAllByRole('tab').map((tab) => tab.textContent.trim())).toEqual(['Actions', 'Details']);
            fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
            expect(view.container.querySelector('pre')).toBeNull();
            expect(view.container.textContent).not.toContain('Linked transaction ·');
            expect(within(detailsPanel()).queryByRole('list', { name: 'Transaction status' })).toBeNull();
            view.unmount();
        }
    });

    it('labels an oracle-priced zero in Details', () => {
        const raw = {
            action: 'DISPENSER', get_amount: '0', fiat_code: 'USD',
            oracle_address: 'bc1qoracleoracleoracleoracleoracleoracle',
        };
        renderCard(confirmedEntry({ action: 'DISPENSER', raw }));
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(fact('Get amount').textContent)
            .toBe("Varies: set from the oracle's USD price at each purchase");
    });

    it('words an oracle-priced zero without a fiat code as the oracle price', () => {
        const raw = {
            action: 'DISPENSER', get_amount: '0',
            oracle_address: 'bc1qoracleoracleoracleoracleoracleoracle',
        };
        renderCard(confirmedEntry({ action: 'DISPENSER', raw }));
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(fact('Get amount').textContent)
            .toBe("Varies: set from the oracle's price at each purchase");
    });

    it('labels zero allow and block lists as none in History details', () => {
        const raw = { action: 'ORDER', allow_list: '0', block_list: 0 };
        const { view } = renderCard(confirmedEntry({ action: 'ORDER', raw }));
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));

        for (const key of ['Allow list', 'Block list']) {
            expect(fact(key).textContent).toBe('None');
        }
        expect(view.container.textContent).not.toMatch(/list #0/i);
    });
});
