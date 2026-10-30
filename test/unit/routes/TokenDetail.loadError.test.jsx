// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// When the explorer fails to answer, token detail says so once, as the first
// item below the page header, instead of claiming the issuer published
// nothing. The page stays usable, and a failed read never replaces an owner
// the page already resolved.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { tokenInfoFor } from '../../../packages/core/src/flows/tokenInfo.js';
import { writeTokenInfoCache, tokenInfoCacheKey } from '../../../packages/core/src/shared/utils/tokenInfoCache.js';

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    localStorage.removeItem('xc:activeAccount:w1');
});

let savedResizeObserver;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
    }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = globalThis.ResizeObserver || StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });

const CHAIN = 'bitcoin-regtest';
const MINE = 'bcrt1qmineminemineminemineminemineminemine0';
const NOTICE = /Token details could not be loaded from the explorer/;

function renderDetail(getTokenInfo) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo,
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: MINE }] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
    };
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenDetail, {
            walletId: 'w1',
            chainId: CHAIN,
            tick: 'LOADERR',
            kind: 'token',
            quantity: '100',
            onBack() {},
            onManageToken: vi.fn(),
        }),
    ));
}

describe('tokenInfoFor with a failing explorer', () => {
    it('marks the record instead of passing it off as an unknown token', async () => {
        const sdkRegistry = { get: () => ({ getToken: async () => { throw new Error('explorer 500'); } }) };
        const info = await tokenInfoFor({ sdkRegistry, chainId: CHAIN, tick: 'LOADERR', metadataFetchEnabled: false });
        expect(info.loadError).toBe(true);
        expect(info.creator).toBeNull();
    });

    it('leaves a record the explorer answered unmarked', async () => {
        const sdkRegistry = { get: () => ({ getToken: async () => null }) };
        const info = await tokenInfoFor({ sdkRegistry, chainId: CHAIN, tick: 'LOADERR', metadataFetchEnabled: false });
        expect(info.loadError).toBeUndefined();
    });
});

describe('TokenDetail on an explorer failure', () => {
    it('shows one error notice as the first item and no empty-information claim', async () => {
        renderDetail(vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'LOADERR', creator: null, loadError: true,
        }));
        const notice = await screen.findByText(NOTICE);
        expect(screen.getAllByText(NOTICE)).toHaveLength(1);
        expect(screen.queryByText('No additional information')).toBeNull();
        const hero = screen.getByRole('region', { name: 'LOADERR balance' });
        expect(notice.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('keeps Manage when the owner was already resolved', async () => {
        const key = tokenInfoCacheKey(CHAIN, 'LOADERR');
        writeTokenInfoCache(key, { chainId: CHAIN, tick: 'LOADERR', creator: MINE, divisibility: 8 });
        renderDetail(vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: 'LOADERR', creator: null, loadError: true,
        }));
        expect(await screen.findByText(NOTICE)).toBeTruthy();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Manage' })).toBeTruthy());
    });

    it('shows no notice when the read succeeds', async () => {
        renderDetail(vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'LOADERR', creator: MINE, divisibility: 8 }));
        await screen.findByRole('button', { name: 'Manage' });
        expect(screen.queryByText(NOTICE)).toBeNull();
    });
});
