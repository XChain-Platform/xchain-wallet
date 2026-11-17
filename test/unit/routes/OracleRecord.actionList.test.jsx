// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// G101 and G102 on the oracle record: Place bet, Copy address and Resolve are
// rows of the shared action list in an Actions tab, the first tab and chosen
// on arrival, before Markets and Details. Each row still runs what its
// button ran.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';

const copyText = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock('../../../packages/core/src/shared/clipboard.js', () => ({ copyText: (...args) => copyText(...args) }));

const { MessagingProvider } = await import('../../../packages/core/src/shared/MessagingProvider.jsx');
const { OracleRecord } = await import('../../../packages/core/src/shared/routes/OracleRecord.jsx');

const CHAIN = 'bitcoin-mainnet';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';

function messagingFor({ markets, closed = 0, own = false } = {}) {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [{ id: 'a0', address: own ? ORACLE : 'bc1qother', source: 'hd' }] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        betOracle: () => Promise.resolve({ data: [{ address: ORACLE, total_feeds: 3, active_feeds: 2, counts: { open: 2, closed } }] }),
        betFeeds: () => Promise.resolve({ data: markets }),
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
}

const ONE_OPEN = [{ action_index: '2308', label: 'Who wins the final?', tick: 'XCHAIN', feed_status: 'open' }];
const TWO_OPEN = [
    ...ONE_OPEN,
    { action_index: '2309', label: 'Rain tomorrow?', tick: 'XCHAIN', feed_status: 'open' },
];

async function mount(props = {}, data = {}) {
    await domAct(async () => {
        render(
            <MessagingProvider shell="web" messaging={messagingFor({ markets: ONE_OPEN, ...data })}>
                <OracleRecord chainId={CHAIN} address={ORACLE} onBack={() => {}} {...props} />
            </MessagingProvider>,
        );
        for (let i = 0; i < 16; i += 1) await Promise.resolve();
    });
}

afterEach(() => {
    cleanup();
    copyText.mockClear();
});

describe('OracleRecord action list', () => {
    it('opens on the Actions tab, first and selected, holding the action list', async () => {
        await mount({ onOpenMarket: vi.fn() });
        const tabs = within(screen.getByRole('tablist', { name: 'Oracle sections' })).getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Markets', 'Details']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        // The panel is found by the id its tab names.
        const panel = document.getElementById(tabs[0].getAttribute('aria-controls'));
        expect(panel.getAttribute('role')).toBe('tabpanel');
        expect(panel.getAttribute('aria-labelledby')).toBe(tabs[0].id);
        const list = within(panel).getByRole('list', { name: 'Oracle actions' });
        expect(list.tagName).toBe('UL');
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    });

    it('Place bet opens the one market taking bets', async () => {
        const onOpenMarket = vi.fn();
        await mount({ onOpenMarket });
        fireEvent.click(screen.getByRole('button', { name: /^Buy a position/ }));
        expect(onOpenMarket).toHaveBeenCalledWith(CHAIN, '2308');
    });

    it('Place bet with several open markets moves to Markets, narrowed to the open ones', async () => {
        const onOpenMarket = vi.fn();
        await mount({ onOpenMarket }, {
            markets: [...TWO_OPEN, { action_index: '2310', label: 'Settled one', tick: 'XCHAIN', feed_status: 'resolved' }],
        });
        await domAct(async () => { fireEvent.click(screen.getByRole('button', { name: /^Buy a position/ })); });
        expect(onOpenMarket).not.toHaveBeenCalled();
        expect(screen.getByRole('tab', { name: /Markets/ }).getAttribute('aria-selected')).toBe('true');
        const list = screen.getByRole('list', { name: 'Oracle markets' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
        expect(list.textContent).not.toMatch(/Settled one/);
    });

    it('Copy address copies the oracle address and says so in the row', async () => {
        await mount({ onOpenMarket: vi.fn() });
        await domAct(async () => { fireEvent.click(screen.getByRole('button', { name: /^Copy address/ })); });
        expect(copyText).toHaveBeenCalledWith(ORACLE);
        expect(screen.getByRole('button', { name: /^Copied/ })).toBeTruthy();
    });

    it('Resolve shows to the oracle itself and opens the pending markets', async () => {
        const onResolvePending = vi.fn();
        await mount({ walletId: 'w', onResolvePending, onOpenMarket: vi.fn() }, { closed: 2, own: true });
        fireEvent.click(screen.getByRole('button', { name: /^Resolve \(2\)/ }));
        expect(onResolvePending).toHaveBeenCalledTimes(1);
    });

    it('keeps Resolve off for anyone else and carries no danger row', async () => {
        await mount({ walletId: 'w', onResolvePending: vi.fn(), onOpenMarket: vi.fn() }, { closed: 2, own: false });
        expect(screen.queryByRole('button', { name: /^Resolve/ })).toBeNull();
        expect(screen.getByRole('list', { name: 'Oracle actions' }).querySelector('[data-tone="danger"]')).toBeNull();
    });
});
