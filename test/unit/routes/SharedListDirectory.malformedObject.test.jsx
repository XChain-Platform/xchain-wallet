// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SharedListDirectory } from '../../../packages/core/src/shared/routes/SharedListDirectory.jsx';

vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        ChainBadge: ({ descriptor }) => <span role="img" aria-label={descriptor.displayName} />,
    };
});

afterEach(cleanup);

describe('Shared list malformed rows', () => {
    it('drops a malformed object while retaining the valid neighbor', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getSharedLists: vi.fn().mockResolvedValue({
                lists: [
                    {},
                    {
                        kind: 'home',
                        home_chain: 'BTC',
                        home_list_index: 12,
                        type: 1,
                        owner: 'bc1qordinaryowner1234567890',
                        member_count: 4,
                        share_block: 102,
                        bindTarget: 1012,
                    },
                ],
                unavailable: [],
            }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SharedListDirectory
                    walletId="wallet-1"
                    chainId="bitcoin-mainnet"
                    mode="browse"
                    onSelect={() => {}}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(await screen.findByRole('listitem', { name: 'Token list 12' })).toBeTruthy();
        expect(screen.getAllByRole('listitem')).toHaveLength(1);
    });
});
