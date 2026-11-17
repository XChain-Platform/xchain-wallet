// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Subtoken template's Parent token field (operator ruling 2026-11-15): the
// wallet's standard token selector, opening the standard picker on the tokens
// this wallet owns (the getOwnedTokens list My tokens shows), with its search.
// A pick fills the field, the network and the owner as From; opened from a
// token the field arrives filled; with nothing owned the field and the picker
// say so. The ISSUE composed for a picked parent is the one a parent restored
// as text composes, so the payload is unchanged by the new field.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenWizard } from '../../../packages/core/src/shared/routes/TokenWizard.jsx';
import { pickParentToken } from '../../helpers/issueParentPicker.js';

const CHAIN = 'bitcoin-regtest';
const LTC_CHAIN = 'litecoin-regtest';
const WALLET = 'w-parent-picker';
const DRAFT_KEY = `xc:formdraft:issue-token:${WALLET}`;
const ADDR_1 = {
    id: 'addr-1',
    address: 'bcrt1qexampleexampleexampleexampleexample0',
    publicKey: '02ab',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
};
// The address that owns the parents; ADDR_1 is the default From.
const ADDR_2 = {
    id: 'addr-2',
    address: 'bcrt1qsecondsecondsecondsecondsecondsecond',
    publicKey: '02cd',
    derivationPath: "m/84'/1'/0'/0/1",
    source: 'hd',
};
const LTC_ADDR = {
    id: 'addr-ltc',
    address: 'rltc1qlitelitelitelitelitelitelitelitelite0',
    publicKey: '02ef',
    derivationPath: "m/84'/1'/0'/0/0",
    source: 'hd',
};

// Owned tokens by address: PARENT and PARENT.KID on bitcoin under ADDR_2, LTCOWN on litecoin.
const OWNED = {
    [ADDR_2.address]: [{ tick: 'PARENT' }, { tick: 'PARENT.KID' }],
    [LTC_ADDR.address]: [{ tick: 'LTCOWN' }],
};

function makeMessaging(overrides = {}) {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDR_1, ADDR_2], [LTC_CHAIN]: [LTC_ADDR] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: ADDR_1 }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'regtest' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listContacts: vi.fn().mockResolvedValue([]),
        getOwnedTokens: vi.fn(({ address }) => Promise.resolve(OWNED[address] || [])),
        // The wallet HOLDS a token it does not own (HELDONLY) beside its coin;
        // a held balance is not ownership, so it never lists as a parent.
        getWalletBalances: vi.fn((walletId, accountId, chainId) => Promise.resolve({
            [chainId]: chainId === CHAIN ? [{
                address: ADDR_1.address,
                balances: {
                    native: { tick: 'BTC', quantity: '100000', divisibility: 8 },
                    tokens: [{ tick: 'HELDONLY', quantity: '500', divisibility: 0 }],
                },
            }] : [],
        })),
        // Every parent is ADDR_2's; every PARENT.CHILD is free.
        getTokenInfo: vi.fn(({ tick }) => Promise.resolve(
            tick.includes('.CHILD') ? {} : { creator: ADDR_2.address },
        )),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        ...overrides,
    };
}

function mount(messaging, props = {}) {
    return render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(TokenWizard, { walletId: WALLET, onBack() {}, ...props }),
    ));
}

async function chooseSubtokenTemplate() {
    await screen.findByLabelText('Ticker');
    fireEvent.click(screen.getByRole('button', { name: /^Select template/ }));
    fireEvent.click(screen.getByRole('option', { name: /Subtoken/ }));
}

const fromAddress = () => screen.getByLabelText('From address').value;
const pickerRows = () => screen.queryAllByRole('button', { name: /^Select / })
    .map((button) => button.getAttribute('aria-label') || button.textContent);

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('Issue Token Parent token selector', () => {
    it('is labelled Parent token and is the token selector, not a text field', async () => {
        mount(makeMessaging());
        await chooseSubtokenTemplate();
        const field = await screen.findByRole('button', { name: /^Parent token: Select a token you own$/ });
        expect(field).toBeEnabled();
        expect(screen.queryByText(/Parent ticker/i)).toBeNull();
        expect(screen.queryByRole('textbox', { name: /parent/i })).toBeNull();
    });

    it('lists only the tokens this wallet owns, on every network, and filters them', async () => {
        const messaging = makeMessaging();
        mount(messaging);
        await chooseSubtokenTemplate();
        await screen.findByRole('button', { name: /^Parent token: Select a token you own$/ });
        fireEvent.click(screen.getByRole('button', { name: /^Parent token:/ }));
        await screen.findByRole('button', { name: /^Select PARENT on / });
        const rows = pickerRows();
        expect(rows).toHaveLength(3);
        expect(rows.some((name) => /^Select PARENT on /.test(name))).toBe(true);
        expect(rows.some((name) => /^Select PARENT\.KID on /.test(name))).toBe(true);
        expect(rows.some((name) => /^Select LTCOWN on /.test(name))).toBe(true);
        // The balance read answered with a held token and the coin; neither lists.
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: /^Select HELDONLY/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^Select BTC/ })).toBeNull();
        // Every address on every network was asked; only owned ticks list.
        expect(messaging.getOwnedTokens).toHaveBeenCalledWith({ chainId: CHAIN, address: ADDR_1.address });
        expect(messaging.getOwnedTokens).toHaveBeenCalledWith({ chainId: LTC_CHAIN, address: LTC_ADDR.address });

        // The picker's own search narrows the list.
        fireEvent.click(await screen.findByRole('button', { name: 'Filter coins and tokens' }));
        fireEvent.change((await screen.findAllByLabelText('Search coins or tokens'))[0], { target: { value: 'kid' } });
        await waitFor(() => expect(pickerRows()).toHaveLength(1));
        expect(pickerRows()[0]).toMatch(/^Select PARENT\.KID on /);
    });

    it('fills the field from a pick and moves Network and From to the owner', async () => {
        mount(makeMessaging());
        await chooseSubtokenTemplate();
        await waitFor(() => expect(fromAddress()).toBe(ADDR_1.address));
        await pickParentToken('LTCOWN');
        // The subtoken lives on its parent's network, signed by its owner.
        await waitFor(() => expect(fromAddress()).toBe(LTC_ADDR.address));
        await pickParentToken('PARENT');
        await waitFor(() => expect(fromAddress()).toBe(ADDR_2.address));
        expect(screen.getByRole('button', { name: /^Parent token: PARENT on / })).toBeTruthy();
    });

    it('arrives on the Subtoken template with the parent filled when opened from a token', async () => {
        mount(makeMessaging(), { initialChainId: CHAIN, initialParentTick: 'PARENT' });
        expect(await screen.findByRole('button', { name: /^Parent token: PARENT on / })).toBeTruthy();
        expect(screen.getByLabelText('Subtoken name')).toBeTruthy();
        // From becomes the parent's owner once ownership loads.
        await waitFor(() => expect(fromAddress()).toBe(ADDR_2.address));
        // The prefill is not typed input, so it makes no draft.
        await new Promise((resolve) => { setTimeout(resolve, 50); });
        expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    });

    it('says a subtoken needs a token you own when the wallet owns none', async () => {
        mount(makeMessaging({ getOwnedTokens: vi.fn().mockResolvedValue([]) }));
        await chooseSubtokenTemplate();
        const field = await screen.findByRole('button', { name: 'Parent token: A subtoken needs a token you own' });
        fireEvent.click(field);
        expect(await screen.findByText('You own no tokens yet')).toBeTruthy();
        expect(screen.queryAllByRole('button', { name: /^Select / })).toHaveLength(0);
    });

    it('does not call a failed read an empty list', async () => {
        mount(makeMessaging({ getOwnedTokens: vi.fn().mockRejectedValue(new Error('explorer 500')) }));
        await chooseSubtokenTemplate();
        const field = await screen.findByRole('button', { name: "Parent token: Couldn't load your tokens" });
        fireEvent.click(field);
        expect(await screen.findByText("Couldn't load your tokens")).toBeTruthy();
        expect(screen.queryByText('You own no tokens yet')).toBeNull();
    });

    it('reads the owned list again each time the picker opens', async () => {
        let explorerUp = false;
        const getOwnedTokens = vi.fn(({ address }) => (explorerUp
            ? Promise.resolve(OWNED[address] || [])
            : Promise.reject(new Error('explorer 500'))));
        mount(makeMessaging({ getOwnedTokens }));
        await chooseSubtokenTemplate();
        await screen.findByRole('button', { name: "Parent token: Couldn't load your tokens" });
        // The explorer recovers; opening the picker asks again and lists.
        explorerUp = true;
        await pickParentToken('PARENT');
        expect(screen.getByRole('button', { name: /^Parent token: PARENT on / })).toBeTruthy();
    });

    it('composes the same ISSUE for a picked parent as for the parent restored as text', async () => {
        // Picked on the selector.
        const picked = makeMessaging();
        mount(picked);
        await chooseSubtokenTemplate();
        await pickParentToken('PARENT');
        fireEvent.change(screen.getByLabelText('Subtoken name'), { target: { value: 'CHILD' } });
        fireEvent.change(screen.getByRole('textbox', { name: 'Max supply' }), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
        await waitFor(() => expect(picked.composeForConfirm).toHaveBeenCalledTimes(1));
        const pickedCall = picked.composeForConfirm.mock.calls[0][0];
        expect(pickedCall.actionData.params.TICK).toBe('PARENT.CHILD');
        cleanup();
        localStorage.clear();

        // The same choice as the string a draft holds, which is what the old
        // typed field produced.
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
            savedAt: Date.now(),
            network: 'regtest',
            values: {
                preset: 'subtoken', chainId: CHAIN, fromAddressId: ADDR_2.id,
                parentToken: 'PARENT', ticker: 'CHILD', supply: '5',
            },
        }));
        const typed = makeMessaging();
        mount(typed);
        fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
        await screen.findByRole('button', { name: /^Parent token: PARENT on / });
        fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
        await waitFor(() => expect(typed.composeForConfirm).toHaveBeenCalledTimes(1));
        const typedCall = typed.composeForConfirm.mock.calls[0][0];
        expect(pickedCall.actionData).toEqual(typedCall.actionData);
        expect(pickedCall.from.address).toBe(ADDR_2.address);
        expect(typedCall.from.address).toBe(ADDR_2.address);
    });
});
