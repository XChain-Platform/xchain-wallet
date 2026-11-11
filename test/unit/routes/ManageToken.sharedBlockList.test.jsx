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

async function renderManage({ isOwner = true, tokenInfo = {}, ...handlers } = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({
            creator: ISSUER,
            description: MARKER,
            ...tokenInfo,
        }),
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

async function sharedBlockListRow() {
    const row = await screen.findByRole('button', { name: 'Shared block list' });
    expect(row).toHaveAttribute('aria-busy', 'false');
    return row;
}

describe('ManageToken shared block list action', () => {
    it('keeps a locked description visible but refuses the action', async () => {
        const onUpdateDescription = vi.fn();
        await renderManage({
            tokenInfo: { locks: { description: true } },
            onUpdateDescription,
        });
        const description = await screen.findByRole('button', { name: 'Description' });
        expect(description).toBeDisabled();
        expect(description).toHaveAttribute(
            'title',
            "The description is permanently locked and can't be updated.",
        );
        fireEvent.click(description);
        expect(onUpdateDescription).not.toHaveBeenCalled();
    });

    it('calls the dedicated handler when passed', async () => {
        const onUseSharedBlockList = vi.fn();
        await renderManage({ onUseSharedBlockList });

        fireEvent.click(await sharedBlockListRow());

        expect(onUseSharedBlockList).toHaveBeenCalledTimes(1);
    });

    it('falls back to the access-lists handler', async () => {
        const onAccessLists = vi.fn();
        await renderManage({ onAccessLists });

        fireEvent.click(await sharedBlockListRow());

        expect(onAccessLists).toHaveBeenCalledTimes(1);
    });

    it('is disabled when neither handler is passed', async () => {
        await renderManage();
        expect(await screen.findByRole('button', { name: 'Shared block list' })).toBeDisabled();
    });

    it('is disabled for a non-owner without showing an owner warning', async () => {
        await renderManage({ isOwner: false, onUseSharedBlockList: vi.fn() });
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Shared block list' })).toBeDisabled();
        });
        expect(screen.queryByText(/hold the token's issuer address/i)).toBeNull();
    });
});
