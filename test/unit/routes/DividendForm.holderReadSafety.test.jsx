// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DividendForm } from '../../../packages/core/src/shared/routes/DividendForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';
import { fakeHoldersFor } from '../../../packages/web/src/devFakeBalances.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qexampleexampleexampleexampleexampleex';

function mountDividend(holderRead, walletMode = 'full') {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                id: 'addr-1', address: SOURCE, publicKey: '02ab',
                derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
            }],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getHoldersForToken: vi.fn(holderRead),
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

async function fillDividend() {
    await flushTimers();
    fireEvent.click(screen.getByRole('button', { name: /Dividend token/i }));
    await flushTimers();
    const row = Array.from(document.querySelectorAll('button'))
        .find((button) => (button.textContent || '').includes('XCHAIN'));
    fireEvent.click(row);
    fireEvent.change(screen.getByLabelText(/^Per-unit amount/), { target: { value: '1' } });
    await flushTimers();
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.useRealTimers();
});

describe('Dividend holder reads fail closed', () => {
    it('enables Preview for the complete explorer envelope served by the dev mock', async () => {
        mountDividend(async () => fakeHoldersFor('SHARES', CHAIN), 'watcher');
        await fillDividend();

        expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled();
        expect(document.body.textContent).toMatch(/12 eligible holders/);
    });

    it('does not compose after the explorer refuses the holder read', async () => {
        const messaging = mountDividend(async () => { throw new Error('explorer 500'); }, 'watcher');
        await fillDividend();
        const preview = screen.getByRole('button', { name: 'Preview' });
        expect(preview).toBeDisabled();
        fireEvent.click(preview);
        await flushTimers();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('does not compose after a malformed holder envelope', async () => {
        const messaging = mountDividend(async () => ({}));
        await fillDividend();
        fireEvent.click(screen.getByRole('button', { name: 'Pay dividend' }));
        await flushTimers();
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('rejects a short holder page instead of treating it as complete', async () => {
        const messaging = mountDividend(async () => ({
            total: 2,
            data: [{ address: 'bc1qholderone', amount: '10' }],
        }));
        await fillDividend();
        expect(document.body.textContent).toMatch(/holder list is incomplete/i);
        expect(screen.getByRole('button', { name: 'Pay dividend' }).disabled).toBe(true);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();
    });

    it('recovers from an offline read through the in-place retry', async () => {
        let attempt = 0;
        const messaging = mountDividend(async () => {
            attempt += 1;
            if (attempt === 1) throw new Error('offline');
            return { total: 1, data: [{ address: 'bc1qholderone', amount: '10' }] };
        });
        await fillDividend();
        fireEvent.click(screen.getByRole('button', { name: 'Retry holder list' }));
        await flushTimers();
        expect(document.body.textContent).toMatch(/1 eligible holder/);

        fireEvent.click(screen.getByRole('button', { name: 'Pay dividend' }));
        await flushTimers();
        expect(messaging.composeForConfirm).toHaveBeenCalledOnce();
    });

    it('requires another review when the holder set changes', async () => {
        let attempt = 0;
        const one = [{ address: 'bc1qholderone', amount: '10' }];
        const two = [...one, { address: 'bc1qholdertwo', amount: '20' }];
        const messaging = mountDividend(async () => {
            attempt += 1;
            return attempt === 1 ? { total: 1, data: one } : { total: 2, data: two };
        });
        await fillDividend();
        fireEvent.click(screen.getByRole('button', { name: 'Pay dividend' }));
        await flushTimers();
        expect(document.body.textContent).toMatch(/holder list changed/i);
        expect(document.body.textContent).toMatch(/2 eligible holders/);
        expect(messaging.composeForConfirm).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Pay dividend' }));
        await flushTimers();
        expect(messaging.composeForConfirm).toHaveBeenCalledOnce();
    });
});
