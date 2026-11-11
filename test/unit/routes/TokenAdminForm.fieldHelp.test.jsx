// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'source-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function mountAdmin(mode) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN,
            tick: 'TOKEN',
            creator: SOURCE.address,
            locks: {},
            bridgeChains: [],
        }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue({});
        },
    });

    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenAdminForm
                walletId="wallet-1"
                mode={mode}
                initialChainId={CHAIN}
                initialTick="TOKEN"
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

function tooltipFor(button) {
    return document.getElementById(button.getAttribute('aria-describedby'));
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('TokenAdminForm field help', () => {
    it('moves both bridge explanations into Destination networks help', async () => {
        mountAdmin('bridge-settings');

        const group = await screen.findByRole('group', { name: 'Destination networks' });
        expect(group).toHaveAccessibleName('Destination networks');

        const help = screen.getByRole('button', { name: 'About Destination networks' });
        const tooltip = tooltipFor(help);
        expect(tooltip).toHaveTextContent(
            'Bridging lets holders lock this token here and receive a copy of it on another chain.',
        );
        expect(tooltip).toHaveTextContent(
            'Unchecking every chain closes the door to NEW transfers.',
        );
    });

    it('keeps the description limit in its help and counter, not a loose hint', async () => {
        mountAdmin('description');

        const description = await screen.findByLabelText('Description');
        expect(description.tagName).toBe('TEXTAREA');
        expect(description).toHaveAttribute('maxlength', '249');
        expect(screen.getByText('0 / 249')).toBeInTheDocument();

        const help = screen.getByRole('button', { name: 'About Description' });
        expect(tooltipFor(help)).toHaveTextContent(
            'Stored on-chain and replaces the current description. Up to 249 characters.',
        );
        expect(screen.queryByText('Up to 249 characters.')).toBeNull();
        expect(screen.getByRole('button', { name: 'Update description' })).toBeInTheDocument();
    });
});
