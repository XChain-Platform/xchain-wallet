// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
    // The standard hero names the token; its description is a Details row.
    await screen.findByRole('region', { name: 'SHAREDLIST' });
    return messaging;
}

// The issuer's groups are headed lists, always open (an info page has no
// collapsible sections), so this only waits for the named group to draw.
async function openGroup(title) {
    await screen.findByRole('region', { name: title });
}

async function sharedBlockListRow() {
    await openGroup('Rules and automation');
    const row = await screen.findByRole('button', { name: /^Shared block list\b/ });
    expect(row.getAttribute('data-action-id')).toBe('shared-block-list');
    return row;
}

describe('ManageToken shared block list action', () => {
    it('keeps a locked description visible but refuses the action', async () => {
        const onUpdateDescription = vi.fn();
        await renderManage({
            tokenInfo: { locks: { description: true } },
            onUpdateDescription,
        });
        await openGroup('Token page');
        const description = await screen.findByRole('button', { name: /^Description\b/ });
        expect(description).toHaveAttribute('aria-disabled', 'true');
        // The lock reason replaces the row's description line.
        expect(description.textContent).toContain("The description is permanently locked and can't be updated.");
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
        await openGroup('Rules and automation');
        expect(await screen.findByRole('button', { name: /^Shared block list\b/ })).toHaveAttribute('aria-disabled', 'true');
    });

    it('stays enabled for a non-owner and opens its form', async () => {
        const onUseSharedBlockList = vi.fn();
        await renderManage({ isOwner: false, onUseSharedBlockList });
        await openGroup('Rules and automation');
        const row = await screen.findByRole('button', { name: /^Shared block list\b/ });
        expect(row).not.toHaveAttribute('aria-disabled');
        fireEvent.click(row);
        expect(onUseSharedBlockList).toHaveBeenCalledWith({ issuer: ISSUER });
        expect(screen.queryByText(/hold the token's issuer address/i)).toBeNull();
    });
});
