// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Keep failed collectible images identifiable instead of leaving an empty
// header, balance hero, or media card.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const ICON_URL = 'https://assets.example/icon.png';
const MEDIA_URL = 'https://assets.example/large.png';
const UNNAMED_MEDIA_URL = 'https://assets.example/unnamed.png';
const MEDIA_NAME = 'An artwork title with oneuninterruptedwordthatmustnotbreakthelayout';

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
afterEach(() => { cleanup(); __clearTokenInfoCache(); });

function renderDetail() {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({
            creator: 'bcrt1qcreator',
            images: [
                { type: 'icon', url: ICON_URL },
                { type: 'large', url: MEDIA_URL, name: MEDIA_NAME },
                { type: 'large', url: UNNAMED_MEDIA_URL },
            ],
        }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail
                walletId="w1"
                chainId={CHAIN}
                tick="COLLECTIBLE"
                kind="token"
                displayName="Collectible"
                divisibility={0}
                quantity="1"
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

describe('TokenDetail collectible media', () => {
    it('shows text and ticker fallbacks when published images fail', async () => {
        renderDetail();

        await waitFor(() => expect(document.querySelectorAll(`img[src="${ICON_URL}"]`)).toHaveLength(2));
        for (const image of [...document.querySelectorAll(`img[src="${ICON_URL}"]`)]) {
            fireEvent.error(image);
        }
        expect(document.querySelectorAll(`img[src="${ICON_URL}"]`)).toHaveLength(0);
        expect(screen.getAllByText('CO').length).toBeGreaterThanOrEqual(2);

        fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
        const media = await screen.findByRole('img', { name: MEDIA_NAME });
        fireEvent.error(media);

        expect(screen.getByRole('img', { name: `${MEDIA_NAME} unavailable` })).toBeTruthy();
        expect(screen.getByText('Image unavailable')).toBeTruthy();
        expect(screen.getByText(MEDIA_NAME)).toBeTruthy();
    });

    it('names media links by the action even when an image has no title', async () => {
        renderDetail();

        fireEvent.click(screen.getByRole('tab', { name: 'Media' }));

        expect(await screen.findByRole('link', { name: 'Open token image' }))
            .toHaveAttribute('href', UNNAMED_MEDIA_URL);
        expect(screen.getByRole('link', { name: `Open image ${MEDIA_NAME}` }))
            .toHaveAttribute('href', MEDIA_URL);
    });
});
