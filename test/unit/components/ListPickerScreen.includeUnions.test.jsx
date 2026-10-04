// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ListPickerScreen } from '@xchain-wallet/core/shared/components/ListPickerScreen.jsx';

const ROWS = [
    { action_index: '10', type: '2', block_index: 5 },
    { action_index: '20', type: '3', block_index: 4 },
    { action_index: '30', type: '3', block_index: 3 },
    { action_index: '40', type: '3', block_index: 2 },
];

const DETAILS = {
    20: { type: '3', list: ['11'] },
    30: { type: '3', list: ['12'] },
    40: { type: '3', list: ['13'] },
    11: { type: '2', list: ['a', 'b'] },
    12: { type: '1', list: ['X'] },
};

function makeMessaging() {
    return {
        getListsForSource: vi.fn().mockResolvedValue(ROWS),
        getListByActionIndex: vi.fn(async ({ actionIndex }) => {
            if (actionIndex === '13') throw new Error('read failed');
            return DETAILS[actionIndex] || { list: [] };
        }),
    };
}

function renderPicker(extra = {}, onSelect = vi.fn()) {
    render(
        <ListPickerScreen
            variant="full"
            messaging={makeMessaging()}
            chainId="c"
            addresses={[{ address: 'addr1' }]}
            filterType="2"
            onSelect={onSelect}
            onBack={() => {}}
            {...extra}
        />,
    );
    return onSelect;
}

describe('ListPickerScreen includeUnions', () => {
    it('never shows a union without the prop', async () => {
        renderPicker();
        await waitFor(() => expect(screen.getByText(/Address list #10/)).toBeTruthy());
        expect(screen.queryByText(/Union list/)).toBeNull();
    });

    it('lists only a union whose first member matches filterType', async () => {
        const onSelect = renderPicker({ includeUnions: true });
        await waitFor(() => expect(screen.getByText(/Union list #20/)).toBeTruthy());
        expect(screen.queryByText(/list #30/)).toBeNull();
        expect(screen.queryByText(/list #40/)).toBeNull();
        fireEvent.click(screen.getByText(/Union list #20/).closest('button'));
        expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ actionIndex: '20', type: '3' }));
    });
});
