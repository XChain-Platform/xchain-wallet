// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ActionDetail } from '../../../packages/core/src/shared/routes/ActionDetail.jsx';

const CHAIN = 'bitcoin-mainnet';
const OURS = 'bc1qwalletaddress000000000000000000000000001';
const OURS_TOO = 'bc1qwalletaddress000000000000000000000000002';
const THEIRS = 'bc1qcounterparty00000000000000000000000001';
const TX_HASH = 'aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899';

function entry(overrides = {}) {
    return {
        key: `${CHAIN}:42:${OURS}`,
        chainId: CHAIN,
        address: OURS,
        actionIndex: '42',
        action: 'SEND',
        blockIndex: 100,
        timestamp: 1705350600,
        txHash: TX_HASH,
        source: OURS,
        raw: {
            source: OURS,
            destination: THEIRS,
            amount: '12.5000',
            tick: 'WALLETCOIN',
            fee: '0.0001',
            memo: 'invoice 17',
        },
        link: null,
        detailContext: {
            chainTip: 110,
            indexerWatermark: 110,
            walletAddresses: [OURS, OURS_TOO],
        },
        ...overrides,
    };
}

function messaging() {
    return {
        getSettings: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        verifyAction: vi.fn().mockResolvedValue({ status: 'verified', reason: null }),
    };
}

function renderDetails(value) {
    const view = render(
        <MessagingProvider shell="web" messaging={messaging()}>
            <ActionDetail entry={value} walletId="wallet" onBack={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    return view;
}

function field(label) {
    const panel = screen.getByRole('tabpanel');
    return within(panel).getByRole('rowheader', { name: label }).closest('tr').querySelector('td');
}

afterEach(() => cleanup());

describe('transaction detail field sources', () => {
    it.each([
        {
            name: 'send',
            value: entry(),
            direction: 'Sent',
            amount: '-12.5 WALLETCOIN',
            counterparty: THEIRS,
        },
        {
            name: 'receive',
            value: entry({
                source: THEIRS,
                raw: {
                    source: THEIRS,
                    destination: OURS,
                    amount: '3.25',
                    tick: 'WALLETCOIN',
                    fee: '0.0002',
                    memo: 'refund',
                },
            }),
            direction: 'Received',
            amount: '+3.25 WALLETCOIN',
            counterparty: THEIRS,
        },
        {
            name: 'self-transfer',
            value: entry({
                raw: {
                    source: OURS,
                    destination: OURS_TOO,
                    amount: '2.5',
                    tick: 'WALLETCOIN',
                    fee: '0.0003',
                    memo: 'consolidation',
                },
            }),
            direction: 'Self',
            amount: '±2.5 WALLETCOIN',
            counterparty: 'Self',
        },
    ])('derives $name direction, signed asset amount, and counterparty', ({ value, direction, amount, counterparty }) => {
        renderDetails(value);

        expect(field('Direction')).toHaveTextContent(direction);
        expect(field('Amount')).toHaveTextContent(amount);
        // A long address keeps both ends on screen and the whole value in
        // its title; a short value such as "Self" reads in full.
        const counterpartyCell = field('Counterparty');
        if (counterparty.length > 14) {
            expect(counterpartyCell.querySelector(`[title="${counterparty}"]`)).toBeTruthy();
            expect(counterpartyCell).toHaveTextContent(`${counterparty.slice(0, 6)}…${counterparty.slice(-6)}`);
            // The copy button follows the value and says only "Copy".
            const copy = within(counterpartyCell).getByRole('button', { name: 'Copy counterparty address' });
            expect(copy).toHaveTextContent(/^Copy$/);
        } else {
            expect(counterpartyCell).toHaveTextContent(counterparty);
        }
        expect(field('Network fee')).toHaveTextContent(/0\.000[123] BTC/);
        expect(field('Confirmations')).toHaveTextContent('11');
        expect(field('Block')).toHaveTextContent('100');
        // The chain is named; the network kind (regtest) is not.
        expect(field('Network')).toHaveTextContent('Bitcoin');
        expect(within(screen.getByRole('tabpanel')).queryByRole('rowheader', { name: 'Network' })).toBeNull();
        expect(field('Time')).not.toHaveTextContent(/^-$|^$/);
        expect(field('Memo')).not.toHaveTextContent('-');
        expect(within(field('Explorer')).getByRole('link', { name: 'Open in explorer' }))
            .toHaveAttribute('href', 'https://explorer.xchain.io/BTC/action/42');
    });

    it.each([
        ['an outgoing send', entry(), 'Send #42'],
        ['an incoming send', entry({
            source: THEIRS,
            raw: { source: THEIRS, destination: OURS, amount: '3.25', tick: 'WALLETCOIN' },
        }), 'Receive #42'],
        // Home's rows can arrive without the wallet address list; the row's
        // own address still says the value came in.
        ['an incoming send with no wallet address list', entry({
            source: THEIRS,
            raw: { source: THEIRS, destination: OURS, amount: '3.25', tick: 'WALLETCOIN' },
            detailContext: { chainTip: 110 },
        }), 'Receive #42'],
        ['a pending incoming send', entry({
            source: THEIRS,
            actionIndex: '',
            blockIndex: 0,
            raw: { source: THEIRS, destination: OURS, amount: '3.25', tick: 'WALLETCOIN' },
        }), 'Receive'],
        ['a non-transfer action', entry({ action: 'ISSUE' }), 'Issue #42'],
    ])('names %s by its direction in the page header', (_label, value, title) => {
        renderDetails(value);

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(new RegExp(`^${title}$`));
    });

    it('shows token-action amounts without inventing transfer direction or a counterparty', () => {
        renderDetails(entry({
            action: 'ISSUE',
            raw: { source: OURS, amount: '1000', tick: 'NEWCOIN' },
        }));

        expect(field('Direction')).toHaveTextContent('-');
        expect(field('Amount')).toHaveTextContent('1,000 NEWCOIN');
        expect(field('Network fee')).toHaveTextContent('-');
        expect(field('Counterparty')).toHaveTextContent('-');
        expect(field('Memo')).toHaveTextContent('-');
    });

    it('renders sparse and non-finite canonical fields as dashes', () => {
        const view = renderDetails(entry({
            actionIndex: 'NaN',
            blockIndex: Number.NaN,
            timestamp: Number.NaN,
            txHash: 'undefined',
            source: 'null',
            raw: {
                destination: 'undefined',
                amount: Number.NaN,
                tick: null,
                fee: 'Infinity',
                memo: 'null',
            },
            detailContext: { chainTip: Number.NaN, walletAddresses: [OURS] },
        }));

        for (const label of [
            'Direction', 'Amount', 'Network fee', 'Counterparty',
            'Confirmations', 'Block', 'Time', 'Memo', 'Explorer',
        ]) {
            expect(field(label)).toHaveTextContent('-');
        }
        expect(view.container.textContent).not.toMatch(/\b(?:undefined|null|NaN|Infinity)\b/);
    });

    it('links a blockless hash to the transaction explorer route', () => {
        renderDetails(entry({
            actionIndex: '',
            blockIndex: 0,
            detailContext: { chainTip: null, walletAddresses: [OURS] },
        }));

        expect(within(field('Explorer')).getByRole('link', { name: 'Open in explorer' }))
            .toHaveAttribute('href', `https://explorer.xchain.io/BTC/tx/${TX_HASH}`);
    });
});
