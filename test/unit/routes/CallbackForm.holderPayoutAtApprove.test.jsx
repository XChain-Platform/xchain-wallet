// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// CALLBACK pays every non-owner holder, and the indexer refuses the whole
// action when the owner holds less than the summed payout, after the fee is
// spent. The holder summary reads at most one page of holders, so on a token
// with more holders than that page its payout is only a floor. Approve signs
// only when the payout it compares is the whole payout, and every malformed
// or failed re-read stops the sign with one plain sentence.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CallbackForm } from '../../../packages/core/src/shared/routes/CallbackForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { tokenHolderSummary } from '../../../packages/core/src/flows/tokenHolders.js';

const CHAIN = 'bitcoin-mainnet';
const OWNER = Object.freeze({
    id: 'addr-1',
    address: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
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

function confirmMessaging(summary = { recipientCount: 2, totalPayout: '2.5', partial: false }) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 120 }),
        getTokenInfo: vi.fn(async ({ tick }) => (
            tick === 'PAY' ? { chainId: CHAIN, tick: 'PAY', divisibility: 2 } : { ...TERMS }
        )),
        tokenHolderSummary: vi.fn().mockResolvedValue(summary),
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
    return { messaging, target };
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

describe('Execute callback with more holders than one summary page', () => {
    // 5,000 holders, one page of 500 read: the summed payout over the page is
    // 2.5 PAY, the owner holds 10 PAY, and the full 5,000-holder payout is 25
    // PAY. The indexer refuses this CALLBACK for insufficient funds.
    const PARTIAL = Object.freeze({ recipientCount: 500, holderCount: 5000, totalPayout: '2.5', partial: true });
    const FLOOR_REFUSAL = 'The callback payout is at least 2.5 PAY, and this wallet cannot read every holder, '
        + 'so it cannot confirm this address holds enough PAY to cover it.';

    it('refuses Approve when the re-read payout is only a floor over a capped holder page', async () => {
        const { messaging, target } = confirmMessaging();
        mount(messaging);
        await openConfirm();
        target.tokenHolderSummary.mockResolvedValue({ ...PARTIAL });
        await approve();
        expect(await screen.findByText(`${FLOOR_REFUSAL} Nothing was signed.`)).toBeInTheDocument();
        expect(target.callbackAction).not.toHaveBeenCalled();
    });

    it('refuses Review when the payout is only a floor over a capped holder page', async () => {
        const { messaging, target } = confirmMessaging({ ...PARTIAL });
        mount(messaging);
        const execute = await screen.findByRole('button', { name: 'Execute callback' });
        await waitFor(() => expect(execute).toBeEnabled());
        await act(async () => { fireEvent.click(execute); });
        expect(await screen.findByText(FLOOR_REFUSAL)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
        expect(target.callbackAction).not.toHaveBeenCalled();
    });

    it('sends when the complete holder payout is within the payout balance', async () => {
        const { messaging, target } = confirmMessaging({ recipientCount: 2, holderCount: 3, totalPayout: '2.5', partial: false });
        mount(messaging);
        await openConfirm();
        await approve();
        await waitFor(() => expect(target.callbackAction).toHaveBeenCalledTimes(1));
        expect(screen.queryByText(/cannot read every holder/)).toBeNull();
    });
});

describe('Execute callback refuses malformed re-reads at Approve', () => {
    for (const [label, watermark] of [['a text height', { watermark: 'abc' }], ['no height', {}], ['a negative height', { watermark: -1 }]]) {
        it(`refuses ${label} with one plain sentence`, async () => {
            const { messaging, target } = confirmMessaging();
            mount(messaging);
            await openConfirm();
            target.getIndexerWatermark.mockResolvedValue(watermark);
            await approve();
            expect(await screen.findAllByText(/Nothing was signed/)).toHaveLength(1);
            expect(target.callbackAction).not.toHaveBeenCalled();
        });
    }

    for (const [label, totalPayout] of [['a comma decimal', '1,25'], ['an object', { v: 1 }], ['NaN', 'NaN']]) {
        it(`refuses a holder payout of ${label}`, async () => {
            const { messaging, target } = confirmMessaging();
            mount(messaging);
            await openConfirm();
            target.tokenHolderSummary.mockResolvedValue({ recipientCount: 2, totalPayout, partial: false });
            await approve();
            expect(await screen.findAllByText(/Nothing was signed/)).toHaveLength(1);
            expect(target.callbackAction).not.toHaveBeenCalled();
        });
    }

    it('refuses an offline payout-token balance read', async () => {
        const { messaging, target } = confirmMessaging();
        mount(messaging);
        await openConfirm();
        target.getWalletBalances.mockRejectedValue(Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }));
        await approve();
        expect(await screen.findAllByText(/Nothing was signed/)).toHaveLength(1);
        expect(target.callbackAction).not.toHaveBeenCalled();
    });

    it('signs at most once on a double press while the holder re-read is slow', async () => {
        const { messaging, target } = confirmMessaging();
        mount(messaging);
        await openConfirm();
        let release;
        target.tokenHolderSummary.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve({ recipientCount: 2, totalPayout: '2.5', partial: false });
        }));
        const button = screen.getByRole('button', { name: 'Approve' });
        await waitFor(() => expect(button).toBeEnabled());
        await act(async () => { fireEvent.click(button); fireEvent.click(button); });
        await waitFor(() => expect(typeof release).toBe('function'));
        await act(async () => { release(); });
        await waitFor(() => expect(target.callbackAction.mock.calls.length).toBeLessThanOrEqual(1));
        expect(target.callbackAction.mock.calls.length).toBeLessThanOrEqual(1);
    });
});

describe('Holder payout total at scale', () => {
    function decimalToUnits(s, dec) {
        const [i, f = ''] = String(s).split('.');
        return BigInt(i + f.padEnd(dec, '0').slice(0, dec));
    }

    it('sums 8-decimal dust payouts exactly and marks a capped page partial', async () => {
        const holders = [];
        for (let i = 0; i < 5000; i += 1) {
            holders.push({ address: `holder-${i}`, amount: `0.${String((i * 7919) % 99999999 + 1).padStart(8, '0')}` });
        }
        const sdk = {
            getHolders: vi.fn(async (_tick, { limit }) => ({ data: holders.slice(0, limit), total: holders.length })),
        };
        const sdkRegistry = { get: () => sdk };
        const cb = '0.12345678';
        const s = await tokenHolderSummary({
            sdkRegistry, chainId: CHAIN, tick: 'CALLABLE', owner: OWNER.address, callbackAmount: cb, callbackDecimals: 8, limit: 1000,
        });
        const seen = holders.slice(0, 1000);
        let expected = 0n;
        const cbUnits = decimalToUnits(cb, 8);
        for (const h of seen) expected += (decimalToUnits(h.amount, 8) * cbUnits) / (10n ** 8n);
        expect(decimalToUnits(s.totalPayout, 8)).toBe(expected);
        expect(s.recipientCount).toBe(1000);
        expect(s.holderCount).toBe(5000);
        expect(s.partial).toBe(true);
    });

    it('marks the summary partial when the token has more holders than the 1000-row cap', async () => {
        const holders = Array.from({ length: 1500 }, (_unused, i) => ({ address: `holder-${i}`, amount: '1' }));
        const getHolders = vi.fn(async (_tick, { limit }) => holders.slice(0, limit));
        const sdkRegistry = { get: () => ({ getHolders }) };
        const s = await tokenHolderSummary({
            sdkRegistry, chainId: CHAIN, tick: 'CALLABLE', owner: OWNER.address, callbackAmount: '1', limit: 5000,
        });
        expect(getHolders).toHaveBeenCalledWith('CALLABLE', { limit: 1000 });
        expect(s.recipientCount).toBe(1000);
        expect(s.totalPayout).toBe('1000');
        expect(s.partial).toBe(true);
    });

    it('marks a summary under the cap complete', async () => {
        const holders = Array.from({ length: 3 }, (_unused, i) => ({ address: `holder-${i}`, amount: '2' }));
        const sdkRegistry = { get: () => ({ getHolders: vi.fn(async () => ({ data: holders, total: 3 })) }) };
        const s = await tokenHolderSummary({
            sdkRegistry, chainId: CHAIN, tick: 'CALLABLE', owner: OWNER.address, callbackAmount: '1.25', callbackDecimals: 2,
        });
        expect(s.partial).toBe(false);
        expect(s.totalPayout).toBe('7.5');
    });
});
