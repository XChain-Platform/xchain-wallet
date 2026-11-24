// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { ListTransferRoute as ListTransferForm } from '../../helpers/listFormRoutes.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWNER = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const DESTINATION = '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs';
const OWNER_RECORD = Object.freeze({
    id: 'owner-address',
    address: OWNER,
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-owner',
});
const ACTIVE_RECORD = Object.freeze({
    id: 'active-address',
    address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT',
    publicKey: '02bb',
    derivationPath: "m/84'/0'/0'/0/1",
    source: 'hd',
    signerId: 'signer-active',
});
const COMPOSED = Object.freeze({
    psbt: 'aa00',
    encoding: 'psbt',
    actionString: `LIST|3|2700|${DESTINATION}|handoff`,
    version: 1,
    actionWarnings: ['LIST_TRANSFER'],
    // The compose quote's free answer, which composeActionForConfirm sets for
    // a transfer; the form's own zero no longer hides the unknown fee row.
    protocolFeeKnownFree: true,
});

function makeMessaging({ walletMode = 'full', listError = null, listExtra = {} } = {}) {
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode }], activeWalletId: 'wallet-1' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ACTIVE_RECORD, OWNER_RECORD] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({}),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'W', walletMode }]),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockImplementation(async () => {
            if (listError) throw listError;
            return {
                action_index: 2700,
                source: OWNER,
                state: { owner: OWNER },
                ...listExtra,
            };
        }),
        getActionFormats: vi.fn().mockResolvedValue({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            2: 'VERSION|LIST_ACTION_INDEX|MEMO',
            3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
        }),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn().mockResolvedValue({ txid: 'transfer-txid' }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'bb00' }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount({
    support = { share: true, transfer: true, union: true }, supportError = false,
    actionIndex = '2700', ...options
} = {}) {
    if (supportError) listFormatSupport.mockRejectedValue(new Error('support lookup failed'));
    else listFormatSupport.mockResolvedValue(support);
    const messaging = makeMessaging(options);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ListTransferForm
                walletId="wallet-1"
                listRef={{ chainId: CHAIN, actionIndex, source: OWNER }}
                onBack={() => {}}
                onDone={() => {}}
            />
        </MessagingProvider>,
    );
    return messaging;
}

async function fillTransfer({ destination = DESTINATION, memo = '' } = {}) {
    fireEvent.change(await screen.findByLabelText('New owner'), { target: { value: destination } });
    if (memo) fireEvent.change(screen.getByLabelText('Memo'), { target: { value: memo } });
}

afterEach(() => {
    cleanup();
    resetWalletModes();
    vi.clearAllMocks();
});

describe('ListTransferForm', () => {
    it('refuses a malformed list reference before review', async () => {
        const messaging = mount({ actionIndex: 'not-an-index' });
        await fillTransfer();
        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));

        expect(await screen.findByText('List reference must be a positive whole number.')).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('shows plain copy when the list indexer read fails', async () => {
        mount({
            listError: Object.assign(
                new Error('Explorer returned HTTP 502 for /BTC/api/lists/2700'),
                { name: 'SDKExplorerError' },
            ),
        });

        expect(await screen.findByText(/service that reads the chain is temporarily unavailable/)).toBeTruthy();
        expect(screen.queryByText(/\/BTC\/api\/lists/)).toBeNull();
    });

    it('refuses malformed and current-owner destinations', async () => {
        const messaging = mount();
        await fillTransfer({ destination: 'not-an-address' });

        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));
        expect((await screen.findAllByText(/Destination must be one valid address/)).length).toBeGreaterThan(0);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('New owner'), { target: { value: OWNER } });
        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));
        expect((await screen.findAllByText('Destination must be different from the current owner.')).length).toBeGreaterThan(0);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('has no type-to-confirm field and no list number row', async () => {
        const messaging = mount();
        fireEvent.change(await screen.findByLabelText('New owner'), { target: { value: DESTINATION } });

        expect(screen.queryByLabelText(/to confirm/i)).toBeNull();
        expect(screen.queryByText('List', { selector: 'dt' })).toBeNull();
        expect(screen.getByRole('button', { name: /^Transfer list$/i }).disabled).toBe(false);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(document.body.textContent).not.toMatch(/regtest|testnet|Not mainnet/i);
    });

    it('keeps transfer warnings on review and off the form', async () => {
        mount();
        await fillTransfer({ memo: 'handoff' });

        expect(screen.queryByTestId('confirm-warning')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));

        // The confirm page's short warning (G127 revised 2026-11-16): a bold
        // title and one line; the rest is the field's help.
        const warnings = await screen.findByTestId('confirm-warning');
        expect(warnings.textContent.startsWith("You can't undo this")).toBe(true);
        const lines = [...warnings.querySelectorAll('[data-testid="confirm-warning-point"]')].map((p) => p.textContent);
        expect(lines).toEqual([
            'The new owner controls this list from this block on.',
        ]);
    });

    it('names the list, shows the new owner once and drops the From address', async () => {
        mount({ listExtra: { name: 'Top Holders', state: { owner: OWNER, current_list: ['a', 'b', 'c'] } } });
        await fillTransfer();
        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));

        // The list's name on its own line, then the short sentence, then the
        // new owner (operator 2026-11-16: a list name can be very long).
        const sentence = await screen.findByTestId('confirm-sentence');
        expect(screen.getByTestId('confirm-name').textContent).toBe('Top Holders');
        expect(screen.getByTestId('confirm-name').nextElementSibling).toBe(sentence);
        expect(sentence.textContent).toBe('Transfer list to the new owner');
        const address = screen.getByTestId('confirm-address');
        expect(address.previousElementSibling.textContent).toBe('New owner');
        expect(address.querySelector(`[title="${DESTINATION}"]`) || address.textContent.includes(DESTINATION)).toBeTruthy();
        expect(screen.queryByTestId('confirm-source')).toBeNull();
        const page = screen.getByTestId('confirm-modal');
        expect(page.textContent).not.toContain(OWNER);
        expect(page.textContent).not.toContain('2700');
        const facts = screen.getByTestId('confirm-facts');
        const labels = [...facts.querySelectorAll('dt')].map((dt) => dt.textContent);
        // The name line says the list once; the card keeps the member count.
        expect(labels).toEqual(expect.arrayContaining(['Members']));
        expect(labels).not.toContain('List');
        expect(labels).not.toContain('From');
        expect(page.textContent.split('Top Holders').length - 1).toBe(1);
        expect(facts.textContent).toContain('3');
        // A transfer pays no protocol fee, so none is named as unknown.
        expect(page.textContent).not.toMatch(/protocol fee/i);
    });

    it('says "this list" and shows the id once when the list has no name', async () => {
        mount();
        await fillTransfer();
        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));

        const sentence = await screen.findByTestId('confirm-sentence');
        expect(sentence.textContent).toBe('Transfer this list to the new owner');
        expect(sentence.textContent).not.toMatch(/List List|#/);
        const page = screen.getByTestId('confirm-modal');
        expect(page.textContent.split('2700').length - 1).toBe(1);
        expect(screen.getByTestId('confirm-facts').textContent).toContain('#2700');
    });

    it('composes format 3 from the current owner and submits it through createList', async () => {
        const messaging = mount();
        await fillTransfer({ memo: 'handoff' });
        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const request = messaging.composeForConfirm.mock.calls[0][0];
        expect(request.from.address).toBe(OWNER);
        expect(request.actionData).toEqual({
            action: 'LIST',
            params: {
                VERSION: '3',
                LIST_ACTION_INDEX: '2700',
                DESTINATION,
                MEMO: 'handoff',
            },
        });
        expect(messaging.createList).not.toHaveBeenCalled();

        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve.disabled).toBe(false));
        fireEvent.click(approve);

        await waitFor(() => expect(messaging.createList).toHaveBeenCalledTimes(1));
        expect(messaging.createList.mock.calls[0][0]).toMatchObject({
            walletId: 'wallet-1',
            chainId: CHAIN,
            from: { address: OWNER },
            params: {
                VERSION: '3',
                LIST_ACTION_INDEX: '2700',
                DESTINATION,
                MEMO: 'handoff',
            },
            prebuiltPsbt: { psbtHex: 'aa00', encoding: 'psbt' },
        });
    });

    it('shows the unsigned transaction in watcher mode without asking for a password', async () => {
        const messaging = mount({ walletMode: 'watcher' });
        await fillTransfer({ memo: 'handoff' });
        fireEvent.click(screen.getByRole('button', { name: /^Create unsigned transaction$/i }));

        await waitFor(() => expect(messaging.buildActionPsbtRequest).toHaveBeenCalledOnce());
        expect(await screen.findByLabelText('Unsigned transaction code')).toBeTruthy();
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(messaging.createList).not.toHaveBeenCalled();
    });

    it.each([
        ['false', { share: true, transfer: false, union: true }],
        ['absent', { share: true, union: true }],
    ])('renders disabled with the SDK reason when transfer support is %s', async (_case, support) => {
        const messaging = mount({ support });

        expect(await screen.findByText("Transferring lists isn't available in this version of the wallet yet.")).toBeTruthy();
        expect(listFormatSupport).toHaveBeenCalledWith({
            sdkRegistry: expect.objectContaining({ get: expect.any(Function) }),
            chainId: CHAIN,
        });
        expect(messaging.getActionFormats).not.toHaveBeenCalled();
        expect(screen.getByLabelText('New owner').disabled).toBe(true);
        expect(screen.getByRole('button', { name: /^Transfer list$/i }).disabled).toBe(true);
    });

    it('separates a failed support check from an unavailable action', async () => {
        mount({ supportError: true });

        expect(await screen.findByText(
            "Couldn't check whether transferring lists is available right now. Reopen this page to try again.",
        )).toBeTruthy();
        expect(screen.queryByText(/isn't available in this version/)).toBeNull();
        expect(screen.getByRole('button', { name: 'Transfer List' }).disabled).toBe(true);
    });

    it('stops before signing when the list changed owner after the form opened', async () => {
        const messaging = mount();
        await fillTransfer();
        messaging.getListByActionIndex.mockResolvedValueOnce({
            action_index: 2700,
            source: OWNER,
            state: { owner: ACTIVE_RECORD.address },
        });
        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));

        expect(await screen.findByText(
            'This list has a different owner than when this screen opened. Review the owner and try again.',
        )).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
        expect(messaging.createList).not.toHaveBeenCalled();
    });

    it('stops before signing when the current owner cannot be read again', async () => {
        const messaging = mount();
        await fillTransfer();
        messaging.getListByActionIndex.mockRejectedValueOnce(new Error('Explorer returned HTTP 502'));
        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));

        expect(await screen.findByText(
            "Couldn't confirm this list's current owner. Check your connection and try again.",
        )).toBeTruthy();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});

describe('ListTransferForm publishes the destination it validated', () => {
    const UPPER_BECH32 = 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4';
    it.each([
        ['wrapped in quotes', `"${DESTINATION}"`, DESTINATION],
        ['with a trailing comma', `${DESTINATION},`, DESTINATION],
        ['as upper-case bech32', UPPER_BECH32, UPPER_BECH32.toLowerCase()],
    ])('publishes and shows the parsed address for a destination %s', async (_case, typed, published) => {
        const messaging = mount();
        await fillTransfer({ destination: typed });
        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        expect(messaging.composeForConfirm.mock.calls[0][0].actionData.params.DESTINATION).toBe(published);
        const address = await screen.findByTestId('confirm-address');
        expect(address.querySelector(`[title="${published}"]`) || address.textContent.includes(published)).toBeTruthy();
        expect(address.textContent).not.toContain(typed);
    });

    it('refuses the current owner typed in quotes', async () => {
        const messaging = mount();
        await fillTransfer({ destination: `"${OWNER}"` });
        fireEvent.click(screen.getByRole('button', { name: /^Transfer list$/i }));

        expect((await screen.findAllByText('Destination must be different from the current owner.')).length).toBeGreaterThan(0);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
