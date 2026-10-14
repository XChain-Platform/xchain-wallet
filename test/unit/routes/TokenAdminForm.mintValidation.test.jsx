// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenAdminForm } from '../../../packages/core/src/shared/routes/TokenAdminForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

const TOKEN_INFO = {
    chainId: CHAIN,
    tick: 'MINTABLE',
    divisibility: 0,
    locks: {},
};

// tokenInfo, when given, is the promise getTokenInfo returns, so a case can
// hold the token record back until after the owner has typed.
function mountMintSettings(tokenInfo = Promise.resolve(TOKEN_INFO)) {
    const composeForConfirm = vi.fn();
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockReturnValue(tokenInfo),
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

// Submit only once the button is live: it stays disabled until the source
// address list resolves and a mint field holds text, and a click on a
// disabled button is silently dropped.
async function submitWhenEnabled() {
    const button = screen.getByRole('button', { name: /update token/i });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
}

// The token-info cache is module-level; clearing it keeps every case on the
// same cold fetch path instead of only the first one.
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

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
        await submitWhenEnabled();

        expect(await screen.findByRole('alert')).toHaveTextContent(message);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps a mint setting typed before the token record arrives', async () => {
        let resolveTokenInfo;
        const composeForConfirm = mountMintSettings(new Promise((resolve) => { resolveTokenInfo = resolve; }));
        const field = await screen.findByLabelText('Max mint per transaction (optional)');
        fireEvent.change(field, { target: { value: '1,000' } });

        await act(async () => { resolveTokenInfo({ ...TOKEN_INFO, mintMax: '500' }); });

        expect(field).toHaveValue('1,000');
        await submitWhenEnabled();
        expect(await screen.findByRole('alert')).toHaveTextContent('Max mint per transaction must be a positive number.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('requires an amount before accepting a new-supply destination', async () => {
        const composeForConfirm = mountMintSettings();
        fireEvent.change(await screen.findByLabelText('Send that new supply to (optional)'), {
            target: { value: SOURCE.address },
        });
        await submitWhenEnabled();

        expect(await screen.findByRole('alert')).toHaveTextContent('Sending new supply needs a mint supply amount.');
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects fractional mint settings for an indivisible token', async () => {
        const composeForConfirm = mountMintSettings();
        fireEvent.change(await screen.findByLabelText('Mint supply now (optional)'), {
            target: { value: '1.5' },
        });
        await submitWhenEnabled();

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
        await submitWhenEnabled();

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not valid for Bitcoin/i));
        expect(composeForConfirm).not.toHaveBeenCalled();
    });
});
