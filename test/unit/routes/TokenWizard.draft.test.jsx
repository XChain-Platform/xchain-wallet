// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Create a token route (the one Issue Token form) keeps a resumable
// draft: form values only, scoped to the wallet and the network, written once
// the user has typed something, offered back behind a Restore banner after any
// unmount (lock, auto-lock, reload, popup close), and dropped on Discard and
// on a confirmed issuance.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
// The Create a token route: TokenWizard renders the one Issue Token form.
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';

const CHAIN = 'bitcoin-regtest';
const WALLET = 'w-wizard-draft';
// The form's own draft view (useFormDraft `issue-token`).
const KEY = `xc:formdraft:issue-token:${WALLET}`;
const OTHER_WALLET_KEY = 'xc:formdraft:issue-token:other-wallet';
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

// The form, loaded with its source resolved.
async function reachForm() {
    await screen.findByLabelText('Ticker');
    await waitFor(() => expect(screen.getByLabelText('From address').value).not.toBe(''));
}

const tickerField = () => screen.getByRole('textbox', { name: /^(Ticker|Subtoken name)$/, hidden: true });
const supplyField = () => screen.getByRole('textbox', { name: 'Max supply' });
const divisibleSwitch = () => screen.getByRole('switch', { name: /Divisible/ });

function stored() {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
}

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('Issue Token draft', () => {
    it('saves typed details and restores them after a remount', async () => {
        const messaging = makeMessaging();
        const first = mount(messaging);
        await reachForm();
        fireEvent.change(tickerField(), { target: { value: 'DRAFTY' } });
        fireEvent.change(supplyField(), { target: { value: '4200' } });
        // Divisible starts on; turning it off is a choice the draft keeps.
        fireEvent.click(divisibleSwitch());
        fireEvent.change(screen.getByLabelText('Token description'), { target: { value: 'kept' } });

        await waitFor(() => {
            expect(stored()?.values).toMatchObject({
                chainId: CHAIN, ticker: 'DRAFTY', supply: '4200',
                divisible: false, description: 'kept',
            });
        });
        expect(stored().network).toBe('regtest');
        expect(stored().values).not.toHaveProperty('password');
        expect(stored().values).not.toHaveProperty('stage');

        // Lock, auto-lock, reload and popup close all unmount the route; the
        // next visit opens an empty form with the banner and nothing submitted.
        first.unmount();
        mount(messaging);
        expect(await screen.findByText(/Nothing was submitted\./)).toBeInTheDocument();
        expect(tickerField()).toHaveValue('');
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await waitFor(() => expect(tickerField()).toHaveValue('DRAFTY'));
        expect(supplyField().value.replace(/,/g, '')).toMatch(/^4200(\.0+)?$/);
        expect(divisibleSwitch()).not.toBeChecked();
        expect(screen.getByLabelText('Token description')).toHaveValue('kept');
        expect(screen.queryByText(/Nothing was submitted\./)).toBeNull();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(messaging.issueToken).not.toHaveBeenCalled();

        // Restored values keep autosaving.
        fireEvent.change(supplyField(), { target: { value: '4300' } });
        await waitFor(() => expect(stored()?.values.supply).toBe('4300'));
    });

    it('saves nothing for a form the user only opened, and drops a draft emptied again', async () => {
        mount(makeMessaging());
        await reachForm();
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(localStorage.getItem(KEY)).toBeNull();

        fireEvent.change(tickerField(), { target: { value: 'X' } });
        await waitFor(() => expect(stored()?.values.ticker).toBe('X'));
        fireEvent.change(tickerField(), { target: { value: '' } });
        await waitFor(() => expect(localStorage.getItem(KEY)).toBeNull());
    });

    it('drops the draft on Discard and saves what is typed next', async () => {
        localStorage.setItem(KEY, JSON.stringify({
            savedAt: Date.now(),
            network: 'regtest',
            values: { preset: 'meme', chainId: CHAIN, ticker: 'OLDNAME', supply: '1' },
        }));
        mount(makeMessaging());
        expect(await screen.findByText(/Nothing was submitted\./)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Discard saved draft' }));
        expect(localStorage.getItem(KEY)).toBeNull();
        expect(screen.queryByText(/Nothing was submitted\./)).toBeNull();

        expect(tickerField()).toHaveValue('');
        fireEvent.change(tickerField(), { target: { value: 'NEWNAME' } });
        await waitFor(() => expect(stored()?.values.ticker).toBe('NEWNAME'));
    });

    it('never offers a draft to another wallet or on another network', async () => {
        const record = JSON.stringify({
            savedAt: Date.now(),
            network: 'testnet',
            values: { preset: 'meme', chainId: CHAIN, ticker: 'TESTNETONLY', supply: '1' },
        });
        localStorage.setItem(KEY, record);
        localStorage.setItem(OTHER_WALLET_KEY, JSON.stringify({
            savedAt: Date.now(),
            network: 'regtest',
            values: { preset: 'meme', chainId: CHAIN, ticker: 'OTHERWALLET', supply: '1' },
        }));
        mount(makeMessaging());
        await reachForm();
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(screen.queryByText(/Nothing was submitted\./)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();

        // Typing on this network writes this network's draft, and the other
        // wallet's record is never touched.
        fireEvent.change(tickerField(), { target: { value: 'REGTEST' } });
        await waitFor(() => expect(stored()?.values.ticker).toBe('REGTEST'));
        expect(stored().network).toBe('regtest');
        expect(localStorage.getItem(OTHER_WALLET_KEY)).toContain('OTHERWALLET');
    });

    it('restores a subtoken and a signer the user chose by hand', async () => {
        localStorage.setItem(KEY, JSON.stringify({
            savedAt: Date.now(),
            network: 'regtest',
            values: {
                preset: 'subtoken', chainId: CHAIN, fromAddressId: 'addr-2',
                parentToken: 'PARENT', ticker: 'CHILD', supply: '5',
            },
        }));
        mount(makeMessaging());
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
        expect(await screen.findByLabelText('Parent ticker')).toHaveValue('PARENT');
        expect(screen.getByLabelText('Subtoken name')).toHaveValue('CHILD');
        // The signer sits in the From section; the restored one stands.
        await waitFor(() => expect(screen.getByLabelText('From address')).toHaveValue(ADDR_2.address));
    });

    it('clears the draft once the confirm page issues the token', async () => {
        const messaging = makeMessaging();
        const first = mount(messaging);
        await reachForm();
        fireEvent.change(tickerField(), { target: { value: 'ISSUED' } });
        fireEvent.change(supplyField(), { target: { value: '10' } });
        await waitFor(() => expect(stored()?.values.ticker).toBe('ISSUED'));

        fireEvent.submit(screen.getByRole('form', { name: 'Issue Token' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve).toBeEnabled());
        fireEvent.click(approve);
        await screen.findByText('ef'.repeat(32));
        expect(messaging.issueToken).toHaveBeenCalledTimes(1);
        expect(messaging.issueToken.mock.calls[0][0].params).toMatchObject({ TICK: 'ISSUED', MAX_SUPPLY: '10' });
        expect(localStorage.getItem(KEY)).toBeNull();

        first.unmount();
        mount(messaging);
        await reachForm();
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(screen.queryByText(/Nothing was submitted\./)).toBeNull();
    });
});
