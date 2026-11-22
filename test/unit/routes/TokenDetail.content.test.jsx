// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenDetail } from '../../../packages/core/src/shared/routes/TokenDetail.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-regtest';
const HASH = 'a'.repeat(64);

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

function fixture() {
    return {
        tisAvailable: true,
        name: 'Pepe Cash',
        description: 'Community currency for card collectors.',
        creator: 'bcrt1qcreator',
        totalSupply: '1000000000',
        projects: [{ project: 'RAREPEPE', linkActionIndex: '5520193', rosterActionIndex: '5520192' }],
        images: [
            { type: 'icon', url: 'https://assets.example/icon.png', name: 'Logo', size: '128x128' },
            { type: 'large', url: 'https://assets.example/banner.png', name: 'Genesis card', size: '1600x900', hash: HASH },
        ],
        files: [{ type: 'pdf', url: 'https://assets.example/whitepaper.pdf', name: 'whitepaper.pdf', title: 'Whitepaper', hash: HASH }],
        categories: [{ type: 'main', value: 'Currency' }, { type: 'sub', value: 'Art and collectibles' }],
        websites: ['https://pepecash.example/'],
        socials: [],
        owner: { name: 'Sam Rivera', title: 'Curator', organization: 'Kek Studio' },
        contacts: [{ type: 'email', value: 'hello@pepecash.example' }],
        dns: [{ type: 'TXT', host: '_proof.pepecash.example', value: 'xchain=RAREPEPE', priority: null }],
        linkedFiles: [{ actionIndex: '88', title: 'Brand kit', name: 'brand.zip', type: 'application/zip', url: 'https://explorer.example/file/88/raw', gated: false }],
    };
}

function gatedGroups() {
    return [
        {
            keyHash: 'key-1',
            files: [
                { actionIndex: 'demo:one', name: 'one.zip', title: 'Series art', type: 'application/zip', gateMinAmount: '1000' },
                { actionIndex: 'demo:two', name: 'two.mp3', title: 'Anthem stems', type: 'audio/mpeg', gateMinAmount: '1000' },
                { actionIndex: 'demo:three', name: 'three.pdf', title: 'Kek Magazine', type: 'application/pdf', gateMinAmount: '1000' },
            ],
        },
        {
            keyHash: 'key-2',
            files: [
                { actionIndex: 'demo:four', name: 'four.mp4', title: 'Founders call', type: 'video/mp4', gateMinAmount: '10000' },
                { actionIndex: 'demo:five', name: 'five.pdf', title: 'Series notes', type: 'application/pdf', gateMinAmount: '10000' },
                { actionIndex: 'demo:six', name: 'six.zip', title: 'Source pack', type: 'application/zip', gateMinAmount: '10000' },
            ],
        },
    ];
}

function mount({
    quantity = '0', info = fixture(), groups = gatedGroups(), groupsError = null, tick = 'PEPECASH', subassets = [],
    unlockResp = { plaintextBase64: 'c2VjcmV0', byteLength: 6 },
} = {}) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getTokenInfo: vi.fn().mockResolvedValue(info),
        getSubassetsForToken: vi.fn().mockResolvedValue({ data: subassets }),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [{ id: 'a1', source: 'hd', address: 'bcrt1qholder' }] }),
        listGatedContent: groupsError
            ? vi.fn().mockRejectedValue(groupsError)
            : vi.fn().mockResolvedValue(groups),
        listGatedKeys: vi.fn().mockResolvedValue([{ keyHash: 'key-1' }, { keyHash: 'key-2' }]),
        unlockGatedContent: vi.fn().mockResolvedValue(unlockResp),
        getSupplyHistory: vi.fn().mockResolvedValue([]),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenDetail walletId="wallet" chainId={CHAIN} tick={tick} kind="token" quantity={quantity} divisibility={0} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

describe('TokenDetail linked content design', () => {
    it('has exactly four tabs and names the attesting project in Details', async () => {
        mount();
        const tabs = within(screen.getByRole('tablist', { name: 'Coin or token view' })).getAllByRole('tab');
        expect(tabs.map((tab) => tab.textContent)).toEqual(['Actions', 'Details', 'Files', 'History']);

        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(await screen.findByText(/Official: part of the/)).toHaveTextContent('Official: part of the RAREPEPE project');
        expect(screen.getByRole('link', { name: 'Proof' })).toBeInTheDocument();
        expect(screen.queryByText(`SHA-256 ${HASH}`)).toBeNull();
    });

    it('switches All, Public, and Holders and shows the holder thresholds', async () => {
        mount();
        fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
        expect(await screen.findByRole('tab', { name: /Public/ })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Open Whitepaper' })).toBeInTheDocument();
        expect(screen.getAllByText(`Hash: ${HASH}`).length).toBeGreaterThan(0);
        expect(await screen.findByRole('button', { name: 'Locked: purchase required to access one.zip' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: /Public/ }));
        expect(screen.getByRole('link', { name: 'Open Whitepaper' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Locked: purchase required to access one.zip' })).toBeNull();

        fireEvent.click(screen.getByRole('tab', { name: /Holders/ }));
        expect(await screen.findByText('Hold 1,000 for 3 files, 10,000 for all 6')).toBeInTheDocument();
        expect(screen.getByText('You hold 0')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Locked: purchase required to access one.zip' })).toBeInTheDocument();
    });

    it('uses the existing decrypt path and turns a locked tile into an unlocked tile', async () => {
        const messaging = mount({ quantity: '25000' });
        fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
        fireEvent.click(await screen.findByRole('tab', { name: /Holders/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Unlock and open one.zip' }));

        await waitFor(() => expect(messaging.unlockGatedContent).toHaveBeenCalled());
        expect(await screen.findByRole('button', { name: 'Open unlocked file one.zip' })).toBeInTheDocument();
    });

    it('carries a failed decompression from the unlock response into the file viewer', async () => {
        mount({
            quantity: '25000',
            unlockResp: { plaintextBase64: 'c2VjcmV0', byteLength: 6, storedForm: true, inflateError: 'INVALID_DEFLATE_STREAM' },
        });
        fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
        fireEvent.click(await screen.findByRole('tab', { name: /Holders/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Unlock and open one.zip' }));

        expect((await screen.findByText(/couldn't be decompressed/i)).textContent).toMatch(/not the original file/i);
    });

    it('carries a failed decompression from a vault-key unlock into the file viewer', async () => {
        const messaging = mount({
            quantity: '25000',
            groups: [{ keyHash: 'key-1', files: [{ actionIndex: '42', name: 'real.bin', title: 'Real file', type: 'application/octet-stream', gateMinAmount: '1000' }] }],
            unlockResp: { plaintextBase64: 'c2VjcmV0', byteLength: 6, storedForm: true, inflateError: 'RATIO_GUARD_TRIPPED' },
        });
        fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
        fireEvent.click(await screen.findByRole('tab', { name: /Holders/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Unlock and open real.bin' }));

        expect((await screen.findByText(/safe decompression limit/i)).textContent).toMatch(/not the original file/i);
        expect(messaging.unlockGatedContent).toHaveBeenCalledWith(expect.objectContaining({ actionIndex: '42', gateTicker: 'PEPECASH', chainId: CHAIN }));
    });

    it('opens a recovered gated file with no stored-form notice', async () => {
        mount({ quantity: '25000' });
        fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
        fireEvent.click(await screen.findByRole('tab', { name: /Holders/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Unlock and open one.zip' }));

        expect(await screen.findByRole('button', { name: 'Download' })).toBeInTheDocument();
        expect(screen.queryByText(/decompress/i)).toBeNull();
    });

    it('filters file titles from the standard header filter and marks it active', async () => {
        mount();
        fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
        await screen.findByRole('link', { name: 'Open Whitepaper' });
        fireEvent.click(screen.getByRole('button', { name: 'Filter token content' }));
        fireEvent.change(screen.getByRole('searchbox', { name: 'Search token details, files, and history' }), { target: { value: 'whitepaper' } });

        expect(screen.getByRole('button', { name: 'Filter token content' })).toHaveAttribute('data-active', 'true');
        expect(screen.getByRole('link', { name: 'Open Whitepaper' })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Open Brand kit' })).toBeNull();
    });

    it('keeps public files available when the gated bulk read fails', async () => {
        mount({ groupsError: new Error('explorer offline') });
        fireEvent.click(screen.getByRole('tab', { name: 'Files' }));

        expect(await screen.findByRole('link', { name: 'Open Whitepaper' })).toBeInTheDocument();
        expect(await screen.findByText(/couldn't load the gated content/i)).toBeInTheDocument();
    });

    it('keeps the four-tab shape for a basic token and shows quiet empty states', async () => {
        mount({ info: { creator: 'bcrt1qcreator', totalSupply: '1000000', divisibility: 0 }, groups: [] });
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
        expect(await screen.findByText('No token information')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
        expect(await screen.findByText('No files yet')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', { name: /Holders/ }));
        expect(screen.queryByText(/Hold .* for/)).toBeNull();
    });

    it('shows project ownership, collection relations, and guarded HTML navigation', async () => {
        mount({
            tick: 'RAREPEPE.CARD',
            info: { ...fixture(), registry: { total: 12000 }, htmlAvailable: true },
            subassets: [{ tick: 'RAREPEPE.CARD.CHILD' }],
        });
        fireEvent.click(screen.getByRole('tab', { name: 'Details' }));

        expect(await screen.findByText(/This token owns the/)).toHaveTextContent('RAREPEPE.CARD project');
        expect(screen.getByRole('link', { name: 'view its 12,000 official tokens' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'RAREPEPE' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'RAREPEPE.CARD.CHILD' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Interactive content: view on the explorer' })).toBeInTheDocument();
        expect(document.querySelector('script')).toBeNull();
    });
});
