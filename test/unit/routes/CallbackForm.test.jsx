// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    CallbackForm,
    callbackTermsError,
} from '../../../packages/core/src/shared/routes/CallbackForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = Object.freeze({
    id: 'btc-0',
    address: 'bc1qdevmockabcd',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const TERMS = Object.freeze({
    tick: 'CALLABLE',
    creator: SOURCE.address,
    callbackTick: 'PAY',
    callbackAmount: '1.25',
    callbackBlock: '100',
});

function messagingFor(overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'locked' }),
        getTokenInfo: vi.fn(async ({ tick }) => (
            tick === 'CALLABLE' ? { ...TERMS } : { tick: 'PAY', divisibility: 2 }
        )),
        tokenHolderSummary: vi.fn().mockResolvedValue({
            recipientCount: 1,
            totalPayout: '2.5',
            partial: false,
        }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 120 }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE.address,
                balances: { tokens: [{ tick: 'PAY', divisibility: 2, quantity: '1000' }] },
            }],
        }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ psbtHex: 'aa' }),
        ...overrides,
    };
    return new Proxy(messaging, {
        get(target, prop) {
            if (prop in target) return target[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount(overrides = {}, props = {}) {
    const messaging = messagingFor(overrides);
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <CallbackForm
                walletId="wallet-1"
                onBack={() => {}}
                initialChainId={CHAIN}
                initialTick="CALLABLE"
                initialFromAddress={SOURCE.address}
                {...props}
            />
        </MessagingProvider>,
    );
    return messaging;
}

async function readySubmit() {
    const button = await screen.findByRole('button', { name: 'Preview' });
    await waitFor(() => expect(button.disabled).toBe(false));
    return button;
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    __clearTokenInfoCache();
});

describe('callback field validation', () => {
    it('refuses before review when the issuer is unknown', async () => {
        const buildActionPsbtRequest = vi.fn();
        mount({
            getTokenInfo: vi.fn(async ({ tick }) => (
                tick === 'CALLABLE' ? { ...TERMS, creator: null } : { tick: 'PAY', divisibility: 2 }
            )),
            buildActionPsbtRequest,
        });

        expect(await screen.findByRole('alert')).toHaveTextContent(
            "The token's issuer could not be confirmed, so this action is not available. Try again when the explorer answers.",
        );
        expect(screen.getByRole('button', { name: 'Preview' })).toBeDisabled();
        expect(buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it.each([
        [{ ...TERMS, callbackTick: '' }, 'complete callback configuration'],
        [{ ...TERMS, callbackTick: 'BAD|TICK' }, 'Callback token can only use'],
        [{ ...TERMS, callbackAmount: '0' }, 'positive number'],
        [{ ...TERMS, callbackAmount: '-1' }, 'positive number'],
        [{ ...TERMS, callbackAmount: '1.234' }, 'at most 2 decimal places'],
        [{ ...TERMS, callbackBlock: '-1' }, 'whole block height'],
        [{ ...TERMS, callbackBlock: '1.5' }, 'whole block height'],
        [{ ...TERMS, callbackBlock: '9007199254740992' }, 'supported range'],
    ])('rejects malformed callback terms %#', (terms, message) => {
        expect(callbackTermsError(terms, 2)).toContain(message);
    });
});

describe('CallbackForm review safety', () => {
    it('uses the payout token divisibility for the displayed payout', async () => {
        const messaging = mount();
        await readySubmit();

        await waitFor(() => expect(messaging.tokenHolderSummary).toHaveBeenCalledWith(expect.objectContaining({
            callbackAmount: '1.25',
            callbackDecimals: 2,
        })));
        for (const [args] of messaging.tokenHolderSummary.mock.calls) {
            expect(args.callbackDecimals).toBe(2);
        }
    });

    // The holder summary floors each holder's payout to the decimals it is
    // given, so asking before the payout token loads shows a short figure.
    function payoutByDecimals() {
        return vi.fn(async ({ callbackDecimals }) => ({
            recipientCount: 2,
            totalPayout: callbackDecimals === 2 ? '2.5' : '2',
            partial: false,
        }));
    }

    it('waits for the payout token before asking for the holder payout', async () => {
        let releasePayout = () => {};
        const payoutRead = new Promise((resolve) => {
            releasePayout = () => resolve({ tick: 'PAY', divisibility: 2 });
        });
        const messaging = mount({
            getTokenInfo: vi.fn(async ({ tick }) => (tick === 'CALLABLE' ? { ...TERMS } : payoutRead)),
            tokenHolderSummary: payoutByDecimals(),
        });
        await readySubmit();
        await new Promise((resolve) => { setTimeout(resolve, 20); });

        expect(messaging.tokenHolderSummary).not.toHaveBeenCalled();
        expect(screen.queryByText('2 PAY')).toBeNull();

        releasePayout();
        expect(await screen.findByText('2.5 PAY')).toBeTruthy();
        for (const [args] of messaging.tokenHolderSummary.mock.calls) {
            expect(args.callbackDecimals).toBe(2);
        }
    });

    it('shows no payout figure when the payout token read fails', async () => {
        const messaging = mount({
            getTokenInfo: vi.fn(async ({ tick }) => (
                tick === 'CALLABLE' ? { ...TERMS } : { tick: 'PAY', divisibility: null, loadError: true }
            )),
            tokenHolderSummary: payoutByDecimals(),
        });
        await readySubmit();
        await waitFor(() => expect(messaging.getTokenInfo).toHaveBeenCalledWith(expect.objectContaining({ tick: 'PAY' })));
        await new Promise((resolve) => { setTimeout(resolve, 20); });

        expect(messaging.tokenHolderSummary).not.toHaveBeenCalled();
        expect(screen.queryByText('Total payout')).toBeNull();
        expect(screen.queryByText('2 PAY')).toBeNull();
    });

    it('shows a plain error for a malformed source before review', async () => {
        const badSource = { ...SOURCE, address: 'not-an-address' };
        const messaging = mount({
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [badSource] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: badSource.id } }),
            getTokenInfo: vi.fn(async ({ tick }) => (
                tick === 'CALLABLE' ? { ...TERMS, creator: badSource.address } : { tick: 'PAY', divisibility: 2 }
            )),
        }, { initialFromAddress: badSource.address });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText('The selected source address is not valid for this network.')).toBeTruthy();
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
    });

    it('refuses an invalid custom fee instead of silently using the default', async () => {
        const messaging = mount();
        const submit = await readySubmit();
        fireEvent.change(screen.getByRole('slider', { name: 'Network fee' }), {
            target: { value: '3' },
        });
        fireEvent.change(screen.getByLabelText(/Custom fee rate/), { target: { value: '0' } });

        fireEvent.click(submit);

        expect(await screen.findAllByText(/custom fee rate.*greater than zero/i)).not.toHaveLength(0);
        expect(messaging.getWalletBalances).not.toHaveBeenCalled();
    });

    it('refreshes height and refuses review while the callback is still locked', async () => {
        const height = vi.fn()
            .mockResolvedValueOnce({ watermark: 120 })
            .mockResolvedValue({ watermark: 99 });
        const messaging = mount({ getIndexerWatermark: height });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText(
            'Callback is not allowed until block 100. The network is at 99.',
        )).toBeTruthy();
        expect(height).toHaveBeenCalledTimes(2);
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses callback terms that changed after the form loaded', async () => {
        let callbackReads = 0;
        const getTokenInfo = vi.fn(async ({ tick }) => {
            if (tick === 'PAY') return { tick: 'PAY', divisibility: 2 };
            callbackReads += 1;
            return callbackReads === 1
                ? { ...TERMS }
                : { ...TERMS, callbackAmount: '2' };
        });
        const messaging = mount({ getTokenInfo });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText(/Callback terms changed since this form opened/)).toBeTruthy();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('refuses a payout above the freshly loaded payout-token balance', async () => {
        const messaging = mount({
            getWalletBalances: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    address: SOURCE.address,
                    balances: { tokens: [{ tick: 'PAY', divisibility: 2, quantity: '100' }] },
                }],
            }),
        });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText(
            'This address holds only 1 PAY. The current callback payout is 2.5 PAY.',
        )).toBeTruthy();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });

    it('shows the exact wire memo on review and keeps it after Back', async () => {
        mount();
        const memo = await screen.findByLabelText('Memo (optional)');
        fireEvent.change(memo, { target: { value: '  final note  ' } });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText('final note')).toBeTruthy();
        expect(screen.getByText('CALLABLE')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        expect(await screen.findByLabelText('Memo (optional)')).toHaveValue('  final note  ');
    });

    it('turns refresh failures into plain user-facing copy', async () => {
        const getIndexerWatermark = vi.fn()
            .mockResolvedValueOnce({ watermark: 120 })
            .mockRejectedValue(new Error('rpc exploded'));
        const messaging = mount({ getIndexerWatermark });

        fireEvent.click(await readySubmit());

        expect(await screen.findByText(
            'Could not refresh callback terms, block height, and payout. Try again.',
        )).toBeTruthy();
        expect(messaging.buildActionPsbtRequest).not.toHaveBeenCalled();
    });
});
