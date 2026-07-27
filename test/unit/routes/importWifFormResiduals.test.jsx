// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

//  residuals on the Import-address form, all D-64:
//
//  - the address-type select defaulted to the CHAIN's default, so a
//    counterwallet-legacy wallet landed on P2WPKH here while the sibling
//    Add-address modal - fixed for exactly this in  - sat on P2PKH.
//    Two screens in one app disagreeing about a migrating user's format.
//  - a rejected import rendered `err.message` verbatim, so the user read
//    "importWif: Failed to import WIF: Non-base58 character".
//  - the WIF field's placeholder was a fixed mainnet key ("L1aW…") on every
//    chain, including the regtest chains this lane is driven on.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    AddressList,
    wifPrefixHint,
} from '../../../packages/core/src/shared/routes/AddressList.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';

const REGTEST_SETTINGS = {
    schemaVersion: 1,
    activeNetwork: 'regtest',
    fees: {
        'bitcoin-regtest': { strategy: 'normal' },
        'litecoin-regtest': { strategy: 'normal' },
        'dogecoin-regtest': { strategy: 'normal' },
    },
};

const ACCOUNT = { id: 'account-a', index: 0, walletId: 'wallet-a' };

afterEach(() => cleanup());

function messagingFor(walletFormat, overrides = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([
            { id: 'wallet-a', name: 'Main Wallet', format: walletFormat },
        ]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue(REGTEST_SETTINGS),
        importWifRequest: vi.fn(async () => ({ address: { address: 'mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp' } })),
        ...overrides,
    };
}

async function openImportForm(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddressList walletId="wallet-a" accountId={ACCOUNT.id} onBack={() => {}} />
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Add or import address/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Import address/i }));
    await screen.findByLabelText(/WIF private key/i);
}

function typeSelect() {
    return /** @type {HTMLSelectElement} */ (
        screen.getByText('Address type').parentElement.querySelector('select')
    );
}

async function submitWif(value = 'not a real key') {
    fireEvent.change(screen.getByLabelText(/WIF private key/i), { target: { value } });
    const pw = screen.queryByLabelText(/Wallet password/i);
    if (pw) fireEvent.change(pw, { target: { value: 'correct horse' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));
}

describe(' / D-64: address type follows the wallet, not just the chain', () => {
    it('defaults a counterwallet-legacy wallet to p2pkh', async () => {
        await openImportForm(messagingFor('counterwallet-legacy'));
        // The wallet format lands after the first render, so this is also the
        // regression guard for seeding the field from that first render.
        await waitFor(() => expect(typeSelect().value).toBe('p2pkh'));
    });

    it('imports on p2pkh for a legacy wallet without the user touching the field', async () => {
        const messaging = messagingFor('counterwallet-legacy');
        await openImportForm(messaging);
        await waitFor(() => expect(typeSelect().value).toBe('p2pkh'));

        await submitWif('cSV3exampleRegtestWifValue');
        await waitFor(() => expect(messaging.importWifRequest).toHaveBeenCalledTimes(1));
        // Explicit, never undefined: leaving it out lets the flow fall back
        // to the chain default, which is the bug one layer down.
        expect(messaging.importWifRequest.mock.calls[0][0].addressType).toBe('p2pkh');
    });

    it('leaves a bip39 wallet on the chain default', async () => {
        const messaging = messagingFor('bip39');
        await openImportForm(messaging);
        const expected = defaultRegistry().get('bitcoin-regtest').defaultAddressType;
        await waitFor(() => expect(typeSelect().value).toBe(expected));

        await submitWif('cSV3exampleRegtestWifValue');
        await waitFor(() => expect(messaging.importWifRequest).toHaveBeenCalledTimes(1));
        expect(messaging.importWifRequest.mock.calls[0][0].addressType).toBe(expected);
    });

    it('honours an explicit pick over the wallet default', async () => {
        const messaging = messagingFor('counterwallet-legacy');
        await openImportForm(messaging);
        await waitFor(() => expect(typeSelect().value).toBe('p2pkh'));

        fireEvent.change(typeSelect(), { target: { value: 'p2wpkh' } });
        await submitWif('cSV3exampleRegtestWifValue');
        await waitFor(() => expect(messaging.importWifRequest).toHaveBeenCalledTimes(1));
        expect(messaging.importWifRequest.mock.calls[0][0].addressType).toBe('p2wpkh');
    });

    it('falls back to the chain default when the wallet cannot be read', async () => {
        const messaging = messagingFor('counterwallet-legacy', {
            listWallets: vi.fn().mockRejectedValue(new Error('locked')),
        });
        await openImportForm(messaging);
        // Degrades to today's behaviour rather than to an empty select, which
        // would be handed straight to the flow.
        await waitFor(() => expect(typeSelect().value).toBeTruthy());
    });
});

describe(' / D-64: a rejected import reads as copy, not as a stack trace', () => {
    it('does not render the flow name or the library internal', async () => {
        const messaging = messagingFor('bip39', {
            importWifRequest: vi.fn(async () => {
                throw new Error('importWif: Failed to import WIF: Non-base58 character');
            }),
        });
        await openImportForm(messaging);
        await submitWif('nonsense');

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).not.toMatch(/importWif/);
        expect(alert.textContent).not.toMatch(/non-base58/i);
        expect(alert.textContent).toMatch(/private key/i);
    });

    it('passes the flow\'s own plain-language copy straight through', async () => {
        // The guard is a filter, not a translator: when the flow already
        // words it for the user, that wording is what the user sees.
        const messaging = messagingFor('bip39', {
            importWifRequest: vi.fn(async () => {
                throw new Error('That private key is for a different network. Pick the chain the key belongs to, or paste a key for this chain.');
            }),
        });
        await openImportForm(messaging);
        await submitWif('L1aWmainnetkey');

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/different network/i);
    });

    it('shows the duplicate-import rejection with its address intact', async () => {
        const messaging = messagingFor('bip39', {
            importWifRequest: vi.fn(async () => {
                throw new Error('This private key is already in this wallet (mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp).');
            }),
        });
        await openImportForm(messaging);
        await submitWif('cSV3exampleRegtestWifValue');

        const alert = await screen.findByRole('alert');
        expect(alert.textContent).toMatch(/already in this wallet/);
        expect(alert.textContent).toMatch(/mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp/);
    });
});

describe(' / D-64: the WIF placeholder matches the chain', () => {
    it('does not show a mainnet example on a regtest chain', async () => {
        await openImportForm(messagingFor('bip39'));
        const field = await screen.findByLabelText(/WIF private key/i);
        expect(field.getAttribute('placeholder')).not.toMatch(/L1aW/);
        // Regtest and testnet keys are 0xef-versioned: c... or 9...
        expect(field.getAttribute('placeholder')).toMatch(/c or 9/);
    });

    it('derives the hint from the descriptor, so every chain agrees with itself', () => {
        const reg = defaultRegistry();
        expect(wifPrefixHint(reg.get('bitcoin-mainnet'))).toMatch(/K, L or 5/);
        expect(wifPrefixHint(reg.get('bitcoin-regtest'))).toMatch(/c or 9/);
        expect(wifPrefixHint(reg.get('litecoin-mainnet'))).toMatch(/T or 6/);
        expect(wifPrefixHint(reg.get('dogecoin-mainnet'))).toMatch(/Q or 6/);
        expect(wifPrefixHint(reg.get('dogecoin-testnet'))).toMatch(/c or 9/);
    });

    it('degrades to generic copy for a chain with no known version byte', () => {
        expect(wifPrefixHint(null)).toBeNull();
        expect(wifPrefixHint({ wifVersionByte: 0x42 })).toBeNull();
    });
});
