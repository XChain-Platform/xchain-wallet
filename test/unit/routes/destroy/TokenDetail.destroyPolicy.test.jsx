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

// manageActions is how every shell mounts the page (web, desktop and
// extension App.jsx pass the issuer handlers for any token), so the Destroy a
// user reaches is the Supply group row, and the registry tile is left out.
function mount({ chainId, tick, issuer = false }) {
    const onDestroy = vi.fn();
    const manageActions = issuer ? { onDestroy, onMint: vi.fn(), onLock: vi.fn(), onMintSettings: vi.fn(), onIssueSubtoken: vi.fn() } : null;
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
                manageActions={manageActions}
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

describe('TokenDetail destroy policy, Supply group (the page as the shells render it)', () => {
    const supplyDestroy = async () => {
        await waitFor(() => expect(document.querySelector('[data-owner-group="supply"] [data-action-id="destroy"]')).not.toBeNull());
        return document.querySelector('[data-owner-group="supply"] [data-action-id="destroy"]');
    };

    it.each([
        ['litecoin-regtest', 'XCHAIN', 'XCHAIN cannot be destroyed on this network. Use Move to send it back to Bitcoin instead.'],
        ['dogecoin-regtest', 'XCHAIN', 'XCHAIN cannot be destroyed on this network. Use Move to send it back to Bitcoin instead.'],
        ['dogecoin-regtest', 'BTC.PEPE', 'PEPE is a bridged copy. Use Move to send it back to BTC instead.'],
    ])('locks the Supply Destroy row for %s %s with the policy sentence', async (chainId, tick, reason) => {
        const onDestroy = mount({ chainId, tick, issuer: true });
        const row = await supplyDestroy();
        await waitFor(() => expect(row).toHaveAttribute('aria-disabled', 'true'));
        // The policy sentence is the row's line in place of its description,
        // and the row's accessible description.
        const describedBy = row.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        expect(document.getElementById(describedBy)).toHaveTextContent(reason);
        expect(within(row).getByText(reason)).toBeInTheDocument();
        // The only Destroy on the page is this row: the registry tile is not drawn.
        expect(screen.getAllByRole('button', { name: /^Destroy\b/ })).toHaveLength(1);
        fireEvent.click(row);
        expect(onDestroy).not.toHaveBeenCalled();
        // The rest of the Supply group stays open.
        const mint = document.querySelector('[data-owner-group="supply"] [data-action-id="mint"]');
        expect(mint).not.toHaveAttribute('aria-disabled');
    });

    it('keeps the Supply Destroy row open for XCHAIN on Bitcoin and for a native token', async () => {
        for (const [chainId, tick] of [['bitcoin-regtest', 'XCHAIN'], ['litecoin-regtest', 'MYTOKEN']]) {
            const onDestroy = mount({ chainId, tick, issuer: true });
            const row = await supplyDestroy();
            await waitFor(() => expect(row).not.toHaveAttribute('aria-disabled'));
            fireEvent.click(row);
            expect(onDestroy).toHaveBeenCalledTimes(1);
            cleanup();
            __clearTokenInfoCache();
        }
    });
});
