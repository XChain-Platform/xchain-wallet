// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A recipient list that reached the network stays the airdrop in progress even when
// saving the resume record fails afterwards: the form moves on to wait for the
// list to index instead of reporting a failed broadcast that invites a second list.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AirdropForm } from '../../../packages/core/src/shared/routes/AirdropForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = 'bc1qexampleexampleexampleexampleexampleex';
// Real bitcoin-mainnet addresses: the recipient parser is network-aware
//, so placeholder strings would be counted as invalid and never
// reach the divisor.
const RECIPIENTS = [
    'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    '1FWDonkMbC6hL64JiysuggHnUAw2CKWszs',
];

const ADDRESSES = {
    [CHAIN]: [{
        id: 'addr-1',
        address: SOURCE,
        publicKey: '02ab',
        derivationPath: "m/84'/0'/0'/0/0",
        source: 'hd',
        signerId: 'signer-1',
    }],
};

// Wallet balances arrive base-scaled; the balance lookup divides by
// divisibility, so the mock hands over the shape the host really does
// rather than a display string.
function baseUnits(decimalAmount, divisibility = 8) {
    const [int = '0', frac = ''] = String(decimalAmount).split('.');
    return `${int}${frac.padEnd(divisibility, '0')}`.replace(/^0+(?=\d)/, '');
}


function mountAirdrop(overrides = {}) {
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue(ADDRESSES),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'XCHAIN', divisibility: 8, locks: {} }),
        getWalletBalances: vi.fn().mockResolvedValue({
            [CHAIN]: [{
                address: SOURCE,
                balances: {
                    native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                    tokens: [{ tick: 'XCHAIN', quantity: '999900000000', divisibility: 8 }],
                },
            }],
        }),
        getListsForSource: vi.fn().mockResolvedValue([]),
        composeForConfirm: vi.fn().mockResolvedValue({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 1 }),
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
        checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
        requoteNativeFee: vi.fn().mockResolvedValue(null),
        reserve: vi.fn().mockResolvedValue({}),
        releaseReservation: vi.fn().mockResolvedValue({}),
        putConfirmSession: vi.fn().mockResolvedValue({ id: 'cs' }),
        clearConfirmSession: vi.fn().mockResolvedValue({}),
        createList: vi.fn().mockResolvedValue({ txid: 'listtxid' }),
        savePendingAirdrop: vi.fn().mockRejectedValue(new Error('storage full')),
        getActionByTxid: vi.fn().mockResolvedValue(null),
        ...overrides,
    };
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(AirdropForm, { walletId: 'w', initialChainId: CHAIN, initialTick: 'XCHAIN', onBack() {} }),
    ));
    return messaging;
}

async function flushTimers() {
    for (let pass = 0; pass < 3; pass += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    }
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); __clearTokenInfoCache(); vi.useRealTimers(); });

describe('AirdropForm after the recipient list is broadcast', () => {
    it('waits for the list to index when the resume record cannot be saved', async () => {
        const messaging = mountAirdrop();
        await flushTimers();
        fireEvent.change(screen.getByRole('textbox', { name: 'Recipients' }), { target: { value: RECIPIENTS.join('\n') } });
        fireEvent.change(screen.getByLabelText(/^Per-recipient amount/), { target: { value: '1' } });
        await flushTimers();
        fireEvent.click(screen.getByRole('button', { name: /^Review recipients$/ }));
        await flushTimers();
        fireEvent.click(screen.getByRole('button', { name: /^Sign/ }));
        await flushTimers();
        fireEvent.click(screen.getByTestId('confirm-approve'));
        await flushTimers();
        await flushTimers();
        expect(messaging.savePendingAirdrop).toHaveBeenCalled();
        expect(document.body.textContent).not.toMatch(/Recipient list broadcast failed|storage full/);
        expect(messaging.getActionByTxid).toHaveBeenCalled();
    });
});
