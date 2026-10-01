// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { ListDetail } from '../../../packages/core/src/shared/routes/ListDetail.jsx';

function renderList(messaging, chainId = 'bitcoin-testnet') {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListDetail
                chainId={chainId}
                actionIndex="77"
                onBack={() => {}}
                onFork={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.clearAllMocks();
});

describe('ListDetail coin-qualified ticker members', () => {
    it('resolves a DOGE tick id on the matching network and renders its canonical name', async () => {
        const messaging = {
            getListByActionIndex: vi.fn().mockResolvedValue({
                type: '1', status: 'valid', source: 'owner', list: ['DOGE:^42'],
            }),
            getTokenInfo: vi.fn().mockResolvedValue({ canonicalTick: 'DOGECOIN' }),
        };

        renderList(messaging);

        expect(await screen.findByText('DOGECOIN')).toBeTruthy();
        expect(screen.getByText('DOGE')).toBeTruthy();
        expect(messaging.getTokenInfo).toHaveBeenCalledWith({
            chainId: 'dogecoin-testnet',
            tick: '^42',
        });
    });

    it('shows the id fallback when a qualified lookup fails', async () => {
        let rejectLookup;
        const messaging = {
            getListByActionIndex: vi.fn().mockResolvedValue({
                type: '1', status: 'valid', source: 'owner', list: ['LTC:^19'],
            }),
            getTokenInfo: vi.fn(() => new Promise((_resolve, reject) => { rejectLookup = reject; })),
        };

        renderList(messaging, 'bitcoin-mainnet');

        expect(await screen.findByText('id 19')).toBeTruthy();
        expect(screen.getByText('LTC')).toBeTruthy();
        expect(messaging.getTokenInfo).toHaveBeenCalledWith({
            chainId: 'litecoin-mainnet',
            tick: '^19',
        });
        await act(async () => {
            rejectLookup(new Error('offline'));
            await Promise.resolve();
        });
        expect(screen.getByText('id 19')).toBeTruthy();
    });

    it('keeps bare and future-root members written as one code value', async () => {
        const messaging = {
            getListByActionIndex: vi.fn().mockResolvedValue({
                type: '1', status: 'valid', source: 'owner', list: ['PEPE', 'FUTURE:^8'],
            }),
            getTokenInfo: vi.fn(),
        };

        renderList(messaging);

        const pepe = await screen.findByText('PEPE');
        const future = screen.getByText('FUTURE:^8');
        expect(pepe.tagName).toBe('CODE');
        expect(future.tagName).toBe('CODE');
        expect(within(future.closest('li')).queryByText('FUTURE')).toBeNull();
        expect(messaging.getTokenInfo).not.toHaveBeenCalled();
    });
});
