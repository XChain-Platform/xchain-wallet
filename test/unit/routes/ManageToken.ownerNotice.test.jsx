// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Unit: the "this wallet does not hold the issuer address" notice is the first
// item of Manage token's page content, above the token identity.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const ISSUER = 'bcrt1qissuerissuerissuerissuerissuerissuer0';
const MINE = 'bcrt1qmineminemineminemineminemineminemin0';

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function mount(wallet, tokenInfo = { creator: ISSUER, divisibility: 8 }, props = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue(tokenInfo),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: wallet }] }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getHistoryForToken: vi.fn().mockResolvedValue({ data: [] }),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ManageToken walletId="wallet" chainId={CHAIN} tick="NOTICEPROBE" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

describe('ManageToken owner notice', () => {
    it('hides owner-only actions when the issuer is unknown but keeps holder actions', async () => {
        mount(MINE, { creator: null, divisibility: 8 }, {
            onMint: vi.fn(),
            onDestroy: vi.fn(),
            onPayDividend: vi.fn(),
        });

        expect(await screen.findByText(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        )).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Mint' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Destroy' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Dividends' })).toBeInTheDocument();
    });

    it('leads the page content, above the token identity', async () => {
        mount(MINE);
        const notice = await screen.findByText(/This wallet doesn.t hold the token.s issuer address/);
        const hero = await screen.findByRole('region', { name: 'Token identity' });

        expect(notice.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows no notice to the issuer', async () => {
        mount(ISSUER);
        await screen.findByRole('region', { name: 'Token identity' });
        await screen.findByText('Owned by');

        expect(screen.queryByText(/issuer address/)).toBeNull();
    });
});
