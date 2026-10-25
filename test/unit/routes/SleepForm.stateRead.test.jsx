// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// While the pause state is loading, or when its read fails, the form says so.
// It used to render both as "active (not paused)", telling the user that a
// paused token was running.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qsleepsleepsleepsleepsleepsleepxx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function mount(sleepState) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getTokenInfo: vi.fn().mockResolvedValue({ tick: 'gate', creator: ADDRESS.address, locks: {} }),
        sleepState,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SleepForm walletId="w" mode="tick" initialChainId={CHAIN} initialTick="gate" onBack={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('SleepForm pause state read', () => {
    it('does not claim the token is active when the read fails', async () => {
        mount(vi.fn().mockRejectedValue(new Error('explorer 500')));
        expect(await screen.findByText('The current pause state could not be read.')).toBeInTheDocument();
        expect(screen.queryByText(/active \(not paused\)/)).toBeNull();
    });

    it('says it is checking while the read is pending', async () => {
        mount(vi.fn(() => new Promise(() => {})));
        expect(await screen.findByText('Checking the current pause state.')).toBeInTheDocument();
        expect(screen.queryByText(/active \(not paused\)/)).toBeNull();
    });

    it('still reports an active token once the read answers', async () => {
        mount(vi.fn().mockResolvedValue({ resumeBlock: null }));
        expect(await screen.findByText('gate is currently active (not paused).')).toBeInTheDocument();
    });
});
