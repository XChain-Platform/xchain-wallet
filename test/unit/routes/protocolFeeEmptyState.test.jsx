// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An empty protocol-fee form reads "Calculating" on every form, never
// "Priced at review", until its inputs are valid and the live quote lands.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { DividendForm } from '../../../packages/core/src/shared/routes/DividendForm.jsx';
import { ListCreateForm } from '../../../packages/core/src/shared/routes/ListCreateForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function mount(element) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListsForSource: vi.fn().mockResolvedValue([]),
        getActionFormats: vi.fn().mockResolvedValue({}),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            target[prop] = vi.fn().mockResolvedValue(null);
            return target[prop];
        },
    });
    render(<MessagingProvider shell="web" messaging={messaging}>{element}</MessagingProvider>);
    return messaging;
}

async function settle() {
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
}

function protocolFeeRow() {
    const root = document.querySelector('[data-fees-card]');
    expect(root).not.toBeNull();
    return root.textContent;
}

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe.each([
    ['AirdropForm', <AirdropForm walletId="w" initialChainId={CHAIN} onBack={() => {}} />],
    ['DividendForm', <DividendForm walletId="w" initialChainId={CHAIN} onBack={() => {}} />],
    ['ListCreateForm', <ListCreateForm walletId="w" chainId={CHAIN} initialType="2" onBack={() => {}} />],
])('%s empty', (_name, element) => {
    it('reads Calculating, never Priced at review', async () => {
        vi.useFakeTimers();
        mount(element);
        await settle();
        const text = protocolFeeRow();
        expect(text).toContain('Calculating');
        expect(text).not.toContain('Priced at review');
    });
});
