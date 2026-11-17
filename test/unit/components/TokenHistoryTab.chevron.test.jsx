// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The asset page's History tab: a row that opens its detail page carries the
// standard forward chevron every tappable list row has, for a coin and for a
// token alike; a row that opens nothing carries none.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: {}, shell: 'web' }),
}));
vi.mock('../../../packages/core/src/shared/hooks/useTokenInfo.js', () => ({
    useTokenInfo: () => null,
}));

import { TokenHistoryTab } from '../../../packages/core/src/shared/components/TokenHistoryTab.jsx';
import { normalizeHistoryRow } from '../../../packages/core/src/shared/utils/historyRow.js';

const ADDRESS = 'bcrt1qchevronaddress';

function entriesFor(chainId, tick) {
    return [1, 2].map((n) => normalizeHistoryRow({
        tx_hash: `${'ab'.repeat(31)}0${n}`,
        action_index: String(n),
        action: 'SEND',
        tick,
        asset: tick,
        quantity: '100000000',
        block_index: 100 + n,
        block_time: 1_700_000_000 + n,
        source: ADDRESS,
        destination: 'bcrt1qsomeoneelse',
        status: 'valid',
    }, { chainId, address: ADDRESS })).filter(Boolean);
}

function renderTab({ chainId, tick, isNative, onSelectEntry }) {
    const entries = entriesFor(chainId, tick);
    const view = render(
        <TokenHistoryTab
            walletId="w1"
            chainId={chainId}
            tick={tick}
            isNative={isNative}
            history={{ entries, failed: false }}
            onSelectEntry={onSelectEntry}
        />,
    );
    return { ...view, count: entries.length };
}

afterEach(cleanup);

describe('asset History tab row chevron', () => {
    const cases = [
        ['a coin', { chainId: 'bitcoin-regtest', tick: 'BTC', isNative: true }],
        ['a token', { chainId: 'bitcoin-regtest', tick: 'XCHAINTEST', isNative: false }],
    ];

    for (const [name, props] of cases) {
        it(`${name}: every row that opens a detail page shows the forward chevron`, () => {
            const onSelectEntry = vi.fn();
            const { container, count } = renderTab({ ...props, onSelectEntry });
            const rows = container.querySelectorAll('[data-activity-row]');
            expect(count).toBeGreaterThan(0);
            expect(rows.length).toBe(count);
            for (const row of rows) {
                expect(row.querySelector('[data-row-chevron] svg')).not.toBeNull();
            }
            fireEvent.click(rows[0]);
            expect(onSelectEntry).toHaveBeenCalledTimes(1);
        });

        it(`${name}: rows that open nothing show no chevron`, () => {
            const { container, count } = renderTab({ ...props, onSelectEntry: undefined });
            const rows = container.querySelectorAll('[data-activity-row]');
            expect(rows.length).toBe(count);
            expect(container.querySelector('[data-row-chevron]')).toBeNull();
        });
    }
});
