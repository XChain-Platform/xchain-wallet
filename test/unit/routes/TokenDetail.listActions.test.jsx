// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The token page's Actions list holds Stop watching, Pin to top / Unpin and
// Hide / Unhide, which edit the same watched, pinned and hidden lists the
// Settings, Appearance, Tokens page shows.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
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
const KEY = `${CHAIN}:LISTPROBE`;

function renderDetail(settingsIn = {}) {
    let settings = { walletMode: 'full', watchedTokens: [], pinnedTokens: [], hiddenTokens: [], ...settingsIn };
    const messaging = {
        getSettings: vi.fn(() => Promise.resolve(settings)),
        updateSettings: vi.fn((patch) => {
            settings = { ...settings, ...patch };
            return Promise.resolve(settings);
        }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'x', divisibility: 8 }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ address: 'bcrt1qmine' }] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenDetail, {
            walletId: 'w1',
            chainId: CHAIN,
            tick: 'LISTPROBE',
            kind: 'token',
            quantity: '100',
            onBack() {},
            onSend: vi.fn(),
            onReceive: vi.fn(),
        }),
    ));
    return messaging;
}

async function actionsList() {
    return within(await screen.findByRole('list', { name: 'Actions for LISTPROBE' }));
}

describe('TokenDetail watched, pinned and hidden actions', () => {
    it('offers Pin to top and Hide, and no Stop watching for a token that is not watched', async () => {
        renderDetail();
        const list = await actionsList();
        await list.findByRole('button', { name: /^Pin to top\b/ });
        expect(list.getByRole('button', { name: /^Hide\b/ })).toBeInTheDocument();
        expect(list.queryByRole('button', { name: /^Stop watching\b/ })).toBeNull();
    });

    it('Stop watching removes the token from the watched list', async () => {
        const messaging = renderDetail({ watchedTokens: [KEY, 'bitcoin-regtest:OTHER'] });
        const list = await actionsList();
        fireEvent.click(await list.findByRole('button', { name: /^Stop watching\b/ }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ watchedTokens: ['bitcoin-regtest:OTHER'] }));
    });

    it('Pin to top adds the token to the wallet pinned list, and Unpin removes it', async () => {
        const messaging = renderDetail();
        let list = await actionsList();
        fireEvent.click(await list.findByRole('button', { name: /^Pin to top\b/ }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({
            pinnedTokens: [KEY],
            pinnedTokensByWallet: { w1: [KEY] },
        }));
        list = await actionsList();
        fireEvent.click(await list.findByRole('button', { name: /^Unpin\b/ }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenLastCalledWith({
            pinnedTokens: [],
            pinnedTokensByWallet: { w1: [] },
        }));
    });

    it('Hide adds the token to the hidden list, and Unhide removes it', async () => {
        const messaging = renderDetail();
        let list = await actionsList();
        fireEvent.click(await list.findByRole('button', { name: /^Hide\b/ }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenCalledWith({ hiddenTokens: [KEY] }));
        list = await actionsList();
        fireEvent.click(await list.findByRole('button', { name: /^Unhide\b/ }));
        await waitFor(() => expect(messaging.updateSettings).toHaveBeenLastCalledWith({ hiddenTokens: [] }));
    });
});
