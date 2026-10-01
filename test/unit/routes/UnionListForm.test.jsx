// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is also available.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { UnionListForm } from '../../../packages/core/src/shared/routes/UnionListForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'source-address',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-source',
});
const COMPOSED = Object.freeze({
    psbt: 'aa00',
    encoding: 'psbt',
    actionString: 'LIST|0|3|combined|101',
    version: 1,
});

function row(actionIndex, type, members = []) {
    return { action_index: actionIndex, type, members };
}

function makeMessaging({ owned, shared = [], details = {} } = {}) {
    const localRows = owned || [row(101, 1, ['AAA', 'BBB']), row(102, 2, ['address-a'])];
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListsForSource: vi.fn().mockResolvedValue({ data: localRows }),
        getSharedLists: vi.fn().mockResolvedValue({ lists: shared, unavailable: [] }),
        getListByActionIndex: vi.fn().mockImplementation(({ actionIndex }) => {
            const own = localRows.find((entry) => String(entry.action_index) === String(actionIndex));
            const members = details[actionIndex] ?? own?.members;
            return Promise.resolve({ type: own?.type, state: { current_list: members } });
        }),
        getActionFormats: vi.fn().mockResolvedValue({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            2: 'VERSION|LIST_ACTION_INDEX|MEMO',
            3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
        }),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn().mockResolvedValue({ txid: 'union-txid' }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'bb00' }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount({ support = { share: true, transfer: true, union: true }, ...options } = {}) {
    listFormatSupport.mockResolvedValue(support);
    const messaging = makeMessaging(options);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <UnionListForm walletId="wallet-1" chainId={CHAIN} onBack={() => {}} onDone={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('UnionListForm', () => {
    it('locks the picker to the first type and excludes union lists', async () => {
        mount({
            owned: [row(101, 1), row(102, 2), row(103, 3)],
            shared: [{ bindTarget: 900, type: 2, home_chain: 'LTC', home_list_index: 44 }],
            details: { 900: ['mirror-address'] },
        });

        fireEvent.click(await screen.findByRole('checkbox', { name: 'Token list #101' }));

        expect(screen.queryByText(/list #103/)).toBeNull();
        expect(screen.getByRole('checkbox', { name: 'Address list #102' }).disabled).toBe(true);
        expect(screen.getByRole('checkbox', { name: /Shared address list #900/ }).disabled).toBe(true);
        expect(screen.getAllByText('A union holds lists of one type')).toHaveLength(2);
    });

    it('refuses a seventeenth member list', async () => {
        mount({ owned: Array.from({ length: 17 }, (_, index) => row(index + 1, 1, [`T${index}`])) });

        for (let index = 1; index <= 16; index += 1) {
            fireEvent.click(await screen.findByRole('checkbox', { name: `Token list #${index}` }));
        }

        expect(screen.getByRole('checkbox', { name: 'Token list #17' }).disabled).toBe(true);
        expect(screen.getByText('A union holds at most 16 lists')).toBeTruthy();
    });

    it('offers a viewing-chain mirror as a member', async () => {
        mount({
            owned: [],
            shared: [{ bindTarget: 900, type: 2, home_chain: 'LTC', home_list_index: 44 }],
            details: { 900: ['address-a', 'address-b'] },
        });

        const mirror = await screen.findByRole('checkbox', {
            name: 'Shared address list #900 from LTC list #44',
        });
        expect(mirror.disabled).toBe(false);
        fireEvent.click(mirror);
        expect(screen.getByText('Estimated merged membership: 2')).toBeTruthy();
        expect(screen.getByText(/indexer judges the merged membership at the create's block/)).toBeTruthy();
    });

    it('deduplicates known memberships in the displayed estimate', async () => {
        mount({ owned: [row(101, 1, ['AAA', 'BBB']), row(104, 1, ['BBB', 'CCC'])] });

        fireEvent.click(await screen.findByRole('checkbox', { name: 'Token list #101' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Token list #104' }));

        expect(screen.getByText('Estimated merged membership: 3')).toBeTruthy();
    });

    it('composes format 0 type 3 and submits it through createList', async () => {
        const messaging = mount();
        fireEvent.click(await screen.findByRole('checkbox', { name: 'Token list #101' }));
        fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: 'combined' } });
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));

        await waitFor(() => expect(messaging.composeForConfirm).toHaveBeenCalledTimes(1));
        const request = messaging.composeForConfirm.mock.calls[0][0];
        expect(request.from.address).toBe(SOURCE.address);
        expect(request.actionData).toEqual({
            action: 'LIST',
            params: { VERSION: '0', TYPE: '3', MEMO: 'combined', ITEM: ['101'] },
        });

        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve.disabled).toBe(false));
        fireEvent.click(approve);

        await waitFor(() => expect(messaging.createList).toHaveBeenCalledTimes(1));
        expect(messaging.createList.mock.calls[0][0]).toMatchObject({
            walletId: 'wallet-1',
            chainId: CHAIN,
            from: { address: SOURCE.address },
            params: { VERSION: '0', TYPE: '3', MEMO: 'combined', ITEM: ['101'] },
            prebuiltPsbt: { psbtHex: 'aa00', encoding: 'psbt' },
        });
    });

    it('refuses Review when the known merged membership exceeds 10,000', async () => {
        mount({ owned: [row(101, 1, Array.from({ length: 10001 }, (_, index) => `T${index}`))] });

        fireEvent.click(await screen.findByRole('checkbox', { name: 'Token list #101' }));

        expect(screen.getByText('Estimated merged membership: 10,001')).toBeTruthy();
        expect(screen.getByText('The estimated merged membership is over 10,000.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true);
    });

    it.each([
        ['false', { share: true, transfer: true, union: false }],
        ['absent', { share: true, transfer: true }],
    ])('disables the form with the SDK reason when union support is %s', async (_case, support) => {
        const messaging = mount({ support });

        expect(await screen.findByText(/SDK cannot build a union list yet/)).toBeTruthy();
        expect(listFormatSupport).toHaveBeenCalledWith({
            sdkRegistry: expect.objectContaining({ get: expect.any(Function) }),
            chainId: CHAIN,
        });
        expect(messaging.getActionFormats).not.toHaveBeenCalled();
        expect(screen.getByRole('checkbox', { name: 'Token list #101' }).disabled).toBe(true);
        expect(screen.getByLabelText('Memo (optional)').disabled).toBe(true);
        expect(screen.getByRole('button', { name: 'Review' }).disabled).toBe(true);
    });
});
