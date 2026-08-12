// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Send was the only action form with no source picker.
//
// Found by a failed access-list run on Litecoin regtest. A wallet with three
// addresses on the chain had issued its token from the NEWEST one, because that
// is where IssueTokenForm and every other admin form default their From. Send
// resolves its source to the chain's ACTIVE address instead, and rendered it
// nowhere on the compose form. So the asset picker (wallet-scoped) offered the
// token, the amount field took it, and compose died with the encoder's own words:
// "no spendable UTXOs found for the funding address" - a sentence about UTXOs,
// from which "go to Addresses, pick the other one, press Use" is not discoverable.
//
// The fix gives Send the same OwnAddressPickerScreen From field the other 26
// forms carry, so the two scopes can be reconciled without leaving the screen.
// These pin: the field exists and shows the funding address, the picker changes
// what gets funded, the choice survives (it is not overwritten by the
// active-address default), and the screen says so when the funding address holds
// none of the selected token.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

// The real picker is the whole AddressList screen (search, network segments,
// add-address). Stubbed to a single button so these cases stay about SEND's
// wiring; that the From field routes to the shared component at all is pinned by
// its icon label below, which is the exact string the other 26 forms use.
vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ title, chainId, onPick }) => React.createElement(
        'div',
        null,
        React.createElement('h1', null, title),
        React.createElement('span', { 'data-testid': 'picker-chain' }, chainId),
        React.createElement(
            'button',
            { type: 'button', onClick: () => onPick({ id: 'addr-2', address: ISSUER, publicKey: '02cd', derivationPath: "m/84'/2'/0'/0/2", source: 'hd' }) },
            'pick issuer address',
        ),
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';

const CHAIN = 'litecoin-mainnet';
// The ACTIVE address (Send's default source) and the NEWEST one, where the token
// was issued. Real litecoin mainnet bech32: the form decodes addresses.
const ACTIVE = 'ltc1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zuxktx9';
const ISSUER = 'ltc1qzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3nmndwj';
const DESTINATION = 'ltc1qxvenxvenxvenxvenxvenxvenxvenxvenwcpknh';

const ADDRESSES = {
    [CHAIN]: [
        { id: 'addr-1', address: ACTIVE, publicKey: '02ab', derivationPath: "m/84'/2'/0'/0/0", source: 'hd' },
        { id: 'addr-2', address: ISSUER, publicKey: '02cd', derivationPath: "m/84'/2'/0'/0/2", source: 'hd' },
    ],
};

const TOKEN = 'ACCESSLIST';

/**
 * Balances as the venue had them: the token sits at the issuer address only,
 * and the active address holds nothing but coin.
 */
function balancesFor(address) {
    const native = { tick: 'LTC', quantity: '100000000', divisibility: 8 };
    return address === ISSUER
        ? { native, tokens: [{ tick: TOKEN, quantity: '100000000000', divisibility: 8 }] }
        : { native, tokens: [] };
}

function mount() {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: 'addr-1', address: ACTIVE } }),
        getAddressBalances: vi.fn(async (_chainId, address) => balancesFor(address)),
        getSettings: vi.fn().mockResolvedValue({ grace: { testSendThresholdSats: 0 } }),
        getSignerStatus: vi.fn().mockResolvedValue({ unlocked: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
        gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|…', version: 1,
        }),
        sendToken: vi.fn().mockResolvedValue({ txid: 'deadbeef' }),
        getAddressHistory: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Send, { walletId: 'w', onBack() {} }),
        ),
    );
    return messaging;
}

const fromField = () => screen.getByLabelText(/^From$/);
const pickerButton = () => screen.getByRole('button', { name: 'Choose source address' });
const sendButton = () => screen.getByRole('button', { name: /^Send$/ });

async function selectToken() {
    fireEvent.change(await screen.findByLabelText(/^Token$/), { target: { value: TOKEN } });
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Send: the funding address is shown and changeable', () => {
    it('renders the funding address on the compose form, defaulted to the active one', async () => {
        mount();
        await waitFor(() => expect(fromField().value).toBe(ACTIVE));
    });

    it('routes to the shared picker under the same label the other forms use', async () => {
        mount();
        await waitFor(() => expect(fromField().value).toBe(ACTIVE));
        fireEvent.click(pickerButton());
        expect(await screen.findByText('From address')).toBeInTheDocument();
        // Seeded to the form's chain, so the relevant addresses show first.
        expect(screen.getByTestId('picker-chain').textContent).toBe(CHAIN);
    });

    it('[REGRESSION] funds the send from the picked address, not the active one', async () => {
        const messaging = mount();
        await waitFor(() => expect(fromField().value).toBe(ACTIVE));

        fireEvent.click(pickerButton());
        fireEvent.click(await screen.findByRole('button', { name: /pick issuer address/i }));
        await waitFor(() => expect(fromField().value).toBe(ISSUER));

        await selectToken();
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: DESTINATION } });
        fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '5' } });
        fireEvent.click(sendButton());

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalled());
        const payload = messaging.composeForConfirm.mock.calls[0][0];
        expect(payload.from.address).toBe(ISSUER);
    });

    it('the picked address is not overwritten by the active-address default', async () => {
        mount();
        await waitFor(() => expect(fromField().value).toBe(ACTIVE));
        fireEvent.click(pickerButton());
        fireEvent.click(await screen.findByRole('button', { name: /pick issuer address/i }));
        await waitFor(() => expect(fromField().value).toBe(ISSUER));

        // The defaulting effect re-runs on any of its inputs changing; a pick made
        // on this chain has to survive it, or the field would snap back mid-compose.
        await selectToken();
        await new Promise((r) => { setTimeout(r, 50); });
        expect(fromField().value).toBe(ISSUER);
    });

    it('says so when the funding address holds none of the selected token', async () => {
        mount();
        await waitFor(() => expect(fromField().value).toBe(ACTIVE));
        await selectToken();

        const said = await screen.findByText(/holds no ACCESSLIST/i);
        // Names ADDRESSES, which is the thing the user can act on. The encoder's
        // own answer named UTXOs, which is what made the fix undiscoverable.
        expect(said.textContent).toMatch(/From field/i);
    });

    it('the warning clears once the funding address is switched to one that holds it', async () => {
        mount();
        await waitFor(() => expect(fromField().value).toBe(ACTIVE));
        await selectToken();
        await screen.findByText(/holds no ACCESSLIST/i);

        fireEvent.click(pickerButton());
        fireEvent.click(await screen.findByRole('button', { name: /pick issuer address/i }));
        await waitFor(() => expect(screen.queryByText(/holds no ACCESSLIST/i)).toBeNull());
    });
});
