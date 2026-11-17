// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Token metadata is issuer-controlled text. The About panel shows it as plain
// text, links only to real http(s) targets and names the host a link opens.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';

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

function renderInfo(tokenInfo) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: 'bcrt1qx', ...tokenInfo }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail walletId="w1" chainId={CHAIN} tick="HOSTILE" kind="token" quantity="1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

const hrefs = () => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));

async function openDetails() {
    fireEvent.click(await screen.findByRole('tab', { name: /Details/ }));
}

describe('TokenDetail issuer metadata', () => {
    it('names the host a website link opens, so a look-alike domain is visible', async () => {
        renderInfo({ websites: ['https://xchain.io.evil.example/claim', 'https://xn--xchan-9ua.io/'] });
        await openDetails();
        const links = await screen.findAllByRole('link', { name: /Website/ });
        expect(links).toHaveLength(2);
        expect(links[0].textContent).toContain('https://xchain.io.evil.example/claim');
        expect(links[1].textContent).toContain('https://xn--xchan-9ua.io/');
    });

    it('links only real http(s) targets', async () => {
        renderInfo({
            websites: ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'https://ok.example/'],
            socials: [{ platform: 'url', host: 'x', url: 'javascript:alert(2)' }],
            contacts: [
                { type: 'url', value: 'javascript:alert(3)' },
                { type: 'url', value: 'vbscript:msgbox(1)' },
                { type: 'url', value: 'https://contact.example/' },
            ],
        });
        await openDetails();
        await screen.findByRole('link', { name: /Website/ });
        const found = hrefs();
        expect(found.filter((h) => /^(javascript|data|vbscript):/i.test(h))).toEqual([]);
        expect(found).toContain('https://ok.example/');
        expect(found).toContain('https://contact.example/');
    });

    it('shows every email value as plain text', async () => {
        renderInfo({
            contacts: [
                { type: 'email', value: 'help@issuer.example' },
                { type: 'email', value: 'help@issuer.example?bcc=thief@evil.example&body=send+funds' },
                { type: 'email', value: 'not an address' },
            ],
        });
        await openDetails();
        await screen.findByText('help@issuer.example');
        expect(hrefs().filter((h) => h.startsWith('mailto:'))).toEqual([]);
        expect(screen.getByText(/bcc=thief@evil\.example/)).toBeTruthy();
    });

    it('shows a description as inert text at any length', async () => {
        const markup = '<img src=x onerror=alert(1)><script>alert(2)</script> ‮evil‬ ';
        const description = markup + 'long text '.repeat(1100);
        renderInfo({ description });
        await openDetails();
        await screen.findByLabelText('Token information profile');
        const body = document.querySelector('[class*="profileDescription"]');
        expect(body).not.toBeNull();
        expect(body.textContent.length).toBeGreaterThan(10_000);
        expect(document.querySelector('script')).toBeNull();
        expect(document.querySelector('img[src="x"]')).toBeNull();
    });

    it('shows profile links for a token whose only supplemental metadata is a websites list', async () => {
        renderInfo({ websites: ['https://only-site.example/'] });
        await openDetails();
        expect(await screen.findByRole('link', { name: 'Website: https://only-site.example/' })).toBeTruthy();
        expect(screen.queryByText('No additional information')).toBeNull();
    });

    it('keeps files out of the profile when they are the only supplemental metadata', async () => {
        renderInfo({ files: [{ url: 'https://files.example/a.txt', name: 'A', type: 'text/plain' }] });
        await openDetails();
        expect(await screen.findByLabelText('Token information profile')).toBeTruthy();
        expect(screen.queryByText('Links')).toBeNull();
        fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
        expect(await screen.findByRole('link', { name: 'Open A' })).toBeTruthy();
    });

    it('does not load a script-scheme icon', async () => {
        renderInfo({ images: [{ type: 'icon', url: 'javascript:alert(1)' }], description: 'plain' });
        await openDetails();
        await screen.findByText('plain');
        const sources = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
        expect(sources.filter((src) => /^javascript:/i.test(src))).toEqual([]);
    });
});

describe('TokenDetail when token information cannot be read', () => {
    it('ends the loading state with one notice that the details could not be loaded', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getTokenInfo: vi.fn().mockRejectedValue(new Error('offline')),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail walletId="w1" chainId={CHAIN} tick="OFFLINE" kind="token" quantity="1" onBack={() => {}} />
            </MessagingProvider>,
        );
        expect(await screen.findAllByText('Token details could not be loaded from the explorer. Try again in a moment.')).toHaveLength(1);
        expect(screen.queryByText('No additional information')).toBeNull();
        expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    });
});

describe('TokenDetail market panel when token information cannot be read', () => {
    it('says market data is unavailable instead of loading forever', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            getTokenInfo: vi.fn().mockRejectedValue(new Error('offline')),
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
            getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
            listGatedContent: vi.fn().mockResolvedValue([]),
            getSupplyHistory: vi.fn().mockResolvedValue([]),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <TokenDetail walletId="w1" chainId="bitcoin-mainnet" tick="OFFLINE2" kind="token" quantity="1" onBack={() => {}} />
            </MessagingProvider>,
        );
        // Market figures are rows in the Details tab; once the read has failed the price row must
        // not sit in its loading state (the failure notice above says the details are unavailable).
        await screen.findByText('Token details could not be loaded from the explorer. Try again in a moment.');
        await openDetails();
        await screen.findByText('Price');
        expect(screen.queryByLabelText('Loading')).toBeNull();
    });
});
