// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DelegateVoteForm } from '../../../packages/core/src/shared/routes/DelegateVoteForm.jsx';
import { MigrateToBip39 } from '../../../packages/core/src/shared/routes/MigrateToBip39.jsx';
import { MintForm } from '../../../packages/core/src/shared/routes/MintForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messagingWith(overrides = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        listContacts: vi.fn().mockResolvedValue([]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN,
            tick: 'HELP',
            maxSupply: '1000',
            totalSupply: '500',
            mintMax: null,
            mintAddressMax: null,
            divisibility: 0,
            locks: {},
        }),
        getMintedAmountForAddress: vi.fn().mockResolvedValue({ amount: '0' }),
    };
    Object.assign(target, overrides);
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(Component, props, messaging = messagingWith()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Component {...props} />
        </MessagingProvider>,
    );
}

function expectCopyOutsideDescription(field, copy) {
    const ids = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const describedText = ids.map((id) => document.getElementById(id)?.textContent || '').join(' ');
    expect(describedText).not.toContain(copy);
}

async function expectHelp({ buttonName, copy, field }) {
    const button = await screen.findByRole('button', { name: buttonName });
    expectCopyOutsideDescription(field(), copy);
    fireEvent.click(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent(copy);
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.clearAllMocks();
});

describe('route field help tips', () => {
    it('puts the delegation explanation in the address label tip', async () => {
        mount(DelegateVoteForm, {
            walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {},
        });
        await screen.findByDisplayValue(ADDRESS.address);

        await expectHelp({
            buttonName: 'About Delegate to address',
            copy: 'The holder who will cast your weight on polls you do not vote on directly.',
            field: () => screen.getByLabelText('Delegate to address', { selector: 'input' }),
        });
    });

    it('puts the mint amount explanation in the amount label tip', async () => {
        mount(MintForm, {
            walletId: 'wallet-1', initialChainId: CHAIN, initialTick: 'HELP', onBack() {},
        });
        await screen.findByText(/500 HELP available to mint/);

        await expectHelp({
            buttonName: 'About Amount (HELP)',
            copy: 'How much to mint.',
            field: () => screen.getByLabelText(/^Amount\b/, { selector: 'input' }),
        });
    });

    it('puts the migration password purpose and limit in its field help', async () => {
        mount(MigrateToBip39, {
            legacyWalletId: 'wallet-old', onBack() {}, onMigrated() {}, onSweepChain() {},
        });
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        await screen.findByLabelText('Password', { selector: 'input' });

        await expectHelp({
            buttonName: 'About Password',
            copy: 'Encrypts the new wallet on this device. Use at least 8 characters.',
            field: () => screen.getByLabelText('Password', { selector: 'input' }),
        });
        expect(screen.queryByText(/At least \d+ characters\./)).toBeNull();
    });
});
