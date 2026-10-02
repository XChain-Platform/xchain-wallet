// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListPickerScreen } from '../../../packages/core/src/shared/components/ListPickerScreen.jsx';
import { sharedBlockPickState } from '../../../packages/core/src/shared/utils/sharedBlockPick.js';

describe('list labels at picker sites', () => {
    it('labels named and unnamed shared block picks', () => {
        expect(sharedBlockPickState({
            actionIndex: 42,
            homeChain: 'litecoin',
            homeListIndex: 7,
            memberCount: 12,
            name: 'Treasury wallets',
        })?.label).toBe('Treasury wallets (List #42) (shared from litecoin list #7)');

        expect(sharedBlockPickState({
            actionIndex: 43,
            homeChain: 'bitcoin',
            homeListIndex: 8,
        })?.label).toBe('List #43 (shared from bitcoin list #8)');
    });

    it('neutralises control characters in shared block pick names', () => {
        expect(sharedBlockPickState({
            actionIndex: 44,
            homeChain: 'dogecoin',
            homeListIndex: 9,
            name: 'Treasury\u202Eevil',
        })?.label).toBe('Treasury␦evil (List #44) (shared from dogecoin list #9)');
    });

    it('labels named and unnamed picker rows and keeps status after the title', async () => {
        const messaging = {
            getListsForSource: vi.fn().mockResolvedValue([
                { action_index: '51', type: '1', block_index: 3, status: 'pending', name: 'Official tokens' },
                { action_index: '52', type: '2', block_index: 2, status: 'valid' },
                { action_index: '53', type: '3', block_index: 1, status: 'valid', name: 'Treasury\u202Eevil' },
            ]),
            getListByActionIndex: vi.fn().mockResolvedValue({ list: [] }),
        };

        render(
            <ListPickerScreen
                variant="full"
                messaging={messaging}
                chainId="bitcoin"
                addresses={[{ address: 'owner' }]}
                onSelect={() => {}}
                onBack={() => {}}
            />,
        );

        expect(await screen.findByText('Official tokens (List #51) (pending)')).toBeTruthy();
        expect(screen.getByText('Address list #52')).toBeTruthy();
        expect(screen.getByText('Treasury␦evil (List #53)')).toBeTruthy();
    });
});
