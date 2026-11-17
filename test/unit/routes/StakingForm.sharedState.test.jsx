// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The one Staking form owns one set of values. Switching the action (or the
// target) only shows and hides fields: the From address, the amount and the
// signing key the user typed, and the fee speed all stay. A key the form
// filled in itself gives way to the next action's own fill.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { StakingForm } from '../../../packages/core/src/shared/routes/StakingForm.jsx';
import { openSection } from '../../helpers/openFormSections.js';

const CHAIN = 'bitcoin-mainnet';
const KEY = 'ab'.repeat(32);
const OTHER_KEY = 'cd'.repeat(32);
const SOURCE = {
    id: 'a1',
    address: 'bc1qstakerstakerstakerstakerstakerstakers',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const SECOND = {
    id: 'a2',
    address: 'bc1qsecondsecondsecondsecondsecondsecondx',
    publicKey: '02cd',
    derivationPath: "m/84'/0'/0'/0/1",
    source: 'hd',
};

function methods(overrides = {}) {
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE, SECOND] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        listWallets: vi.fn().mockResolvedValue([{ id: 'w', name: 'W', walletMode: 'full' }]),
        getStakesForAddress: vi.fn().mockResolvedValue([{ signing_pubkey: OTHER_KEY, status: 'valid', amount: '100' }]),
        getDelegationsForAddress: vi.fn().mockResolvedValue([]),
        getRewardsForAddress: vi.fn().mockResolvedValue([]),
        getRewardClaimsForAddress: vi.fn().mockResolvedValue([]),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getContractByActionIndex: vi.fn().mockResolvedValue({ row: { cooldown_blocks: 288, meta_name: 'Yield Vault' } }),
        getContractStakesForAddress: vi.fn().mockResolvedValue([]),
        ...overrides,
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(props, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <StakingForm walletId="w" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

async function chooseAction(current, next) {
    fireEvent.click(screen.getByRole('button', { name: `Action: ${current}` }));
    fireEvent.click(await screen.findByRole('option', { name: next }));
}

async function pickFast() {
    await openSection('Speed and Fees');
    fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), { target: { value: '2' } });
    expect(screen.getByRole('slider', { name: 'Network fee' }).getAttribute('aria-valuetext')).toMatch(/^Fast/);
}

// The amount field may pad a token amount to its precision ("3.00000000").
function amountValue() {
    return Number(screen.getByLabelText(/^Amount/).value.replace(/,/g, ''));
}

afterEach(() => {
    cleanup();
    resetWalletModes();
    vi.clearAllMocks();
});

describe('the Staking form keeps its values across a switch of action', () => {
    it('keeps the From address, the typed amount and key, and the fee speed on the network', async () => {
        const messaging = methods();
        // Opened from a position on the wallet's second address, not the active one.
        mount({ target: { kind: 'network', chainId: CHAIN }, action: 'stake', initialFromAddress: SECOND.address }, messaging);

        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '5' } });
        fireEvent.change(screen.getByLabelText('Signing public key'), { target: { value: KEY } });
        await openSection('From');
        expect(screen.getByLabelText('From address')).toHaveValue(SECOND.address);
        await pickFast();

        // Delegate has no amount; its key field holds the key the user typed.
        await chooseAction('Stake', 'Delegate');
        expect(screen.queryByLabelText(/^Amount/)).toBeNull();
        expect(screen.getByLabelText('New signing pubkey')).toHaveValue(KEY);
        expect(screen.getByRole('slider', { name: 'Network fee' }).getAttribute('aria-valuetext')).toMatch(/^Fast/);

        // Unstake shows the typed amount, not the staked balance, and the typed
        // key, not the key the form would fill in.
        await chooseAction('Delegate', 'Unstake');
        expect(amountValue()).toBe(5);
        expect(screen.getByLabelText('Signing public key')).toHaveValue(KEY);

        await chooseAction('Unstake', 'Stake');
        expect(amountValue()).toBe(5);
        expect(screen.getByLabelText('Signing public key')).toHaveValue(KEY);
        expect(screen.getByRole('slider', { name: 'Network fee' }).getAttribute('aria-valuetext')).toMatch(/^Fast/);
        await openSection('From');
        expect(screen.getByLabelText('From address')).toHaveValue(SECOND.address);
        // The switch only showed and hid fields; nothing reloaded the addresses.
        expect(messaging.getAddressesByChain).toHaveBeenCalledTimes(1);
    });

    it('keeps the amount, key and fee speed across the contract toggle', async () => {
        mount({ target: { kind: 'contract', chainId: CHAIN, contractActionIndex: '2048' }, action: 'stake' }, methods());

        fireEvent.change(await screen.findByLabelText(/^Amount/), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText('Signing Key'), { target: { value: KEY } });
        await pickFast();

        fireEvent.click(screen.getByRole('radio', { name: 'Unstake' }));
        expect(amountValue()).toBe(3);
        expect(screen.getByLabelText('Signing Key')).toHaveValue(KEY);

        fireEvent.click(screen.getByRole('radio', { name: 'Delegate' }));
        expect(screen.queryByLabelText(/^Amount/)).toBeNull();
        expect(screen.getByLabelText('New Signing Key')).toHaveValue(KEY);

        fireEvent.click(screen.getByRole('radio', { name: 'Stake' }));
        expect(amountValue()).toBe(3);
        expect(screen.getByLabelText('Signing Key')).toHaveValue(KEY);
        expect(screen.getByRole('slider', { name: 'Network fee' }).getAttribute('aria-valuetext')).toMatch(/^Fast/);
    });

    it('drops a key it filled in itself when the action changes', async () => {
        const messaging = methods({
            getDelegationsForAddress: vi.fn().mockResolvedValue([{ action_index: 1, signing_pubkey: OTHER_KEY, status: 'valid' }]),
        });
        mount({ target: { kind: 'network', chainId: CHAIN }, action: 'revoke' }, messaging);

        await waitFor(() => expect(screen.getByLabelText('Signing pubkey to revoke')).toHaveValue(OTHER_KEY));

        // The active delegation is the key to revoke, never a new key to delegate to.
        await chooseAction('Revoke', 'Delegate');
        expect(screen.getByLabelText('New signing pubkey')).toHaveValue('');
    });
});
