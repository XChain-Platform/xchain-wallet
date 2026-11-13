// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Destroy, Mint, Dividend, Pause token (SLEEP), Callback, Airdrop and the
// contract deposit, funds and stake forms act on ledger tokens only: each
// handler resolves its ticker against the token table, where BTC, LTC and DOGE
// are reserved and never issued. Their pickers must not offer the network
// coin. A picker pins kindFilter="tokens" with kindLocked, which drops native
// rows and hides the Coins / Tokens choice.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { TokenPicker } from '../../../packages/core/src/shared/routes/TokenPicker.jsx';
import { DestroyForm } from '../../../packages/core/src/shared/routes/DestroyForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const BALANCES = {
    [CHAIN]: [{
        address: SOURCE.address,
        balances: {
            native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
            tokens: [{ tick: 'ART', quantity: '25', divisibility: 0 }],
        },
        error: null,
    }],
};

// Every token-only picker, as `file#n` where n counts that file's TokenPicker
// tags in source order.
const TOKEN_ONLY_PICKERS = [
    'DestroyForm.jsx#0',
    'MintForm.jsx#0',
    'DividendForm.jsx#0',
    'DividendForm.jsx#1',
    'SleepForm.jsx#0',
    'CallbackForm.jsx#0',
    'AirdropForm.jsx#0',
    'AirdropForm.jsx#1',
    'ContractFundsForm.jsx#0',
    'ContractStakeForm.jsx#0',
    'ExecuteContractForm.jsx#0',
];

// The opening tag from `<TokenPicker` to its closing `>`, skipping `>` inside braces.
function openingTag(src, start) {
    let depth = 0;
    for (let i = start; i < src.length; i += 1) {
        const c = src[i];
        if (c === '{') depth += 1;
        else if (c === '}') depth -= 1;
        else if (c === '>' && depth === 0) return src.slice(start, i + 1);
    }
    return src.slice(start);
}

function pickerTag(key) {
    const [file, n] = key.split('#');
    const src = readFileSync(join(process.cwd(), 'packages/core/src/shared/routes', file), 'utf8');
    const starts = [...src.matchAll(/<TokenPicker(?=[\s/>])/g)].map((m) => m.index);
    return starts[Number(n)] === undefined ? null : openingTag(src, starts[Number(n)]);
}

const COIN_ROW = (name) => /^Select (BTC|Bitcoin)\b/.test(name);

function mountPicker(purpose, pinned = true) {
    const messaging = {
        getSettings: vi.fn().mockResolvedValue({}),
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
    };
    const kind = pinned ? { kindFilter: 'tokens', kindLocked: true } : {};
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <TokenPicker purpose={purpose} walletId="w" {...kind} onBack={() => {}} onSelect={() => {}} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    __clearTokenInfoCache?.();
});

describe('token-only pickers never offer the network coin', () => {
    it.each(TOKEN_ONLY_PICKERS)('%s pins the picker to tokens', (key) => {
        const tag = pickerTag(key);
        expect(tag, `${key} has no TokenPicker at that position`).not.toBeNull();
        expect(tag).toMatch(/\skindFilter="tokens"/);
        expect(tag).toMatch(/\skindLocked(?=[\s/>])/);
    });

    it.each(['send', 'receive'])('an unpinned %s picker does list the coin (the check below is not vacuous)', async (purpose) => {
        mountPicker(purpose, false);
        await screen.findByRole('button', { name: COIN_ROW });
    });

    it.each(['send', 'receive'])('a %s picker pinned to tokens lists the token and not the coin', async (purpose) => {
        mountPicker(purpose);
        await screen.findByRole('button', { name: (name) => name.startsWith('Select ART on Bitcoin') });
        expect(screen.queryByRole('button', { name: COIN_ROW })).toBeNull();
        // The Coins / Tokens choice is not offered, so the coin cannot be brought back.
        fireEvent.click(screen.getByRole('button', { name: 'Filter coins and tokens' }));
        expect(screen.queryByRole('combobox', { name: 'Asset kind' })).toBeNull();
        expect(screen.queryByRole('button', { name: /Asset kind/ })).toBeNull();
    });

    it('Destroy opens a picker that lists the held token but not BTC', async () => {
        const messaging = {
            getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
            getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: SOURCE }),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: true }),
            getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
            getTokenInfo: vi.fn().mockResolvedValue({ chainId: CHAIN, tick: 'ART', divisibility: 0, locks: {} }),
            getWalletBalances: vi.fn().mockResolvedValue(BALANCES),
        };
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DestroyForm walletId="w" initialChainId={CHAIN} initialFromAddress={SOURCE.address} onBack={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.click(await screen.findByRole('button', { name: /^Token:/ }));
        await screen.findByRole('button', { name: (name) => name.startsWith('Select ART on Bitcoin') });
        await waitFor(() => expect(messaging.getWalletBalances).toHaveBeenCalled());
        expect(screen.queryByRole('button', { name: COIN_ROW })).toBeNull();
    });
});
