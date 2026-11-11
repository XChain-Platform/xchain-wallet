// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button
            type="button"
            onClick={() => onSelect({
                chainId: title.includes('give') ? DOGE : BTC,
                tick: title.includes('give') ? 'ALPHA' : 'BETA',
            })}
        >
            Choose {title}
        </button>
    ),
}));

vi.mock('../../../packages/core/src/shared/components/OwnAddressPickerScreen.jsx', () => ({
    OwnAddressPickerScreen: ({ title, chainId, lockNetwork, onPick }) => (
        <div>
            <h1>{title}</h1>
            <span data-testid="picker-chain">{chainId}</span>
            <span data-testid="picker-lock">{lockNetwork ? 'locked' : 'switchable'}</span>
            <button
                type="button"
                onClick={() => onPick({ id: 'picked-btc', address: PICKED_BTC_ADDRESS })}
            >
                Pick receiving address
            </button>
        </div>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CrossChainSwapForm } from '../../../packages/core/src/shared/routes/CrossChainSwapForm.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const DOGE = 'dogecoin-mainnet';
const BTC = 'bitcoin-mainnet';
const BTC_ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const PICKED_BTC_ADDRESS = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
const address = (id, value) => ({
    id,
    address: value,
    publicKey: '02aabbcc',
    derivationPath: "m/44'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const DOGE_ADDRESS = address('doge-1', 'D7Y55J3zQWnE6vKFHFXY4Kt7KXJ2RzHgC7');
const OWN_BTC_ADDRESS = address('btc-1', BTC_ADDRESS);

function messaging() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [DOGE]: [DOGE_ADDRESS],
            [BTC]: [OWN_BTC_ADDRESS],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getNewestAddress: vi.fn().mockResolvedValue(OWN_BTC_ADDRESS),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'watcher' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'watcher' }),
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 8 }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ txid: 'swap-txid' }),
    };
    return new Proxy(target, {
        get(api, prop) {
            if (prop in api) return api[prop];
            if (typeof prop !== 'string' || prop === 'then') return undefined;
            api[prop] = vi.fn().mockResolvedValue(null);
            return api[prop];
        },
    });
}

function mount() {
    return render(
        <MessagingProvider shell="web" messaging={messaging()}>
            <CrossChainSwapForm walletId="wallet-1" onBack={vi.fn()} />
        </MessagingProvider>,
    );
}

function expectIcon(button) {
    expect(button.querySelector('svg')).not.toBeNull();
}

function openTip(name, copy) {
    fireEvent.click(screen.getByRole('button', { name: `About ${name}` }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(copy);
    fireEvent.pointerDown(document.body);
}

async function chooseTokensAndAmounts() {
    await screen.findByRole('button', { name: /Give token:/ });
    fireEvent.click(screen.getByRole('button', { name: /Give token:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose Select give token' }));
    fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose Select get token' }));
    fireEvent.change(screen.getByLabelText('Give amount (ALPHA)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Get amount (BETA)'), { target: { value: '3' } });
}

afterEach(() => {
    cleanup();
    __clearTokenInfoCache();
    vi.restoreAllMocks();
});

describe('CrossChainSwapForm UI rulings', () => {
    it('uses a named success action and field-specific help without static escrow hints', async () => {
        mount();

        const create = await screen.findByRole('button', { name: 'Create cross-chain swap' });
        expect(create).toHaveClass(buttonStyles.success);
        expectIcon(create);
        await screen.findByRole('button', { name: 'Choose source address' });

        expect(screen.queryByText(
            'The give side stays escrowed until a match, cancellation, or expiration.',
        )).toBeNull();
        expect(screen.queryByText(
            /Cancel from My swaps or let the offer expire to return the escrow to the source address/,
            { selector: 'p' },
        )).toBeNull();

        openTip('From', 'address on the give network whose tokens are escrowed');
        openTip('Give amount', 'give side stays escrowed until a match');
        openTip(
            "Give this token's ownership (not a balance)",
            "give token name's ownership record",
        );
        openTip('Receive at', 'address on the get network');
        openTip('Get amount', 'matcher must provide on the get network');
        openTip(
            "Require the matcher to give that token's ownership",
            "get token name's ownership record across chains",
        );
        openTip('Expiration', 'Cancel from My swaps or let the offer expire');
        openTip('Memo', 'public note stored with this cross-chain swap');

        fireEvent.click(screen.getByLabelText('Expire at a specific time'));
        openTip('Expires', 'local date and time');
        expect(screen.getByRole('button', { name: 'About Give network' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Get network' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Give token' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Get token' })).toBeInTheDocument();
    });

    it('opens a get-network own-address picker and keeps the selected address editable', async () => {
        mount();
        const receive = await screen.findByRole('textbox', { name: 'Receive at' });
        await waitFor(() => expect(receive).toHaveValue(BTC_ADDRESS));

        fireEvent.click(screen.getByRole('button', { name: 'Choose receiving address' }));
        expect(screen.getByRole('heading', { name: 'Receive at' })).toBeInTheDocument();
        expect(screen.getByTestId('picker-chain')).toHaveTextContent(BTC);
        expect(screen.getByTestId('picker-lock')).toHaveTextContent('locked');
        fireEvent.click(screen.getByRole('button', { name: 'Pick receiving address' }));

        expect(await screen.findByRole('textbox', { name: 'Receive at' })).toHaveValue(PICKED_BTC_ADDRESS);
        fireEvent.change(screen.getByRole('textbox', { name: 'Receive at' }), {
            target: { value: BTC_ADDRESS },
        });
        expect(screen.getByRole('textbox', { name: 'Receive at' })).toHaveValue(BTC_ADDRESS);
        expect(screen.getByRole('button', { name: 'Get network: Bitcoin' })).toBeInTheDocument();
    });

    it('keeps explicit icons and one success action through review and completion', async () => {
        mount();
        await chooseTokensAndAmounts();

        fireEvent.click(screen.getByRole('button', { name: 'Create cross-chain swap' }));

        const edit = await screen.findByRole('button', { name: 'Edit' });
        const back = screen.getByRole('button', { name: 'Back to previous screen' });
        const submit = screen.getByRole('button', {
            name: 'Create unsigned cross-chain swap transaction',
        });
        expectIcon(edit);
        expectIcon(back);
        expect(submit).toHaveClass(buttonStyles.success);
        expectIcon(submit);
        expect(document.querySelectorAll(`button.${buttonStyles.success}`)).toHaveLength(1);

        fireEvent.click(submit);
        const done = await screen.findByRole('button', { name: 'Done' });
        expectIcon(done);
    });
});
