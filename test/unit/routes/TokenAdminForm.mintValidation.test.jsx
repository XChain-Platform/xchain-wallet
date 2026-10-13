// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function mountMintSettings() {
    const composeForConfirm = vi.fn();
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN,
            tick: 'MINTABLE',
            divisibility: 0,
            locks: {},
        }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 900000 }),
        composeForConfirm,
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue([]);
        },
    });
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenAdminForm
                walletId="w"
                mode="mint-settings"
                initialChainId={CHAIN}
                initialTick="MINTABLE"
                initialFromAddress={SOURCE.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
    return composeForConfirm;
}

afterEach(() => cleanup());

describe('TokenAdminForm mint setting validation', () => {
    it.each([
        ['Max mint per transaction (optional)', '1,000', 'Max mint per transaction must be a positive number.'],
        ['Max mint per address (optional)', 'Infinity', 'Max mint per address must be a positive number.'],
        ['Mint supply now (optional)', 'many', 'Mint supply must be a positive number.'],
        ['Minting opens at block (optional)', '10.5', 'Minting start must be a whole block number.'],
        ['Minting closes at block (optional)', 'later', 'Minting close must be a whole block number.'],
    ])('refuses malformed text in %s before composing', async (label, value, message) => {
        const composeForConfirm = mountMintSettings();
        fireEvent.change(await screen.findByLabelText(label), { target: { value } });
        fireEvent.click(screen.getByRole('button', { name: /update token/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('requires an amount before accepting a new-supply destination', async () => {
        const composeForConfirm = mountMintSettings();
        fireEvent.change(await screen.findByLabelText('Send that new supply to (optional)'), {
            target: { value: SOURCE.address },
        });
        fireEvent.click(screen.getByRole('button', { name: /update token/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Sending new supply needs a mint supply amount.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects fractional mint settings for an indivisible token', async () => {
        const composeForConfirm = mountMintSettings();
        fireEvent.change(await screen.findByLabelText('Mint supply now (optional)'), {
            target: { value: '1.5' },
        });
        fireEvent.click(screen.getByRole('button', { name: /update token/i }));

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'Mint supply must be a whole number because MINTABLE is indivisible.',
        );
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('checks the new-supply destination against the selected chain', async () => {
        const composeForConfirm = mountMintSettings();
        fireEvent.change(await screen.findByLabelText('Mint supply now (optional)'), {
            target: { value: '10' },
        });
        fireEvent.change(screen.getByLabelText('Send that new supply to (optional)'), {
            target: { value: 'not-an-address' },
        });
        fireEvent.click(screen.getByRole('button', { name: /update token/i }));

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not valid for Bitcoin/i));
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});
