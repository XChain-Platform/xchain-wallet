// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DividendForm } from '../../../packages/core/src/shared/routes/DividendForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qexampleexampleexampleexampleexampleex';
const DUPLICATE = { address: 'bc1qholderone', amount: '10' };

function mountDividend() {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-1', address: SOURCE, publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getHoldersForToken: vi.fn().mockResolvedValue({
            total: 2,
            data: [DUPLICATE, { ...DUPLICATE }],
        }),
        getTokenInfo: vi.fn(({ tick }) => Promise.resolve({
            chainId: CHAIN, tick, creator: '1creator', totalSupply: '1000', divisibility: 8, locks: {},
        })),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [
                        { tick: 'SHARES', quantity: '1000', divisibility: 8 },
                        { tick: 'XCHAIN', quantity: '100000000000', divisibility: 8 },
                    ],
                },
            }],
        }),
        composeForConfirm: vi.fn().mockResolvedValue({
            psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1,
        }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue({ supported: true, valid: true, xchainFee: '0' }),
        dividendAction: vi.fn(),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <DividendForm walletId="w" initialChainId={CHAIN} initialTick="SHARES" onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

async function flushTimers() {
    for (let pass = 0; pass < 4; pass += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    }
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.useRealTimers();
});

describe('Dividend holder completeness', () => {
    it('refuses a total-sized list containing a duplicate holder address', async () => {
        const messaging = mountDividend();
        await flushTimers();
        fireEvent.click(screen.getByRole('button', { name: /Dividend token/i }));
        await flushTimers();
        const token = Array.from(document.querySelectorAll('button'))
            .find((button) => (button.textContent || '').includes('XCHAIN'));
        fireEvent.click(token);
        fireEvent.change(screen.getByLabelText(/^Per-unit amount/), { target: { value: '1' } });
        await flushTimers();

        expect(document.body.textContent).toMatch(/holder list is incomplete/i);
        expect(screen.getByRole('button', { name: 'Pay dividend' })).toBeDisabled();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });
});
