// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A demo wallet's Parent token picker lists the tokens My tokens shows it
// owning (the demo fixtures), and still never asks an explorer. It once
// returned an empty list for every demo wallet, so the picker said
// "You own no tokens yet" beside a My tokens page listing three.

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { markDemoWallet } from '../../../packages/core/src/flows/demoMode.js';

const DEMO_WALLET_ID = 'w-demo-parents';
const CHAIN = 'bitcoin-mainnet';
const OWNER = {
    id: 'addr-demo-1',
    address: 'bc1qdemodemodemodemodemodemodemodemodemo0',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function mount() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: OWNER }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getOwnedTokens: vi.fn().mockResolvedValue([]),
        getTokenInfo: vi.fn().mockResolvedValue({}),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenWizard walletId={DEMO_WALLET_ID} onBack={() => {}} initialChainId={CHAIN} initialParentTick="" />
        </MessagingProvider>,
    );
    return messaging;
}

let savedGlobals;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    savedGlobals = {
        ResizeObserver: globalThis.ResizeObserver,
        IntersectionObserver: globalThis.IntersectionObserver,
        matchMedia: globalThis.matchMedia,
    };
    globalThis.ResizeObserver = StubObserver;
    globalThis.IntersectionObserver = StubObserver;
    globalThis.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
    });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

afterAll(() => {
    globalThis.ResizeObserver = savedGlobals.ResizeObserver;
    globalThis.IntersectionObserver = savedGlobals.IntersectionObserver;
    globalThis.matchMedia = savedGlobals.matchMedia;
});

describe('Issue Token Parent picker in a demo wallet', () => {
    it('lists the demo wallet\'s own tokens without asking an explorer', async () => {
        markDemoWallet(DEMO_WALLET_ID, { now: Date.now() });
        const messaging = mount();
        fireEvent.click(await screen.findByRole('button', { name: /^Select template/ }));
        fireEvent.click(screen.getByRole('option', { name: /Subtoken/ }));
        fireEvent.click(await screen.findByRole('button', { name: /^Parent token: Select a token you own/ }));

        await waitFor(() => {
            for (const tick of ['BEANCOIN', 'STUDIOPASS', 'HARBORFEST']) {
                expect(document.querySelector(`[data-balance-option="${CHAIN}:${tick}"]`)).not.toBeNull();
            }
        });
        expect(screen.queryByText('You own no tokens yet')).toBeNull();
        expect(messaging.getOwnedTokens).not.toHaveBeenCalled();
    });
});
