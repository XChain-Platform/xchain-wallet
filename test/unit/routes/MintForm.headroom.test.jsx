// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// (wallet E2E D-78): the Mint form's "available" footer and Max
// button reported what the user HOLDS instead of what can still be
// minted. On a token at its cap (S18PROBE, 5,000 of a 5,000 cap) the
// footer read "5,000 S18PROBE available" and Max filled 5,000 - an
// amount the chain rejects by construction, three screens before the
// preflight said so and only after a protocol fee had been committed.
// These drive the real component: the number the form quotes and the
// number Max fills must be min(MAX_MINT, MAX_SUPPLY - supply), and the
// wallet balance must not reach the field at all.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const ADDRESS = 'bc1qexampleexampleexampleexampleexampleex';
const ADDRESSES = {
    'bitcoin-mainnet': [
        {
            id: 'addr-1',
            address: ADDRESS,
            publicKey: '02ab',
            derivationPath: "m/84'/0'/0'/0/0",
            source: 'hd',
        },
    ],
    'litecoin-mainnet': [
        {
            id: 'addr-ltc',
            address: 'ltc1qexampleexampleexampleexampleexampleex',
            publicKey: '02ab',
            derivationPath: "m/84'/2'/0'/0/0",
            source: 'hd',
        },
    ],
    'dogecoin-mainnet': [
        {
            id: 'addr-doge',
            address: 'DExampleExampleExampleExample1234',
            publicKey: '02ab',
            derivationPath: "m/44'/3'/0'/0/0",
            source: 'hd',
        },
    ],
};

// The issuer holds the entire supply, which is exactly why the holdings
// lookup looked plausible: the wrong number and a believable one.
const HELD = '5000';

function mountMint({
    maxSupply = '5000',
    totalSupply = '5000',
    mintMax = null,
    mintAddressMax = null,
    mintedAmount = '0',
    mintedError = null,
    mintedPending = false,
    divisibility = 0,
    initialTick = 'S18PROBE',
    chainId = 'bitcoin-mainnet',
} = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        listContacts: vi.fn().mockResolvedValue([]),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId,
            tick: initialTick,
            maxSupply,
            totalSupply,
            mintMax,
            mintAddressMax,
            divisibility,
            locks: {},
        }),
        getMintedAmountForAddress: mintedPending
            ? vi.fn(() => new Promise(() => {}))
            : (mintedError
                ? vi.fn().mockRejectedValue(mintedError)
                : vi.fn().mockResolvedValue({ amount: mintedAmount })),
        // The holdings lookup every other amount form reaches for. Wired
        // here on purpose: if it ever leaks back into this field, the
        // "5,000 available" assertion below fails again.
        getWalletBalances: vi.fn().mockResolvedValue({
            'bitcoin-mainnet': [{
                address: ADDRESS,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: 'S18PROBE', quantity: HELD, divisibility: 0 }],
                },
            }],
        }),
        // These tests stop at the compose call, so compose stays pending
        // rather than resolving to a value no host returns.
        composeForConfirm: vi.fn(() => new Promise(() => {})),
        preflight: vi.fn(),
    };
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MintForm, {
                walletId: 'w',
                initialChainId: chainId,
                initialTick,
                onBack() {},
            }),
        ),
    );
    return messaging;
}

// The label carries the active unit ("Amount (S18PROBE)"); anchoring on
// the start keeps it off the Max button's "Use max available amount".
const amountField = () => screen.findByLabelText(/^Amount\b/);
const submitButton = () => screen.getByRole('button', { name: /^(Mint|Preview)$/ });

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('MintForm sizes off mint headroom, not holdings', () => {
    it('reads 0 available for a token sitting at its supply cap', async () => {
        mountMint();
        expect(await screen.findByText(/0 S18PROBE available to mint/)).toBeInTheDocument();
        // The old, wrong number must be nowhere on the screen.
        expect(screen.queryByText(/5,000 S18PROBE available/)).not.toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
    });

    it('offers no Max at the cap, so it cannot fill a rejectable amount', async () => {
        mountMint();
        await screen.findByText(/0 S18PROBE available to mint/);
        const max = screen.queryByRole('button', { name: /max available/i });
        // Either hidden or inert - what must never happen is a live Max
        // that drops the whole supply into the field.
        expect(max === null || max.disabled).toBe(true);
        expect((await amountField()).value).toBe('');
    });

    it('quotes the remaining headroom when the token is below its cap', async () => {
        mountMint({ totalSupply: '1200' });
        expect(await screen.findByText(/3,800 S18PROBE available to mint/)).toBeInTheDocument();
    });

    it('Max fills the headroom, not the balance', async () => {
        mountMint({ totalSupply: '1200' });
        await screen.findByText(/3,800 S18PROBE available to mint/);
        fireEvent.click(screen.getByRole('button', { name: /max available/i }));
        await waitFor(async () => expect((await amountField()).value).toBe('3,800'));
    });

    it('lets the per-transaction MAX_MINT bind when it is the smaller cap', async () => {
        mountMint({ totalSupply: '1200', mintMax: '100' });
        expect(await screen.findByText(/100 S18PROBE available to mint/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /max available/i }));
        await waitFor(async () => expect((await amountField()).value).toBe('100'));
    });

    it('Max subtracts this source address mint history from its per-address cap', async () => {
        const messaging = mountMint({
            totalSupply: '1000',
            mintMax: '500',
            mintAddressMax: '100',
            mintedAmount: '60',
        });
        expect(await screen.findByText(/40 S18PROBE available to mint/)).toBeInTheDocument();
        expect(screen.getByText(/40 left for this address/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /max available/i }));
        await waitFor(async () => expect((await amountField()).value).toBe('40'));
        expect(messaging.getMintedAmountForAddress).toHaveBeenCalledWith({
            chainId: 'bitcoin-mainnet',
            address: ADDRESS,
            tick: 'S18PROBE',
        });
    });

    it('disables Max and names a reached per-address cap', async () => {
        mountMint({ mintAddressMax: '100', mintedAmount: '100', totalSupply: '1000' });
        expect(await screen.findByText('This address has reached its per-address cap.'))
            .toBeInTheDocument();
        const max = screen.queryByRole('button', { name: /max available/i });
        expect(max === null || max.disabled).toBe(true);
    });

    it('falls back to the stated address cap when mint history cannot load', async () => {
        mountMint({
            totalSupply: '1000',
            mintMax: '500',
            mintAddressMax: '100',
            mintedError: new Error('explorer unavailable'),
        });
        expect(await screen.findByText(/100 S18PROBE available to mint/)).toBeInTheDocument();
        expect(screen.getByText(/100 per address in total/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /max available/i }));
        await waitFor(async () => expect((await amountField()).value).toBe('100'));
    });

    it('uses the other caps and labels address history while that read is loading', async () => {
        mountMint({
            totalSupply: '1000',
            mintMax: '500',
            mintAddressMax: '100',
            mintedPending: true,
        });
        expect(await screen.findByText(/500 S18PROBE available to mint/)).toBeInTheDocument();
        expect(screen.getByText(/100 per address in total \(mint history loading\)/))
            .toBeInTheDocument();
    });

    it('says so instead of quoting a number when nothing caps the token', async () => {
        mountMint({ maxSupply: null, totalSupply: '1200' });
        expect(await screen.findByText(/No supply cap/)).toBeInTheDocument();
        expect(screen.queryByText(/available to mint/)).not.toBeInTheDocument();
    });

    it('blocks an over-mint at the form, before any composing or signing', async () => {
        const messaging = mountMint();
        await screen.findByText(/0 S18PROBE available to mint/);
        fireEvent.change(await amountField(), { target: { value: '5000' } });
        fireEvent.click(submitButton());
        expect(await screen.findByRole('alert'))
            .toHaveTextContent('S18PROBE is at its supply cap - no more can be minted.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('names the amount that would still fit when there is some headroom', async () => {
        const messaging = mountMint({ totalSupply: '1200' });
        await screen.findByText(/3,800 S18PROBE available to mint/);
        fireEvent.change(await amountField(), { target: { value: '4000' } });
        fireEvent.click(submitButton());
        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Only 3,800 S18PROBE can still be minted.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('keeps an indivisible mint out of review when the amount has decimals', async () => {
        const messaging = mountMint({ totalSupply: '1200' });
        await screen.findByText(/3,800 S18PROBE available to mint/);
        fireEvent.change(await amountField(), { target: { value: '1.5' } });
        fireEvent.click(submitButton());
        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Amount must be a whole number because S18PROBE is indivisible.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects a malformed optional destination before composing', async () => {
        const messaging = mountMint({ totalSupply: '1200' });
        await screen.findByText(/3,800 S18PROBE available to mint/);
        fireEvent.change(await amountField(), { target: { value: '10' } });
        fireEvent.change(screen.getByLabelText('Destination (optional)'), {
            target: { value: 'not-an-address' },
        });
        fireEvent.click(submitButton());

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Destination is not valid for Bitcoin.');
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('lets a mint the headroom covers through to composing', async () => {
        const messaging = mountMint({ totalSupply: '1200' });
        await screen.findByText(/3,800 S18PROBE available to mint/);
        fireEvent.change(await amountField(), { target: { value: '3800' } });
        fireEvent.click(submitButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    });

    it('keeps a lowercase ticker exact in the locked context and composed action', async () => {
        const messaging = mountMint({
            initialTick: 'caseSensitive',
            totalSupply: '1200',
        });
        fireEvent.change(await amountField(), { target: { value: '10' } });
        fireEvent.click(submitButton());

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const params = messaging.composeForConfirm.mock.calls[0][0].actionData.params;
        expect(params.TICK).toBe('caseSensitive');
    });

    it('stays ungated when the token record cannot be read', async () => {
        // A lookup hiccup must not block every mint; the confirm page's
        // preflight is still there behind it.
        const messaging = mountMint();
        messaging.getTokenInfo.mockRejectedValue(new Error('explorer down'));
        cleanup();
        __clearTokenInfoCache();
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(MintForm, {
                    walletId: 'w',
                    initialChainId: 'bitcoin-mainnet',
                    initialTick: 'S18PROBE',
                    onBack() {},
                }),
            ),
        );
        fireEvent.change(await amountField(), { target: { value: '5000' } });
        fireEvent.click(submitButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
    });

    it.each([
        'bitcoin-mainnet',
        'litecoin-mainnet',
        'dogecoin-mainnet',
    ])('does not offer or compose a native protocol fee on %s', async (chainId) => {
        const messaging = mountMint({ chainId, totalSupply: '1200' });
        await screen.findByText(/3,800 S18PROBE available to mint/);
        expect(screen.queryByLabelText(/protocol fee/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/protocol fee/i)).not.toBeInTheDocument();
        fireEvent.change(await amountField(), { target: { value: '10' } });
        fireEvent.click(submitButton());
        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const request = messaging.composeForConfirm.mock.calls[0][0];
        expect(request.encoderOpts).not.toHaveProperty('payFeeInNativeCoin');
    });
});
