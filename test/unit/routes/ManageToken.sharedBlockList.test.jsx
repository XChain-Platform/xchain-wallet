// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

const CHAIN = 'bitcoin-regtest';
const ISSUER = 'bcrt1qissuer';
const MARKER = 'Shared list token';

async function renderManage({ isOwner = true, ...handlers } = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({ creator: ISSUER, description: MARKER }),
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{ address: isOwner ? ISSUER : 'bcrt1qsomeoneelse' }],
        }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getHistoryForToken: vi.fn().mockResolvedValue({ data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(ManageToken, {
                walletId: 'w1',
                chainId: CHAIN,
                tick: 'SHAREDLIST',
                onBack() {},
                onMint() {},
                onCreateDispenser() {},
                onAirdrop() {},
                onDestroy() {},
                ...handlers,
            }),
        ),
    );
    await screen.findByText(MARKER);
    return messaging;
}

function sharedBlockListRow() {
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    return screen.getByRole('menuitem', { name: 'Use a shared block list' });
}

describe('ManageToken shared block list action', () => {
    it('calls the dedicated handler when passed', async () => {
        const onUseSharedBlockList = vi.fn();
        await renderManage({ onUseSharedBlockList });

        fireEvent.click(sharedBlockListRow());

        expect(onUseSharedBlockList).toHaveBeenCalledTimes(1);
    });

    it('falls back to the access-lists handler', async () => {
        const onAccessLists = vi.fn();
        await renderManage({ onAccessLists });

        fireEvent.click(sharedBlockListRow());

        expect(onAccessLists).toHaveBeenCalledTimes(1);
    });

    it('is absent when neither handler is passed', async () => {
        await renderManage();
        fireEvent.click(screen.getByRole('button', { name: 'More' }));

        expect(screen.queryByRole('menuitem', { name: 'Use a shared block list' })).toBeNull();
    });

    it('is absent for a non-owner', async () => {
        await renderManage({ isOwner: false, onUseSharedBlockList: vi.fn() });
        await waitFor(() => {
            expect(screen.getByText(/hold the token's issuer address/i)).toBeInTheDocument();
        });
        const moreButton = screen.queryByRole('button', { name: 'More' });
        if (moreButton) fireEvent.click(moreButton);

        expect(screen.queryByText('Use a shared block list')).toBeNull();
    });
});
