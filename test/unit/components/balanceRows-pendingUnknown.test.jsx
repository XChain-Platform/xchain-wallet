// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A coin balance read while the tracker's mempool view was still converging
// carries `pendingUnknown`. Home keeps the confirmed figure and says the pending
// side is not fully known; the marker never turns the row into Unavailable and
// never folds it into the small balances.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    buildBalanceRows,
    BalanceList,
    isSmallBalanceRow,
} from '../../../packages/core/src/shared/components/BalanceList.jsx';
import { registry as registryLib } from '../../../packages/core/src/index.js';

const chainRegistry = registryLib.defaultRegistry();
const CHAIN = 'bitcoin-mainnet';

const entry = (address, native) => ({ address, balances: { native, tokens: [] } });
const coin = (sats, extra = {}) => ({ tick: 'BTC', quantity: String(sats), divisibility: 8, ...extra });

describe('buildBalanceRows: pendingUnknown', () => {
    it('one unknown address marks the aggregated coin row and keeps the summed amount', () => {
        const rows = buildBalanceRows({
            [CHAIN]: [
                entry('bc1qa', coin(100000000, { pendingUnknown: true })),
                entry('bc1qb', coin(50000000)),
            ],
        }, chainRegistry);
        expect(rows).toHaveLength(1);
        expect(rows[0].pendingUnknown).toBe(true);
        expect(rows[0].quantity).toBe('150000000');
        expect(rows[0].unavailable).toBeUndefined();
    });

    it('no marker on any address leaves the row unmarked', () => {
        const rows = buildBalanceRows({ [CHAIN]: [entry('bc1qa', coin(100000000))] }, chainRegistry);
        expect(rows[0]).not.toHaveProperty('pendingUnknown');
    });

    it('a zero row with the marker is not folded into the small balances', () => {
        const [marked] = buildBalanceRows({ [CHAIN]: [entry('bc1qa', coin(0, { pendingUnknown: true }))] }, chainRegistry);
        const [plain] = buildBalanceRows({ [CHAIN]: [entry('bc1qa', coin(0))] }, chainRegistry);
        expect(isSmallBalanceRow(plain)).toBe(true);
        expect(isSmallBalanceRow(marked)).toBe(false);
    });
});

describe('BalanceList: pendingUnknown note', () => {
    it('shows the confirmed amount and the note', () => {
        const rows = buildBalanceRows({
            [CHAIN]: [entry('bc1qa', coin(100000000, { pendingUnknown: true }))],
        }, chainRegistry);
        render(<BalanceList rows={rows} />);
        expect(screen.getByText('1.00000000')).toBeTruthy();
        expect(screen.getByTestId('balance-pending-unknown')).toHaveTextContent('Pending not fully known yet');
        expect(screen.queryByText(/Unavailable/)).toBeNull();
    });

    it('shows no note without the marker', () => {
        const rows = buildBalanceRows({ [CHAIN]: [entry('bc1qa', coin(100000000))] }, chainRegistry);
        render(<BalanceList rows={rows} />);
        expect(screen.queryByTestId('balance-pending-unknown')).toBeNull();
    });
});
