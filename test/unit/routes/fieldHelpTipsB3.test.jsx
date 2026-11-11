// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PairSignerForm } from '../../../packages/core/src/shared/routes/PairSignerForm.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qhelphelphelphelphelphelphelphelphelp',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, 'hid');
});

function describedText(field) {
    return String(field.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || '')
        .join(' ');
}

function expectTip({ label, copy, fieldLabel = label, selector = 'input' }) {
    const field = screen.getByLabelText(fieldLabel, { selector });
    expect(describedText(field)).not.toContain(copy);

    fireEvent.click(screen.getByRole('button', { name: `About ${label}` }));

    expect(screen.getByRole('tooltip')).toHaveTextContent(copy);
    expect(describedText(field)).not.toContain(copy);
}

describe('Route field help tips', () => {
    it('puts signer label guidance in the label tip', async () => {
        Object.defineProperty(navigator, 'hid', { configurable: true, value: {} });
        const pairingInfo = {
            vendor: 'trezor',
            model: 'safe-3',
            deviceIdentifier: 'device-1',
            firmwareVersion: '2.8.0',
        };
        const messaging = {
            listSigners: vi.fn().mockResolvedValue([]),
            registerSigner: vi.fn(),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PairSignerForm
                    walletId="wallet-1"
                    pairTrezor={vi.fn().mockResolvedValue({ signer: {}, pairingInfo })}
                    pairLedger={vi.fn()}
                    onBack={vi.fn()}
                />
            </MessagingProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: /Trezor/ }));
        await screen.findByLabelText('Label', { selector: 'input' });

        expectTip({
            label: 'Label',
            copy: 'Shows wherever this signer appears in the UI.',
        });
    });

    it('puts publish title guidance in the label tip', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PublishFileForm walletId="wallet-1" onBack={vi.fn()} />
            </MessagingProvider>,
        );

        await screen.findByLabelText(/^Title/, { selector: 'input' });

        expectTip({
            label: 'Title',
            fieldLabel: /^Title/,
            copy: 'A short label stored on-chain with the published file.',
        });
    });

    it('puts swap expiration guidance in the label tip', async () => {
        const target = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            getWalletBalances: vi.fn().mockResolvedValue({}),
        };
        const messaging = new Proxy(target, {
            get(api, prop) {
                if (prop in api) return api[prop];
                return vi.fn().mockResolvedValue({ rows: [] });
            },
            has: (api, prop) => prop in api,
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <SwapForm walletId="wallet-1" initialChainId={CHAIN} onBack={vi.fn()} />
            </MessagingProvider>,
        );

        fireEvent.click(await screen.findByRole('radio', { name: 'Expire at a specific time' }));

        expectTip({
            label: 'Expires',
            copy: 'Wall-clock time the swap offer is valid until. Must be in the future.',
        });
    });
});
