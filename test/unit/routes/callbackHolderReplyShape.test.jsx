// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A holder reply that is neither a row array nor an object carrying a
// data or holders array (an HTML error page that reaches the wallet as a
// string, a truncated body, a bare object, null) says nothing about the
// holder set. The holder summary refuses it instead of calling it a
// complete empty set with a zero payout, so CALLBACK never signs over an
// unread holder list. A valid empty reply still reads as a complete empty
// set.

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
    callbackAmount: '0.12345678',
    callbackBlock: '100',
    divisibility: 8,
    locks: {},
});

function holderSet(n) {
    const rows = [{ address: OWNER.address, amount: '5' }];
    for (let i = 0; i < n; i += 1) {
        const amount = i % 3 === 0 ? `0.${String((i % 97) + 1).padStart(8, '0')}` : String((i % 50) + 1);
        rows.push({ address: `holder-${i}`, amount });
    }
    return rows;
}

function holderSdk(reply) {
    const getHolders = vi.fn(async (_tick, opts) => (typeof reply === 'function' ? reply(opts) : reply));
    return { getHolders, sdkRegistry: { get: () => ({ getHolders }) } };
}

function pagedReply(rows) {
    return ({ limit, page = 1 }) => ({ data: rows.slice((page - 1) * limit, page * limit), total: rows.length });
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
});

describe('NW holder summary shapes', () => {
    for (const [label, body] of [
        ['an HTML body', '<html>502 Bad Gateway</html>'],
        ['a truncated JSON body', '{"data":[{"address":"holder-1","amount":"4'],
        ['an empty object', {}],
        ['an object whose data is not an array', { data: 'oops', total: 0 }],
        ['null', null],
    ]) {
        it(`does not call ${label} a complete empty holder set`, async () => {
            const { sdkRegistry } = holderSdk(body);
            let s = null;
            try {
                s = await tokenHolderSummary({
                    sdkRegistry, chainId: CHAIN, tick: 'CALLABLE', owner: OWNER.address,
                    callbackAmount: '1', callbackDecimals: 0,
                });
            } catch {
                s = null;
            }
            // Either a refusal, or a summary that does not claim to be complete.
            if (s) expect(s.partial).not.toBe(false);
        });
    }

    for (const [label, body] of [
        ['an empty array', []],
        ['an object with an empty data array', { data: [], total: 0 }],
        ['an object with an empty holders array', { holders: [] }],
    ]) {
        it(`reads ${label} as a complete empty holder set`, async () => {
            const { sdkRegistry } = holderSdk(body);
            const s = await tokenHolderSummary({
                sdkRegistry, chainId: CHAIN, tick: 'CALLABLE', owner: OWNER.address,
                callbackAmount: '1', callbackDecimals: 0,
            });
            expect(s.partial).toBe(false);
            expect(s.holderCount).toBe(0);
            expect(s.recipientCount).toBe(0);
            expect(s.isDistributed).toBe(false);
            expect(s.totalPayout).toBe('0');
        });
    }
});

function callbackMessaging(holderReply, { balance = '10000000000000' } = {}) {
    const holders = holderSdk(holderReply);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [OWNER] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: OWNER.id } }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 120 }),
        getTokenInfo: vi.fn(async ({ tick }) => (
            tick === 'PAY' ? { chainId: CHAIN, tick: 'PAY', divisibility: 8 } : { ...TERMS }
        )),
        tokenHolderSummary: vi.fn((req) => tokenHolderSummary({ sdkRegistry: holders.sdkRegistry, ...req })),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{ address: OWNER.address, balances: { tokens: [{ tick: 'PAY', divisibility: 8, quantity: balance }] } }],
        }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: '0|CALLABLE', version: 0, releaseEncoderInputsToken: 'hold-1',
        }),
        releaseEncoderInputs: vi.fn().mockResolvedValue({ released: 1 }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        callbackAction: vi.fn().mockResolvedValue({ txid: 'callback-txid' }),
    };
    const messaging = new Proxy(target, {
        get(t, prop) { return prop in t ? t[prop] : vi.fn().mockResolvedValue({}); },
    });
    return { messaging, target };
}

function mountCallback(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <CallbackForm walletId="w" initialChainId={CHAIN} initialTick="CALLABLE" initialFromAddress={OWNER.address} onBack={() => {}} />
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

describe('CallbackForm NW at Approve', () => {
    it('refuses an unparseable holder re-read at Approve', async () => {
        const { messaging, target } = callbackMessaging(pagedReply(holderSet(100)), { balance: '100000000000' });
        mountCallback(messaging);
        await openConfirm();
        // A 200 answer whose body is not JSON reaches the wallet as a string,
        // and the real payout is over 1 PAY, which this address does not hold.
        target.tokenHolderSummary.mockImplementation((req) => tokenHolderSummary({
            sdkRegistry: { get: () => ({ getHolders: async () => '<html>502 Bad Gateway</html>' }) }, ...req,
        }));
        target.getWalletBalances.mockResolvedValue({
            [CHAIN]: [{ address: OWNER.address, balances: { tokens: [{ tick: 'PAY', divisibility: 8, quantity: '100000000' }] } }],
        });
        await approve();
        await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
        expect(target.callbackAction).not.toHaveBeenCalled();
    });
});
