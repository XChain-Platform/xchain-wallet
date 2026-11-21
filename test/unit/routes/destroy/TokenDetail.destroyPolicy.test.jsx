// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MessagingProvider } from '../../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../../packages/core/src/shared/hooks/useTokenInfo.js';

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

function mount({ chainId, tick }) {
    const onDestroy = vi.fn();
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'creator' }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [chainId]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId="wallet"
                chainId={chainId}
                tick={tick}
                kind="token"
                quantity="10"
                divisibility={0}
                onBack={() => {}}
                assetActions={{ onDestroy }}
            />
        </MessagingProvider>,
    );
    return onDestroy;
}

describe('TokenDetail destroy policy', () => {
    it.each([
        ['litecoin-regtest', 'XCHAIN', /cannot be destroyed on this network/i],
        ['dogecoin-regtest', 'BTC.PEPE', /bridged copy/i],
    ])('disables %s %s and points to Move', async (chainId, tick, reason) => {
        const onDestroy = mount({ chainId, tick });
        const button = await screen.findByRole('button', { name: /^Destroy\b/ });
        await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
        expect(within(button).getByText(reason)).toBeInTheDocument();
        fireEvent.click(button);
        expect(onDestroy).not.toHaveBeenCalled();
    });

    it('keeps XCHAIN destroy available on Bitcoin', async () => {
        const onDestroy = mount({ chainId: 'bitcoin-regtest', tick: 'XCHAIN' });
        const button = await screen.findByRole('button', { name: /^Destroy\b/ });
        await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
        fireEvent.click(button);
        expect(onDestroy).toHaveBeenCalledTimes(1);
    });
});
