// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The explorer's market list for an oracle carries rejected creates with an
// invalid status, while the record's headline counts only markets that
// opened. The page lists and counts opened markets only, and judges whether
// its page is complete against every row the explorer lists.

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { OracleRecord } from '../../../packages/core/src/shared/routes/OracleRecord.jsx';

const CHAIN = 'bitcoin-mainnet';
const ORACLE = 'bc1qoracleoracleoracleoracleoracleoraclex';
const NOW = Math.floor(Date.now() / 1000);

afterEach(() => cleanup());

const OPENED = [
    { action_index: '3', label: 'Winter Cup final', tick: 'XCHAIN', feed_status: 'open', deadline: NOW + 86400 },
    { action_index: '2', label: 'Autumn Derby', tick: 'XCHAIN', feed_status: 'resolved', deadline: NOW - 86400 },
];
const REJECTED = { action_index: '1', label: 'Rejected create', tick: 'XCHAIN', feed_status: 'invalid', deadline: NOW };

function messagingFor(record, markets) {
    const target = {
        getAddressesByChain: () => Promise.resolve({}),
        betOracle: () => Promise.resolve({ data: [{ address: ORACLE, active_feeds: 1, counts: {}, ...record }] }),
        betFeeds: () => Promise.resolve({ data: markets.slice() }),
    };
    return new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve({});
        },
    });
}

async function openMarkets(record, markets) {
    let utils;
    await act(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messagingFor(record, markets)}>
                <OracleRecord chainId={CHAIN} address={ORACLE} onBack={() => {}} onOpenMarket={() => {}} />
            </MessagingProvider>,
        );
        for (let i = 0; i < 16; i += 1) await Promise.resolve();
    });
    await act(async () => {
        fireEvent.click(within(utils.getByRole('tablist', { name: 'Oracle sections' })).getByRole('tab', { name: 'Markets' }));
        for (let i = 0; i < 16; i += 1) await Promise.resolve();
    });
    return utils;
}

describe('OracleRecord with rejected creates in the market list', () => {
    it('lists and counts only opened markets, and calls a full page complete', async () => {
        const utils = await openMarkets({ total_feeds: 2, rejected_feeds: 1 }, [...OPENED, REJECTED]);
        const list = utils.getByRole('list', { name: 'Oracle markets' });

        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
        expect(list.textContent).not.toMatch(/Rejected create|invalid/);
        expect(utils.container.textContent).not.toMatch(/Showing the latest/);
        fireEvent.click(utils.getByRole('button', { name: 'Filter markets' }));
        expect(utils.getByRole('combobox', { name: 'Status' }).textContent).toMatch(/All statuses \(2\)/);
    });

    it('names the opened-market total when the page is cut short', async () => {
        const utils = await openMarkets({ total_feeds: 3, rejected_feeds: 1 }, [...OPENED, REJECTED]);
        expect(utils.container.textContent).toMatch(/Showing the latest 2 of this address's 3 markets\./);
    });

    it('gives no partial hint when only rejected creates are missing from the page', async () => {
        const utils = await openMarkets({ total_feeds: 2, rejected_feeds: 5 }, [...OPENED, REJECTED]);
        expect(within(utils.getByRole('list', { name: 'Oracle markets' })).getAllByRole('listitem')).toHaveLength(2);
        expect(utils.container.textContent).not.toMatch(/Showing the latest/);
    });

    it('says there are no markets yet when every listed row is a rejected create', async () => {
        const utils = await openMarkets({ total_feeds: 0, rejected_feeds: 1 }, [REJECTED]);
        expect(utils.container.textContent).toMatch(/No markets yet/);
        expect(utils.queryByRole('list', { name: 'Oracle markets' })).toBeNull();
    });
});
