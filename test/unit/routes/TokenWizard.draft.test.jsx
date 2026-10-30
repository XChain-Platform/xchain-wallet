// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Token wizard keeps the resumable draft Issue token keeps: form values
// only, scoped to the wallet and the network, written once the user has
// typed something, offered back behind a Restore banner after any unmount
// (lock, auto-lock, reload, popup close), and dropped on Discard and on a
// confirmed issuance.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

const CHAIN = 'bitcoin-regtest';
const WALLET = 'w-wizard-draft';
const KEY = `xc:formdraft:token-wizard:${WALLET}`;
const ADDR_1 = {
    id: 'addr-1',
    address: 'bcrt1qexampleexampleexampleexampleexample0',
    publicKey: '02ab',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
};
const ADDR_2 = {
    id: 'addr-2',
    address: 'bcrt1qsecondsecondsecondsecondsecondsecond',
    publicKey: '02cd',
    derivationPath: "m/84'/1'/0'/0/1",
    source: 'hd',
};

function makeMessaging(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDR_1, ADDR_2] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDR_1 }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'regtest' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        reserve: vi.fn().mockResolvedValue({}),
        releaseReservation: vi.fn().mockResolvedValue({}),
        releaseEncoderInputs: vi.fn().mockResolvedValue({}),
        issueToken: vi.fn().mockResolvedValue({ txid: 'ef'.repeat(32) }),
        ...overrides,
    };
}

function mount(messaging, walletId = WALLET) {
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenWizard, { walletId, onBack() {} }),
    ));
}

async function reachDetails(template = 'Utility token') {
    fireEvent.click(await screen.findByText(template));
    await screen.findByLabelText('Fee paid by');
    fireEvent.submit(screen.getByRole('form', { name: 'Choose token network' }));
    await screen.findByText('Step 3 of 4: Details');
}

function stored() {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('TokenWizard draft', () => {
    it('saves typed details and restores them on Details after a remount', async () => {
        const messaging = makeMessaging();
        const first = mount(messaging);
        await reachDetails();
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'DRAFTY' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '4200' } });
        fireEvent.click(screen.getByRole('switch', { name: /Divisible/ }));
        fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'kept' } });

        await waitFor(() => {
            expect(stored()?.values).toMatchObject({
                template: 'utility', chainId: CHAIN, name: 'DRAFTY', supply: '4200',
                divisible: true, description: 'kept',
            });
        });
        expect(stored().network).toBe('regtest');
        expect(stored().values).not.toHaveProperty('password');
        expect(stored().values).not.toHaveProperty('stage');

        // Lock, auto-lock, reload and popup close all unmount the route; the
        // next visit starts on Template with the banner and nothing submitted.
        first.unmount();
        mount(messaging);
        expect(await screen.findByText(/Nothing was submitted\./)).toBeInTheDocument();
        expect(screen.getByText('Step 1 of 4: Template')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await screen.findByText('Step 3 of 4: Details');
        expect(screen.getByLabelText('Token name (ticker)')).toHaveValue('DRAFTY');
        expect(screen.getByLabelText('Supply')).toHaveValue('4200');
        expect(screen.getByRole('switch', { name: /Divisible/ })).toBeChecked();
        expect(screen.getByLabelText('Description (optional)')).toHaveValue('kept');
        expect(screen.queryByText(/Nothing was submitted\./)).toBeNull();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(messaging.issueToken).not.toHaveBeenCalled();

        // Restored values keep autosaving.
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '4300' } });
        await waitFor(() => expect(stored()?.values.supply).toBe('4300'));
    });

    it('saves nothing for a template and network the user only clicked through', async () => {
        mount(makeMessaging());
        await reachDetails('Meme token');
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(localStorage.getItem(KEY)).toBeNull();

        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'X' } });
        await waitFor(() => expect(stored()?.values.name).toBe('X'));
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: '' } });
        await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    });

    it('drops the draft on Discard and saves what is typed next', async () => {
        localStorage.setItem(KEY, JSON.stringify({
            savedAt: Date.now(),
            network: 'regtest',
            values: { template: 'meme', chainId: CHAIN, name: 'OLDNAME', supply: '1' },
        }));
        mount(makeMessaging());
        expect(await screen.findByText(/Nothing was submitted\./)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Discard saved draft' }));
        expect(localStorage.getItem(KEY)).toBeNull();
        expect(screen.queryByText(/Nothing was submitted\./)).toBeNull();

        await reachDetails('Meme token');
        expect(screen.getByLabelText('Token name (ticker)')).toHaveValue('');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'NEWNAME' } });
        await waitFor(() => expect(stored()?.values.name).toBe('NEWNAME'));
    });

    it('never offers a draft to another wallet or on another network', async () => {
        const record = JSON.stringify({
            savedAt: Date.now(),
            network: 'testnet',
            values: { template: 'meme', chainId: CHAIN, name: 'TESTNETONLY', supply: '1' },
        });
        localStorage.setItem(KEY, record);
        localStorage.setItem('xc:formdraft:token-wizard:other-wallet', JSON.stringify({
            savedAt: Date.now(),
            network: 'regtest',
            values: { template: 'meme', chainId: CHAIN, name: 'OTHERWALLET', supply: '1' },
        }));
        mount(makeMessaging());
        await screen.findByText('Step 1 of 4: Template');
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(screen.queryByText(/Nothing was submitted\./)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();

        // Typing on this network writes this network's draft, and the other
        // wallet's record is never touched.
        await reachDetails('Meme token');
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'REGTEST' } });
        await waitFor(() => expect(stored()?.values.name).toBe('REGTEST'));
        expect(stored().network).toBe('regtest');
        expect(localStorage.getItem('xc:formdraft:token-wizard:other-wallet')).toContain('OTHERWALLET');
    });

    it('restores a signer the user chose by hand', async () => {
        localStorage.setItem(KEY, JSON.stringify({
            savedAt: Date.now(),
            network: 'regtest',
            values: {
                template: 'subtoken', chainId: CHAIN, fromAddressId: 'addr-2', sourceChosen: true,
                parentToken: 'PARENT', name: 'CHILD', supply: '5',
            },
        }));
        mount(makeMessaging());
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
        await screen.findByText('Step 3 of 4: Details');
        expect(screen.getByLabelText('Parent ticker')).toHaveValue('PARENT');
        expect(screen.getByLabelText('Subtoken name')).toHaveValue('CHILD');
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(await screen.findByLabelText('Fee paid by')).toHaveValue(ADDR_2.address);
    });

    it('clears the draft once the confirm page issues the token', async () => {
        const messaging = makeMessaging();
        const first = mount(messaging);
        await reachDetails();
        fireEvent.change(screen.getByLabelText('Token name (ticker)'), { target: { value: 'ISSUED' } });
        fireEvent.change(screen.getByLabelText('Supply'), { target: { value: '10' } });
        await waitFor(() => expect(stored()?.values.name).toBe('ISSUED'));

        fireEvent.submit(screen.getByRole('form', { name: 'Token details' }));
        await screen.findByText('Step 4 of 4: Review');
        fireEvent.submit(screen.getByRole('form', { name: 'Review token issuance' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await screen.findByText('ef'.repeat(32));
        expect(messaging.issueToken).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem(KEY)).toBeNull();

        first.unmount();
        mount(messaging);
        await screen.findByText('Step 1 of 4: Template');
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(screen.queryByText(/Nothing was submitted\./)).toBeNull();
    });
});
