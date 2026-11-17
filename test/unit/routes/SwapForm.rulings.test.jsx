// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { openSection } from '../../helpers/openFormSections.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

vi.mock('../../../packages/core/src/shared/routes/TokenPicker.jsx', () => ({
    TokenPicker: ({ title, onSelect }) => (
        <button type="button" onClick={() => onSelect({ chainId: CHAIN, tick: 'BETA' })}>
            Choose {title}
        </button>
    ),
}));

vi.mock('../../../packages/core/src/shared/components/ListPickerScreen.jsx', () => ({
    ListPickerScreen: ({ title, onSelect }) => (
        <button type="button" onClick={() => onSelect({ actionIndex: '7', name: title.includes('Allow') ? 'Team wallets' : undefined })}>
            Choose {title}
        </button>
    ),
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { SwapForm } from '../../../packages/core/src/shared/routes/SwapForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'address-1',
    address: 'bc1qswaphelpaddress',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};

afterEach(() => {
    // The Quick | Full choice is remembered per form; start each test on Quick.
    globalThis.localStorage?.clear();
    cleanup();
    resetWalletModes();
    vi.restoreAllMocks();
});

function messaging() {
    // The wallet's mode is read from the wallet list, not from settings.
    publishWalletModes({ wallets: [{ id: 'wallet-1', walletMode: 'watcher' }], activeWalletId: 'wallet-1' });
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1', name: 'W', walletMode: 'watcher' }]),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'watcher' }),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        getTokenInfo: vi.fn().mockResolvedValue({ divisibility: 8 }),
        buildActionPsbtRequest: vi.fn().mockResolvedValue({ txid: 'swap-txid' }),
    };
    return new Proxy(target, {
        get(api, prop) {
            if (prop in api) return api[prop];
            return vi.fn().mockResolvedValue(null);
        },
    });
}

function mount() {
    return render(
        <MessagingProvider shell="web" messaging={messaging()}>
            <SwapForm walletId="wallet-1" initialChainId={CHAIN} initialGiveTick="ALPHA" onBack={vi.fn()} />
        </MessagingProvider>,
    );
}

function expectIcon(button) {
    expect(button.querySelector('svg')).not.toBeNull();
}

async function openTip(name, copy) {
    fireEvent.click(await screen.findByRole('button', { name: `About ${name}` }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(copy);
    fireEvent.pointerDown(document.body);
}

describe('SwapForm UI rulings', () => {
    it('uses a named success action and field-specific help without static escrow hints', async () => {
        mount();

        const create = await screen.findByRole('button', { name: 'Create Swap' });
        expect(create).toHaveClass(buttonStyles.success);
        expectIcon(create);

        // Full view draws every field of the swap with its own help tip.
        fireEvent.click(screen.getByRole('radio', { name: 'Full' }));
        await openSection('From');
        await openSection('Swap Terms');
        await openTip('From address', 'address whose tokens are escrowed for this swap');
        await openTip('Give amount (ALPHA)', 'How many of the give token to escrow for this swap');
        await openTip('Get amount', 'matcher must provide in exchange');
        // Ownership is its own optional section in both input styles (operator 2026-11-13).
        await openSection('Ownership');
        await openTip(
            "Give this token's ownership instead of an amount",
            "token name's ownership record as a single-fill swap",
        );
        await openTip(
            "Require the matcher to give that token's ownership instead of an amount",
            "transfer the get token name's ownership record",
        );
        await openTip('Expiration', 'Cancel from My swaps or let the offer expire');
        // Memo is its own section with no label row or tip, as on every form.
        await openSection('Memo');
        expect(screen.getByRole('textbox', { name: 'Memo' })).toBeInTheDocument();

        expect(screen.queryByText(
            /Cancel from My swaps or let the offer expire to return the escrow to the source address/,
            { selector: 'p' },
        )).toBeNull();
        expect(screen.queryByText(
            'The give side stays escrowed until a match, cancellation, or expiration.',
        )).toBeNull();
    });

    it('keeps explicit icons and one success action through review and completion', async () => {
        mount();

        await screen.findByRole('button', { name: /Get token:/ });
        fireEvent.click(screen.getByRole('button', { name: /Get token:/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Select Get Token' }));
        fireEvent.change(screen.getByLabelText('Give amount (ALPHA)'), { target: { value: '2' } });
        fireEvent.change(screen.getByLabelText('Get amount (BETA)'), { target: { value: '3' } });

        fireEvent.click(screen.getByRole('button', { name: 'Create Swap' }));

        const reject = await screen.findByRole('button', { name: 'Reject' });
        const submit = screen.getByRole('button', { name: 'Approve' });
        expectIcon(reject);
        expect(submit).toHaveClass(buttonStyles.success);
        expectIcon(submit);
        expect(document.querySelectorAll(`button.${buttonStyles.success}`)).toHaveLength(1);

        fireEvent.click(submit);
        const done = await screen.findByRole('button', { name: 'Done' });
        expectIcon(done);
    });

    it('draws the allow and block lists as picker fields with icons, never grey buttons', async () => {
        mount();
        await screen.findByRole('button', { name: 'Create Swap' });
        // Allow and block lists live in their own Lists section (operator 2026-11-13).
        await openSection('Lists');

        expect(screen.queryByRole('button', { name: 'Set Allow-List' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Set Block-List' })).toBeNull();
        const setAllow = screen.getByRole('button', { name: 'Allow list: None set' });
        const setBlock = screen.getByRole('button', { name: 'Block list: None set' });
        expectIcon(setAllow);
        expectIcon(setBlock);

        fireEvent.click(setAllow);
        fireEvent.click(screen.getByRole('button', { name: 'Choose Choose Allow-List' }));
        // The field shows the picked list's name (G114).
        expect(screen.getByRole('button', { name: 'Allow list: Team wallets (List #7)' })).toBeInTheDocument();
        const clearAllow = await screen.findByRole('button', { name: 'Clear allow list' });
        expectIcon(clearAllow);
        fireEvent.click(clearAllow);
        expect(await screen.findByRole('button', { name: 'Allow list: None set' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Block list: None set' }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose Choose Block-List' }));
        // An unnamed list reads List #N.
        expect(screen.getByRole('button', { name: 'Block list: List #7' })).toBeInTheDocument();
        const clearBlock = await screen.findByRole('button', { name: 'Clear block list' });
        expectIcon(clearBlock);

        await waitFor(() => expect(screen.getByLabelText('Receive at')).toBeInTheDocument());
        expect(screen.getByLabelText('Receive at')).toHaveAttribute('aria-required', 'false');
        expect(screen.queryByLabelText('Receive at (optional)')).toBeNull();
    });
});
