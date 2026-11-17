// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { selectOption } from '../../../helpers/selectOption.js';
import { existingListRowText } from '../../../../packages/core/src/shared/utils/existingListRowText.js';
import { __clearTokenInfoCache } from '../../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const TOKEN = 'DROP';
const LIST_INDEX = '2700';
const UNION_COPY = 'This list combines other lists, so this wallet cannot count its recipients.';
const ADDRESS = {
    id: 'addr-btc',
    address: SOURCE,
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

function listRow({ type = '2', name, actionIndex = LIST_INDEX } = {}) {
    const row = {
        action_index: actionIndex,
        block_index: 10,
        status: 'valid',
        type,
        source: SOURCE,
        list: type === '1' ? ['HOLDERS'] : ['bc1qrecipient'],
    };
    if (name !== undefined) row.name = name;
    return row;
}

function mountAirdrop(row, overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            chainId: CHAIN, tick: TOKEN, divisibility: 0, locks: {},
        }),
        getHoldersForToken: vi.fn().mockResolvedValue({ tick: 'HOLDERS', total: 1, data: [] }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: TOKEN, quantity: '1000', divisibility: 0 }],
                },
            }],
        }),
        searchTokens: vi.fn().mockResolvedValue([]),
        getListsForSource: vi.fn().mockResolvedValue([row]),
        getListByActionIndex: vi.fn().mockResolvedValue(row),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn(),
        airdropAction: vi.fn(),
        ...overrides,
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AirdropForm
                walletId="wallet-1"
                initialChainId={CHAIN}
                initialTick={TOKEN}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

async function chooseExistingList(row) {
    mountAirdrop(row);
    selectOption(await screen.findByLabelText(/^Airdrop to/), 'existing');
    fireEvent.click(await screen.findByRole('button', { name: /^List:/ }));
    fireEvent.click(await screen.findByRole('button', {
        name: existingListRowText(row),
    }));
}

// The List field reads the chosen list's name (or List #N when it has none).
const listField = (text) => screen.findByRole('button', { name: `List: ${text}` });

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.clearAllMocks();
});

describe('AirdropForm existing-list name', () => {
    it('shows the address list name in the List field after selection', async () => {
        await chooseExistingList(listRow({ name: 'Treasury wallets' }));

        expect(await listField('Treasury wallets (List #2700)')).toBeTruthy();
    });

    it('shows the token list name in the List field after selection', async () => {
        await chooseExistingList(listRow({ type: '1', name: 'Token holders' }));

        expect(await listField('Token holders (List #2700)')).toBeTruthy();
    });

    it('labels a union and refuses to review an uncountable recipient set', async () => {
        await chooseExistingList(listRow({ type: '3', name: 'Combined recipients' }));

        expect(await screen.findByText(new RegExp(UNION_COPY))).toBeTruthy();
        expect(screen.queryByText(/0 addresses on this list/)).toBeNull();
        expect(screen.queryByText(/address list/)).toBeNull();

        fireEvent.change(screen.getByLabelText(/^Per-recipient amount/), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review Airdrop' }));

        expect(screen.getByRole('alert')).toHaveTextContent(UNION_COPY);
        expect(screen.getByRole('form', { name: 'Token airdrop' })).toBeTruthy();
    });

    it.each([
        ['an absent name', undefined],
        ['an empty name', ''],
    ])('falls back to List #N in the field for %s', async (_case, name) => {
        await chooseExistingList(listRow({ name }));

        expect(await listField('List #2700')).toBeTruthy();
    });

    it('does not offer a list the network refused', async () => {
        mountAirdrop({ ...listRow(), status: 'invalid: LIST_ACTION_INDEX (not owner)' });
        selectOption(await screen.findByLabelText(/^Airdrop to/), 'existing');
        fireEvent.click(await screen.findByRole('button', { name: /^List:/ }));

        expect(await screen.findByText('No published lists yet')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /address list/i })).toBeNull();
    });

    it('neutralizes U+202E in a loaded list name', async () => {
        await chooseExistingList(listRow({ name: 'Safe\u202Eevil' }));

        expect(await listField('Safe\u2426evil (List #2700)')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /\u202E/ })).toBeNull();
    });

    it('review displays the exact built amount with its asset and Back keeps the form values', async () => {
        await chooseExistingList(listRow({ name: 'Treasury wallets' }));
        const amount = screen.getByLabelText(/^Per-recipient amount/);
        fireEvent.change(amount, { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review Airdrop' }));

        // The sentence states the built amount and asset (no Total block,
        // G127 revised 2026-11-16).
        expect(await screen.findByTestId('confirm-sentence')).toHaveTextContent('Airdrop 5 DROP to list #2700');
        expect(screen.getByText('#2700')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(await screen.findByLabelText(/^Per-recipient amount/)).toHaveValue('5');
        expect(screen.getByRole('button', { name: 'List: Treasury wallets (List #2700)' })).toBeTruthy();
    });

    it('refuses a malformed selected list id before review', async () => {
        const row = listRow({ actionIndex: 'bad-id' });
        await chooseExistingList(row);
        fireEvent.change(screen.getByLabelText(/^Per-recipient amount/), { target: { value: '5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review Airdrop' }));

        expect(screen.getByRole('alert')).toHaveTextContent(
            'The selected list has an invalid action index. Choose the list again.',
        );
        expect(screen.getByRole('form', { name: 'Token airdrop' })).toBeTruthy();
    });

    it('turns an indexer list-load failure into plain copy without its request URL', async () => {
        const error = Object.assign(
            new Error('Explorer returned HTTP 502 for /BTC/api/lists/source/private-address'),
            { name: 'SDKExplorerError' },
        );
        mountAirdrop(listRow(), { getListsForSource: vi.fn().mockRejectedValue(error) });
        selectOption(await screen.findByLabelText(/^Airdrop to/), 'existing');
        fireEvent.click(await screen.findByRole('button', { name: /^List:/ }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent("Couldn't load your lists.");
        expect(alert.textContent).not.toContain('/BTC/api/');
        expect(alert.textContent).not.toContain('Explorer returned');
    });
});
