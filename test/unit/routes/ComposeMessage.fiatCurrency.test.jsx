// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/hooks/useFiatRate.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useFiatRate: () => ({ rate: 50000, fiatCurrency: 'EUR' }),
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ComposeMessage } from '../../../packages/core/src/shared/routes/ComposeMessage.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'addr-1',
    address: 'bc1qsendersendersendersendersendersendersa',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

afterEach(() => cleanup());

describe('ComposeMessage fiat currency', () => {
    it('shows the network fee in the selected currency', async () => {
        const base = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDRESS }),
            getSettings: vi.fn().mockResolvedValue({ fiatCurrency: 'EUR' }),
        };
        const messaging = new Proxy(base, {
            get(target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop !== 'string') return undefined;
                const stub = vi.fn().mockResolvedValue(null);
                target[prop] = stub;
                return stub;
            },
        });

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <ComposeMessage walletId="wallet" chainId={CHAIN} onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(await screen.findByText(/€[0-9,.]+/)).toBeInTheDocument();
        expect(document.body.textContent).not.toContain('$');
    });
});
