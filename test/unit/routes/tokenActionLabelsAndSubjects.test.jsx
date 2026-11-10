// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CallbackForm } from '../../../packages/core/src/shared/routes/CallbackForm.jsx';
import { SleepForm } from '../../../packages/core/src/shared/routes/SleepForm.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'address-1',
    address: 'bc1qissuer',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messagingForForms() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            tick: 'TOKEN',
            creator: SOURCE.address,
            locks: {},
            bridgeChains: [],
        }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        sleepState: vi.fn().mockResolvedValue(null),
        getWalletBalances: vi.fn().mockResolvedValue({}),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({ rows: [] });
        },
        has: (object, property) => property in object,
    });
}

function mount(element) {
    render(
        <MessagingProvider shell="web" messaging={messagingForForms()}>
            {element}
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('token action labels', () => {
    it.each([
        ['callback-settings', 'Update callback settings'],
        ['bridge-settings', 'Update bridge settings'],
        ['description', 'Update description'],
        ['transfer', 'Transfer ownership'],
    ])('uses the %s action as the primary submit label', async (mode, label) => {
        mount(
            <TokenAdminForm
                walletId="wallet-1"
                mode={mode}
                initialChainId={CHAIN}
                initialTick="TOKEN"
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />,
        );

        const submit = await screen.findByRole('button', { name: label });
        expect(submit.className).toMatch(/primary/);
        expect(screen.queryByRole('button', { name: 'Update token' })).toBeNull();
    });

    it('uses a multiline description field and the specific update action', async () => {
        mount(
            <TokenAdminForm
                walletId="wallet-1"
                mode="description"
                initialChainId={CHAIN}
                initialTick="TOKEN"
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />,
        );

        expect(await screen.findByLabelText('Description')).toBeInstanceOf(HTMLTextAreaElement);
        expect(screen.getByRole('button', { name: 'Update description' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });
});

describe('token action sentence subjects', () => {
    it('uses plain token wording when callback context has no ticker', async () => {
        mount(
            <CallbackForm
                walletId="wallet-1"
                initialChainId={CHAIN}
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />,
        );

        expect(await screen.findByText('No callback configured for this token.')).toBeInTheDocument();
        // U86: the summary row is the one place that says it; no notice repeats it.
        expect(screen.queryByText(/has no callback configured/)).toBeNull();
    });

    it('uses plain token wording when pause context has no ticker', async () => {
        mount(
            <SleepForm
                walletId="wallet-1"
                mode="tick"
                initialChainId={CHAIN}
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />,
        );

        expect(await screen.findByText('This token is currently active (not paused).')).toBeInTheDocument();
    });
});
