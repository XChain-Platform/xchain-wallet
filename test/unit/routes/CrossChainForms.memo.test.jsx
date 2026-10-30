// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The cross-chain order and swap forms refuse a memo the chain would refuse:
// over 250 UTF-8 bytes, or carrying control characters or a text-direction
// override. Both are caught at the form instead of by the pre-flight, or by the
// indexer once the fee is spent.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act as domAct, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => React.createElement(
        'button',
        { type: 'button', onClick: () => onSelect({ tick: title.includes('give') ? 'AAA' : 'BBB' }) },
        title,
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CrossChainOrderForm } from '../../../packages/core/src/shared/routes/CrossChainOrderForm.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';

const DOGE = 'dogecoin-mainnet';
const BTC = 'bitcoin-mainnet';
const DOGE_ADDRESS = { id: 'addr-doge-0', address: 'Ddevmock02aabbcc', publicKey: '02aabbcc', derivationPath: "m/44'/3'/0'/0/0", source: 'hd', signerId: 'signer-1' };
const BTC_ADDRESS = { id: 'addr-btc-0', address: 'bc1qdevmock02ddeeff', publicKey: '02ddeeff', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1' };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const drain = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

async function mount(Form) {
    const composeForConfirm = vi.fn(async () => ({ psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0 }));
    const base = {
        getAddressesByChain: () => Promise.resolve({ [DOGE]: [DOGE_ADDRESS], [BTC]: [BTC_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getNewestAddress: () => Promise.resolve(BTC_ADDRESS),
        signerReady: () => Promise.resolve({ ready: true }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        getWalletBalances: () => Promise.resolve({}),
        composeForConfirm,
        preflight: () => Promise.resolve({ verdict: 'pass', findings: [] }),
    };
    const messaging = new Proxy(base, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return () => Promise.resolve(null);
        },
    });
    let utils;
    await domAct(async () => {
        utils = render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Form, { walletId: 'w', onBack() {}, initialChainId: DOGE }),
        ));
        await drain();
    });
    return { utils, composeForConfirm };
}

const change = async (utils, label, value) => {
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText(label), { target: { value } });
        await drain();
    });
};

async function fillOrder(utils) {
    await change(utils, 'Give token', 'AAA');
    await change(utils, /^Give amount/, '1');
    await change(utils, 'Get token', 'BBB');
    await change(utils, /^Get amount/, '1');
}

async function fillSwap(utils) {
    for (const name of [/Give token/, /Get token/]) {
        await domAct(async () => {
            fireEvent.click(utils.getAllByRole('button', { name }).find((b) => b.getAttribute('aria-label') || true));
            await drain();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: /Select (give|get) token/ }));
            await drain();
        });
    }
    await change(utils, /^Give amount/, '1');
    await change(utils, /^Get amount/, '1');
}

const MEMOS = [
    ['over 250 bytes', 'x'.repeat(251), /251 bytes; the network accepts at most 250 bytes/],
    // The shared action-text refusal answers first, before the memo's own check.
    ['a bidirectional override', 'pay ‮txt.exe', /Memo cannot contain text-direction control characters/],
    ['a tab', 'a\tb', /Memo cannot contain control characters/],
];

describe.each([
    ['CrossChainOrderForm', CrossChainOrderForm, fillOrder, 'Place order'],
    ['CrossChainSwapForm', CrossChainSwapForm, fillSwap, 'Review'],
])('%s memo', (_name, Form, fill, submitName) => {
    it.each(MEMOS)('refuses a memo %s before composing', async (_label, memo, message) => {
        const { utils, composeForConfirm } = await mount(Form);
        await fill(utils);
        await change(utils, /^Memo/, memo);

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: submitName }));
            await drain();
        });

        expect(utils.container.textContent).toMatch(message);
        expect(composeForConfirm).not.toHaveBeenCalled();
    });

    it('accepts a memo of exactly 250 bytes', async () => {
        const { utils, composeForConfirm } = await mount(Form);
        await fill(utils);
        await change(utils, /^Memo/, 'x'.repeat(250));

        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: submitName }));
            await drain();
        });

        expect(composeForConfirm).toHaveBeenCalledTimes(1);
    });
});
