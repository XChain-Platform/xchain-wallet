// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { normalizeTokenInfo, resolveMediaDataRefs, tisToMediaBundle } from '../../../packages/core/src/flows/tokenInfo.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const HASH = 'a'.repeat(64);
const TIS = {
    tick: 'MYTOKEN',
    name: '<b>Token Name</b>',
    description: '<script>literal description</script>',
    website: 'https://project.example/path',
    html: '<iframe src="https://hostile.example"></iframe>',
    owner: { name: 'John Smith', title: 'CTO', organization: 'ABC Technologies' },
    contacts: [
        { type: 'address', data: '123 Main Street' },
        { type: 'email', data: 'info@example.test' },
        { type: 'phone', data: '1-949-555-1234' },
        { type: 'fax', data: '1-949-555-5678' },
        { type: 'url', data: 'https://contact.example/' },
    ],
    categories: [
        { type: 'main', data: 'Art' },
        { type: 'sub', data: 'Photography' },
        { type: 'other', data: 'Sunsets' },
    ],
    social: [
        { type: 'github', data: 'https://github.com/XChain-Platform' },
        { type: 'custom', data: 'javascript:alert(1)' },
    ],
    images: [{ type: 'large', size: '1600x900', data: 'https://cdn.example/image.png', name: 'image.png', title: 'Image title', hash: HASH }],
    audio: [{ type: 'mp3', data: 'https://cdn.example/audio.mp3', name: 'audio.mp3', title: 'Audio title', size: '123 bytes', hash: HASH }],
    video: [{ type: 'mp4', data: 'https://cdn.example/video.mp4', name: 'video.mp4', title: 'Video title', size: '456 bytes', hash: HASH }],
    files: [{ type: 'pdf', data: 'https://cdn.example/paper.pdf', data_ref: 'action:55', name: 'paper.pdf', title: 'Paper title', size: '789 bytes', hash: HASH, locked: true, pack_id: 'deluxe' }],
    packs: { deluxe: { name: 'Deluxe Edition', description: 'Liner notes and stems' } },
    dns: [{ type: 'MX', host: '@', value: 'mail.example.test', priority: 10 }],
};

let savedResizeObserver;
beforeAll(() => {
    class StubObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = StubObserver;
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });
afterEach(() => { cleanup(); __clearTokenInfoCache(); vi.restoreAllMocks(); });

function renderTis(infoOverride = null) {
    const bundle = tisToMediaBundle(TIS);
    resolveMediaDataRefs(bundle, { fileRawUrl: (index) => `https://explorer.example/file/${index}/raw` });
    const info = infoOverride || normalizeTokenInfo(CHAIN, 'MYTOKEN', { info: { owner: 'bcrt1qowner' } }, bundle);
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue(info),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getHoldersForToken: vi.fn().mockResolvedValue({ data: [] }),
        listGatedContent: vi.fn().mockResolvedValue([]),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail walletId="w1" chainId={CHAIN} tick="MYTOKEN" kind="token" quantity="1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('TokenDetail TIS rendering', () => {
    it('renders every structured Details field as inert issuer text', async () => {
        renderTis();
        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        const profile = await screen.findByLabelText('Token information profile');

        for (const text of [
            '<b>Token Name</b>', '<script>literal description</script>',
            'John Smith', 'CTO', 'ABC Technologies', '123 Main Street',
            'info@example.test', '1-949-555-1234', '1-949-555-5678',
            'Main: Art', 'Sub: Photography', 'Other: Sunsets', 'MX · 10', '@', 'mail.example.test',
            'deluxe', 'Deluxe Edition', 'Liner notes and stems',
        ]) expect(within(profile).getAllByText(text).length).toBeGreaterThan(0);

        expect(within(profile).getByRole('link', { name: 'Website: https://project.example/path' })).toBeInTheDocument();
        expect(within(profile).getByRole('link', { name: 'GitHub: https://github.com/XChain-Platform' })).toBeInTheDocument();
        expect(profile).toHaveTextContent('Custom: javascript:alert(1)');

        expect(profile.querySelector('script')).toBeNull();
        expect(profile.querySelector('iframe')).toBeNull();
        expect(screen.getByRole('link', { name: 'Interactive content: view on the explorer' })).toBeInTheDocument();
        expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
        expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
        expect(document.querySelector('a[href^="tel:"]')).toBeNull();
    });

    it('renders every Files field and keeps locked data_ref content inert', async () => {
        renderTis();
        fireEvent.click(await screen.findByRole('tab', { name: 'Files' }));

        for (const text of [
            'Image title', 'Name: image.png', 'Title: Image title', 'Type: large', 'Size: 1600x900',
            `Hash: ${HASH}`, 'Audio title', 'Size: 123 bytes', 'Video title', 'Size: 456 bytes',
            'Paper title', 'Name: paper.pdf', 'Type: pdf', 'Size: 789 bytes', 'Locked: Yes',
            'Pack ID: deluxe', 'Linked action: action:55', 'URL: https://cdn.example/paper.pdf',
        ]) expect((await screen.findAllByText(text)).length).toBeGreaterThan(0);

        expect(screen.queryByRole('link', { name: 'Open Paper title' })).toBeNull();
        expect(document.querySelector('iframe')).toBeNull();
    });

    it('confirms a safe issuer URL before opening it', async () => {
        const open = vi.spyOn(window, 'open').mockImplementation(() => null);
        renderTis();
        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        fireEvent.click(await screen.findByRole('link', { name: 'Website: https://project.example/path' }));

        expect(open).not.toHaveBeenCalled();
        const dialog = screen.getByRole('dialog', { name: 'Open External Link?' });
        expect(within(dialog).getByText('https://project.example/path')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Open Link' }));
        await waitFor(() => expect(open).toHaveBeenCalledWith('https://project.example/path', '_blank', 'noopener,noreferrer'));
    });

    it('shows the quiet note when the information document cannot be read', async () => {
        renderTis({ creator: 'bcrt1qowner', tisReadError: true });
        fireEvent.click(await screen.findByRole('tab', { name: 'Details' }));
        expect(await screen.findByText("The token information file couldn't be read")).toBeInTheDocument();
    });
});
