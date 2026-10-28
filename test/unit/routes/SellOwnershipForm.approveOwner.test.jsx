// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Selling a name hands over something that cannot be taken back, so the
// owner is read again at Approve, after the review has been on screen. A name
// that moved, or an owner the explorer cannot confirm, stops the sale before
// anything is signed, and Reject still frees the coins the compose held.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SellOwnershipForm } from '../../../packages/core/src/shared/routes/SellOwnershipForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qsellersellersellersellersellersellerx',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const BUYER = 'bc1qbuyerbuyerbuyerbuyerbuyerbuyerbuyerbx';
const OWNED = { tick: 'ALPHA', creator: ADDRESS.address, locks: {} };

function messagingWith({ atApprove, ...overrides }) {
    let approved = false;
    const orderAction = vi.fn().mockResolvedValue({ txid: 'tx-sale' });
    const releaseEncoderInputs = vi.fn().mockResolvedValue({ released: 1 });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        // The record reads as owned until the confirm page is open; the read
        // Approve makes is the one under test.
        getTokenInfo: vi.fn(async () => (approved ? atApprove() : { ...OWNED })),
        composeForConfirm: vi.fn(async () => {
            approved = true;
            return {
                psbt: 'aa00', encoding: 'psbt', actionString: 'ORDER|0|BTC|ALPHA||1|BTC||5|||||', version: 1,
                releaseEncoderInputsToken: 'release-1',
            };
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        reserve: vi.fn().mockResolvedValue({}),
        releaseReservation: vi.fn().mockResolvedValue({}),
        releaseEncoderInputs,
        orderAction,
        dispenserAction: vi.fn().mockResolvedValue({ txid: 'tx-disp' }),
        ...overrides,
    };
    return messaging;
}

function mount(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SellOwnershipForm walletId="wallet-1" chainId={CHAIN} tick="ALPHA" onBack={vi.fn()} />
        </MessagingProvider>,
    );
}

async function openConfirm() {
    fireEvent.change(await screen.findByLabelText(/^Price/), { target: { value: '5' } });
    const list = screen.getByRole('button', { name: 'List name for sale' });
    await waitFor(() => expect(list).not.toBeDisabled());
    fireEvent.click(list);
    return waitFor(() => {
        const approve = screen.getAllByRole('button').find((b) => /approve/i.test(b.textContent || '') && !b.disabled);
        expect(approve).toBeTruthy();
        return approve;
    });
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('SellOwnershipForm reads the owner again at Approve', () => {
    it('refuses before signing when the name moved after the review opened, and Reject frees the coins', async () => {
        const messaging = messagingWith({ atApprove: () => ({ ...OWNED, creator: BUYER }) });
        mount(messaging);
        const approve = await openConfirm();

        fireEvent.click(approve);

        expect(await screen.findByText('ALPHA changed since this form opened. Check the updated details, then review again.'))
            .toBeInTheDocument();
        expect(messaging.orderAction).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /^Reject/ }));
        await waitFor(() => expect(messaging.releaseEncoderInputs).toHaveBeenCalledWith({ token: 'release-1' }));
        expect(messaging.orderAction).not.toHaveBeenCalled();
    });

    it.each([
        ['the explorer is down', () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5556'); }],
        ['the explorer answers with a read failure', () => ({ tick: 'ALPHA', creator: null, loadError: true })],
        ['the explorer answers with no owner', () => ({ tick: 'ALPHA', creator: null })],
        ['the explorer answers malformed', () => null],
    ])('refuses before signing when %s at Approve', async (_label, atApprove) => {
        const messaging = messagingWith({ atApprove });
        mount(messaging);
        const approve = await openConfirm();

        fireEvent.click(approve);

        expect(await screen.findByText(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        )).toBeInTheDocument();
        expect(messaging.orderAction).not.toHaveBeenCalled();
    });

    it('signs once when the owner is unchanged, however often Approve is pressed', async () => {
        const messaging = messagingWith({ atApprove: () => ({ ...OWNED }) });
        mount(messaging);
        const approve = await openConfirm();

        fireEvent.click(approve);
        fireEvent.click(approve);
        fireEvent.click(approve);

        await waitFor(() => expect(messaging.orderAction).toHaveBeenCalledTimes(1));
        expect(messaging.orderAction.mock.calls[0][0].params).toMatchObject({ GIVE_TICK: 'ALPHA', GIVE_OWNERSHIP: '1' });
        expect(await screen.findByText('Name listed for sale')).toBeInTheDocument();
        expect(messaging.orderAction).toHaveBeenCalledTimes(1);
    });
});
