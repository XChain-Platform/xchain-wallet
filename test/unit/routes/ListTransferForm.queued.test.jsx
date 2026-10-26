// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
// A transfer that is signed but held in the broadcast queue ends on the queued panel,
// not on the submitted screen that promises the change appears on confirmation.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listFormatSupport = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/flows/listFormatSupport.js', () => ({
    listFormatSupport,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ListTransferForm } from '../../../packages/core/src/shared/routes/ListTransferForm.jsx';

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
});

function makeMessaging({ walletMode = 'full', listError = null } = {}) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ACTIVE_RECORD, OWNER_RECORD] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ACTIVE_RECORD.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getListByActionIndex: vi.fn().mockImplementation(async () => {
            if (listError) throw listError;
            return {
                action_index: 2700,
                source: OWNER,
                state: { owner: OWNER },
            };
        }),
        getActionFormats: vi.fn().mockResolvedValue({
            0: 'VERSION|TYPE|MEMO|...ITEM',
            2: 'VERSION|LIST_ACTION_INDEX|MEMO',
            3: 'VERSION|LIST_ACTION_INDEX|DESTINATION|MEMO',
        }),
        composeForConfirm: vi.fn().mockResolvedValue(COMPOSED),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        createList: vi.fn().mockRejectedValue(Object.assign(new Error('network down'), { name: 'BroadcastFailedTransientError' })),
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
    support = { share: true, transfer: true, union: true }, actionIndex = '2700', ...options
} = {}) {
    listFormatSupport.mockResolvedValue(support);
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
    fireEvent.change(await screen.findByLabelText('Destination'), { target: { value: destination } });
    if (memo) fireEvent.change(screen.getByLabelText('Memo (optional)'), { target: { value: memo } });
    fireEvent.change(screen.getByLabelText('Type TRANSFER to confirm'), { target: { value: 'TRANSFER' } });
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('ListTransferForm queued result', () => {
    it('shows the queued panel when the transfer is signed but not broadcast', async () => {
        const messaging = mount();
        await fillTransfer();
        fireEvent.click(screen.getByRole('button', { name: 'Review' }));
        const approve = await screen.findByTestId('confirm-approve');
        await waitFor(() => expect(approve.disabled).toBe(false));
        fireEvent.click(approve);

        await waitFor(() => expect(messaging.createList).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(document.body.textContent).toMatch(/Your list transfer is signed/));
        expect(document.body.textContent).not.toMatch(/List transfer submitted/);
    });
});
