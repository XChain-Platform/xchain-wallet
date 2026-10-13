// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// An address with no coin in it says so before Send, and the encoder's
// "no spendable UTXOs" refusal reads as plain words if it is reached anyway.
// On a phone the form showed "0 BTC available", no warning, and then
// "Couldn't send. no spendable UTXOs found for the funding address."

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import { humanizeError } from '../../../packages/core/src/shared/utils/humanizeError.js';

const CHAIN_ID = 'bitcoin-mainnet';
const FROM = 'bc1qsendersendersendersendersendersendersa';

function mount(quantity) {
    const base = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [CHAIN_ID]: [{ id: 'addr-1', address: FROM, publicKey: '02ab', derivationPath: "m/84'/0'/0'/0/0", source: 'hd' }],
        }),
        getAddressBalances: vi.fn().mockResolvedValue({
            native: { tick: 'BTC', quantity, divisibility: 8 },
            tokens: [],
        }),
        getSettings: vi.fn().mockResolvedValue({ grace: { testSendThresholdSats: 0 } }),
        listContacts: vi.fn().mockResolvedValue([]),
        getRecentDestinations: vi.fn().mockResolvedValue([]),
    };
    const messaging = new Proxy(base, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            const stub = vi.fn().mockResolvedValue(null);
            target[prop] = stub;
            return stub;
        },
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Send, { walletId: 'w', onBack() {} }),
    ));
}

afterEach(() => cleanup());

describe('Send from an address holding no coin', () => {
    it('warns before Send when the native balance is zero', async () => {
        mount('0');
        expect(await screen.findByText(/This address holds no BTC/, {}, { timeout: 10_000 })).toBeTruthy();
    }, 20_000);

    it('stays quiet when the address holds coin', async () => {
        mount('100000000');
        await screen.findByText(/BTC available/, {}, { timeout: 10_000 });
        expect(screen.queryByText(/This address holds no BTC/)).toBeNull();
    }, 20_000);
});

describe('humanizeError for the encoder no-UTXO refusal', () => {
    it('says the address has no coins instead of naming UTXOs', () => {
        const h = humanizeError(new Error('no spendable UTXOs found for the funding address'), 'send');
        expect(h.message).toMatch(/has no coins to spend yet/);
        expect(h.message).not.toMatch(/UTXO/);
        expect(h.cause).toBe('insufficient_funds');
    });
});
