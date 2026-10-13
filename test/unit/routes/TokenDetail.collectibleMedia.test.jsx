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

function renderDetail(tokenInfo = {}) {
    const messaging = {
        getTokenInfo: vi.fn().mockResolvedValue({
            creator: 'bcrt1qcreator',
            images: [
                { type: 'icon', url: ICON_URL },
                { type: 'large', url: MEDIA_URL, name: MEDIA_NAME },
                { type: 'large', url: UNNAMED_MEDIA_URL },
            ],
            ...tokenInfo,
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
    it('reserves monograms while token artwork is missing, slow, or broken', async () => {
        renderDetail();

        const initialFallbacks = screen.getAllByText('CO');
        expect(initialFallbacks).toHaveLength(2);

        await waitFor(() => expect(document.querySelectorAll(`img[src="${ICON_URL}"]`)).toHaveLength(2));
        const images = [...document.querySelectorAll(`img[src="${ICON_URL}"]`)];
        expect(images.every((image) => image.style.visibility === 'hidden')).toBe(true);
        expect(initialFallbacks.every((fallback) => images.some((image) => image.parentElement === fallback)))
            .toBe(true);

        for (const image of images) fireEvent.load(image);
        expect(images.every((image) => image.style.visibility === 'visible')).toBe(true);

        for (const image of images) {
            fireEvent.error(image);
        }
        expect(document.querySelectorAll(`img[src="${ICON_URL}"]`)).toHaveLength(0);
        expect(screen.getAllByText('CO')).toHaveLength(2);

        fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
        const media = await screen.findByRole('img', { name: MEDIA_NAME });
        fireEvent.error(media);

        expect(screen.getByRole('img', { name: `${MEDIA_NAME} unavailable` })).toBeTruthy();
        expect(screen.getByText('Image unavailable')).toBeTruthy();
        expect(screen.getByText(MEDIA_NAME)).toBeTruthy();
    });

    it('keeps fixed artwork slots when metadata has no logo', async () => {
        renderDetail({ images: [], imageUrl: null });

        await waitFor(() => expect(screen.getAllByText('CO')).toHaveLength(2));
        expect(document.querySelector(`img[src="${ICON_URL}"]`)).toBeNull();
        for (const fallback of screen.getAllByText('CO')) {
            expect(fallback).toHaveStyle({ position: 'relative', overflow: 'hidden' });
        }
    });

    it('names media links by the action even when an image has no title', async () => {
        renderDetail();

        fireEvent.click(screen.getByRole('tab', { name: 'Media' }));

        expect(await screen.findByRole('link', { name: 'Open token image' }))
            .toHaveAttribute('href', UNNAMED_MEDIA_URL);
        expect(screen.getByRole('link', { name: `Open image ${MEDIA_NAME}` }))
            .toHaveAttribute('href', MEDIA_URL);
    });

    it('links only HTTP(S) destinations from token metadata', async () => {
        renderDetail({
            website: 'javascript:alert(1)',
            websites: [
                'https://issuer.example/',
                'javascript:alert(1)',
                'data:text/html,<script>alert(1)</script>',
            ],
            socials: [
                { platform: 'url', host: 'safe.example', url: 'http://safe.example/profile' },
                { platform: 'url', host: 'unsafe.example', url: 'data:text/html,unsafe' },
            ],
            contacts: [
                { type: 'url', value: 'https://contact.example/' },
                { type: 'url', value: 'javascript:alert(1)' },
            ],
            files: [
                { url: 'https://files.example/readme.txt', name: 'Safe file', type: 'text/plain' },
                { url: 'data:text/html,unsafe', name: 'Unsafe file', type: 'text/html' },
            ],
        });

        fireEvent.click(screen.getByRole('tab', { name: 'About' }));
        expect(await screen.findByRole('link', { name: 'Website' }))
            .toHaveAttribute('href', 'https://issuer.example/');
        expect(screen.getByRole('link', { name: /safe\.example/ }))
            .toHaveAttribute('href', 'http://safe.example/profile');
        expect(screen.getByRole('link', { name: /https:\/\/contact\.example/ }))
            .toHaveAttribute('href', 'https://contact.example/');
        expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument();
        expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
        expect(document.querySelector('a[href^="data:"]')).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: 'Media' }));
        fireEvent.click(await screen.findByRole('tab', { name: 'File' }));
        expect(await screen.findByRole('link', { name: /Safe file/ }))
            .toHaveAttribute('href', 'https://files.example/readme.txt');
        expect(screen.queryByText('Unsafe file')).toBeNull();

        for (const link of document.querySelectorAll('a[target="_blank"]')) {
            expect(link.getAttribute('rel')).toContain('noopener');
            expect(link.getAttribute('rel')).toContain('noreferrer');
        }
    });
});
