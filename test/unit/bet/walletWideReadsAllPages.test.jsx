// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The wallet-wide bet reads (My markets, My predictions, the oracle console)
// list every row an address owns, so each one asks the host to follow the
// explorer's cursor past the first page, and says so when the walk stopped
// with rows still missing.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act as domAct } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BetFeedsList } from '../../../packages/core/src/shared/routes/BetFeedsList.jsx';
import { OracleConsole } from '../../../packages/core/src/shared/routes/OracleConsole.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const now = () => Math.floor(Date.now() / 1000);

afterEach(() => cleanup());

function market(index, status) {
    return {
        action_index: String(index),
        source: OWN,
        label: `Will market ${index} settle?`,
        outcomes: 'Yes,No',
        tick: 'XCHAIN',
        feed_status: status,
        deadline: now() - 60,
        expire_at: now() + 86400,
        pools: [{ outcome: 0, pool: '10' }, { outcome: 1, pool: '5' }],
    };
}

function walked(rows, truncated) {
    return { data: rows, total: truncated ? rows.length + 1 : rows.length, truncated };
}

function messagingFor({ feeds, bets }) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', address: OWN }] }),
        betFeeds: vi.fn().mockResolvedValue(feeds),
        bets: vi.fn().mockResolvedValue(bets ?? { data: [] }),
    };
    return new Proxy(target, {
        get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); },
    });
}

async function mount(element, messaging) {
    await domAct(async () => {
        render(<MessagingProvider shell="web" messaging={messaging}>{element}</MessagingProvider>);
        for (let i = 0; i < 16; i += 1) await Promise.resolve();
    });
}

const PARTIAL_MARKETS = /Some of your older markets could not be loaded/;

describe('wallet-wide bet reads follow every page', () => {
    it('My markets asks for every page of each creator address', async () => {
        const messaging = messagingFor({ feeds: walked([market(7, 'open')], false) });
        await mount(<BetFeedsList walletId="w" view="markets" onOpenMarket={() => {}} onBack={() => {}} />, messaging);
        await screen.findByRole('button', { name: 'Will market 7 settle?' });

        expect(messaging.betFeeds).toHaveBeenCalledWith(expect.objectContaining({
            chainId: CHAIN, query: OWN, type: 'source', allPages: true,
        }));
        expect(screen.queryByText(PARTIAL_MARKETS)).toBeNull();
    });

    it('My markets says the list may be incomplete when the walk stopped short', async () => {
        const messaging = messagingFor({ feeds: walked([market(7, 'open')], true) });
        await mount(<BetFeedsList walletId="w" view="markets" onOpenMarket={() => {}} onBack={() => {}} />, messaging);

        expect(await screen.findByText(PARTIAL_MARKETS)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Will market 7 settle?' })).toBeInTheDocument();
    });

    it('My predictions asks for every page and flags a short walk', async () => {
        const messaging = messagingFor({ feeds: { data: [] }, bets: walked([], true) });
        await mount(<BetFeedsList walletId="w" view="bets" onOpenMarket={() => {}} onBack={() => {}} />, messaging);

        expect(await screen.findByText(/Some older positions could not be loaded/)).toBeInTheDocument();
        expect(messaging.bets).toHaveBeenCalledWith(expect.objectContaining({
            query: OWN, type: 'address', allPages: true,
        }));
    });

    it('the oracle console asks for every page and flags a short walk', async () => {
        const messaging = messagingFor({ feeds: walked([{ ...market(9, 'closed'), chainId: CHAIN }], true) });
        await mount(<OracleConsole walletId="w" onBack={() => {}} />, messaging);

        expect(await screen.findByText(/Some older markets could not be loaded/)).toBeInTheDocument();
        expect(messaging.betFeeds).toHaveBeenCalledWith(expect.objectContaining({
            query: OWN, type: 'source', allPages: true,
        }));
    });
});
