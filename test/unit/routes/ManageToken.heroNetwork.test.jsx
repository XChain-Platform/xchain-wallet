// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Manage token header names the network through the coin icon and its
// chain overlay only (operator ruling); no chain name sits beside it as text.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ManageToken } from '../../../packages/core/src/shared/routes/ManageToken.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { registry as registryLib } from '@xchain-wallet/core';

const chainRegistry = registryLib.defaultRegistry();

const CHAIN = 'bitcoin-regtest';
const OWNER = 'bcrt1qownerownerownerownerownerowner000';

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function mount(tokenInfo = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({ creator: OWNER, divisibility: 8, ...tokenInfo }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: OWNER }] }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getHistoryForToken: vi.fn().mockResolvedValue({ data: [] }),
        getDispensersForToken: vi.fn().mockResolvedValue({ data: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ManageToken walletId="wallet" chainId={CHAIN} tick="MANAGEPROBE" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('ManageToken hero', () => {
    it('leaves the network to the icon and shows no chain name as text', async () => {
        mount();
        const hero = await screen.findByRole('region', { name: 'Token identity' });
        await within(hero).findByText('Owned by');
        const chainName = chainRegistry.get(CHAIN).displayName;

        expect(within(hero).getByRole('img', { name: new RegExp(chainName) })).toBeTruthy();
        expect(within(hero).queryByText(chainName)).toBeNull();
        expect(hero.textContent).not.toContain('·');
    });
});
