// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Member counts for hundreds of lists used to land one state update per list,
// re-rendering every row each time. The picker batches them, so a long list
// of lists commits a handful of times and never reads more than a few at once.

import React, { Profiler } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ListPickerScreen } from '@xchain-wallet/core/shared/components/ListPickerScreen.jsx';

describe('ListPickerScreen member counts at scale', () => {
    it('commits in batches and bounds concurrent reads', async () => {
        const rows = Array.from({ length: 400 }, (_, i) => ({
            action_index: String(i + 1), type: '2', block_index: i,
        }));
        let inFlight = 0;
        let peak = 0;
        const messaging = {
            getListsForSource: vi.fn().mockResolvedValue(rows),
            getListByActionIndex: vi.fn(async () => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                // A real read takes a network round trip, so each answer lands in its own task.
                await new Promise((resolve) => setTimeout(resolve, 0));
                inFlight -= 1;
                return { type: '2', list: Array.from({ length: 1000 }, (_, i) => `addr${i}`) };
            }),
        };
        let commits = 0;
        render(
            <Profiler id="picker" onRender={() => { commits += 1; }}>
                <ListPickerScreen
                    variant="full"
                    messaging={messaging}
                    chainId="c"
                    addresses={[{ address: 'a' }]}
                    filterType="2"
                    onSelect={() => {}}
                    onBack={() => {}}
                />
            </Profiler>,
        );
        await screen.findByText(/Address list #400/);
        await waitFor(() => expect(screen.queryAllByText(/counting…/)).toHaveLength(0), { timeout: 20000 });

        expect(screen.getAllByText('1,000 members').length).toBe(400);
        expect(messaging.getListByActionIndex).toHaveBeenCalledTimes(400);
        expect(peak).toBeLessThanOrEqual(4);
        expect(commits).toBeLessThan(60);
    }, 30000);
});
