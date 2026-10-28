// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Execute callback reads the owner, the callback terms, the height and the
// payout-token balance when Review composes. The confirm page then stays
// open, and its pre-flight re-check runs at Approve only once its report is
// 30 seconds old. Without another read, an ownership transfer or a spend of
// the payout token in that window signs a CALLBACK the indexer refuses after
// the fee is spent. Approve reads them again and refuses when they moved.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CallbackForm } from '../../../packages/core/src/shared/routes/CallbackForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = Object.freeze({
    id: 'addr-1',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const NEW_OWNER = 'bc1q9d4ywgfnd8h43da5tpcxcn6ytpx4rstuq6u2dq';
const TERMS = Object.freeze({
    chainId: CHAIN,
    tick: 'CALLABLE',
    creator: OWNER.address,
    callbackTick: 'PAY',
    callbackAmount: '1.25',
    callbackBlock: '100',
});

function balancesWith(quantity) {
    return {
        [CHAIN]: [{
            address: OWNER.address,
            balances: { tokens: [{ tick: 'PAY', divisibility: 2, quantity }] },
        }],
    };
}

function confirmMessaging() {
    let record = { ...TERMS };
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 120 }),
        getTokenInfo: vi.fn(async ({ tick }) => (
            tick === 'PAY' ? { chainId: CHAIN, tick: 'PAY', divisibility: 2 } : { ...record }
        )),
        tokenHolderSummary: vi.fn().mockResolvedValue({ recipientCount: 2, totalPayout: '2.5', partial: false }),
        getWalletBalances: vi.fn().mockResolvedValue(balancesWith('1000')),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: '0|CALLABLE', version: 0, releaseEncoderInputsToken: 'hold-1',
        }),
        releaseEncoderInputs: vi.fn().mockResolvedValue({ released: 1 }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        callbackAction: vi.fn().mockResolvedValue({ txid: 'callback-txid' }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) {
            return prop in t ? t[prop] : vi.fn().mockResolvedValue({});
        },
    });
    return { messaging, target, setRecord: (next) => { record = next; } };
}

function mount(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <CallbackForm
                walletId="w"
                initialChainId={CHAIN}
                initialTick="CALLABLE"
                initialFromAddress={OWNER.address}
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

async function openConfirm() {
    const execute = await screen.findByRole('button', { name: 'Execute callback' });
    await waitFor(() => expect(execute).toBeEnabled());
    await act(async () => { fireEvent.click(execute); });
    await screen.findByRole('button', { name: 'Approve' });
    fireEvent.change(screen.getByLabelText('Type "CALLBACK" to confirm'), { target: { value: 'CALLBACK' } });
}

async function approve() {
    const button = screen.getByRole('button', { name: 'Approve' });
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => { fireEvent.click(button); });
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('Execute callback reads the token again at Approve', () => {
    it('refuses when ownership moved after the confirm page opened', async () => {
        const { messaging, target, setRecord } = confirmMessaging();
        mount(messaging);
        await openConfirm();
        setRecord({ ...TERMS, creator: NEW_OWNER });
        await approve();
        expect(await screen.findByText(
            'Callback terms changed since this form opened. Return to token details and reopen the callback. Nothing was signed.',
        )).toBeInTheDocument();
        expect(target.callbackAction).not.toHaveBeenCalled();
    });

    it('refuses when the payout token was spent below the payout after the confirm page opened', async () => {
        const { messaging, target } = confirmMessaging();
        mount(messaging);
        await openConfirm();
        target.getWalletBalances.mockResolvedValue(balancesWith('100'));
        await approve();
        expect(await screen.findByText(
            'This address holds only 1 PAY. The current callback payout is 2.5 PAY. Nothing was signed.',
        )).toBeInTheDocument();
        expect(target.callbackAction).not.toHaveBeenCalled();
    });

    it('refuses with a plain sentence when the explorer stops answering at Approve', async () => {
        const { messaging, target } = confirmMessaging();
        mount(messaging);
        await openConfirm();
        target.getIndexerWatermark.mockRejectedValue(new Error('fetch failed'));
        await approve();
        expect(await screen.findByText(
            'Could not refresh callback terms, block height, and payout. Try again. Nothing was signed.',
        )).toBeInTheDocument();
        expect(target.callbackAction).not.toHaveBeenCalled();
    });

    it('names an unread token record when its Approve refresh rejects', async () => {
        const { messaging, target } = confirmMessaging();
        mount(messaging);
        await openConfirm();
        target.getTokenInfo.mockImplementation(async ({ tick }) => {
            if (tick === 'PAY') return { chainId: CHAIN, tick: 'PAY', divisibility: 2 };
            throw new Error('explorer failed');
        });
        await approve();
        expect(await screen.findByText(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers. Nothing was signed.",
        )).toBeInTheDocument();
        expect(screen.queryByText(/does not have a complete callback configuration/)).toBeNull();
        expect(target.callbackAction).not.toHaveBeenCalled();
    });

    // The compose holds its inputs at the encoder for minutes. A refusal before
    // signing hands them back, or every retry over the same coins fails.
    it('hands the held inputs back to the encoder when Approve refuses', async () => {
        const { messaging, target, setRecord } = confirmMessaging();
        mount(messaging);
        await openConfirm();
        setRecord({ ...TERMS, creator: NEW_OWNER });
        await approve();
        await screen.findByText(/Nothing was signed/);
        await waitFor(() => expect(target.releaseEncoderInputs).toHaveBeenCalledWith({ token: 'hold-1' }));
        expect(target.callbackAction).not.toHaveBeenCalled();
    });

    it('signs once when nothing moved', async () => {
        const { messaging, target } = confirmMessaging();
        mount(messaging);
        await openConfirm();
        await approve();
        await waitFor(() => expect(target.callbackAction).toHaveBeenCalledTimes(1));
        expect(target.releaseEncoderInputs).not.toHaveBeenCalled();
    });
});
