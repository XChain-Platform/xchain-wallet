// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A Counterwallet phrase restores every used address on a chain, and tokens
// sit on whichever of them received them. The migration's sweep list offers a
// row for each legacy address the wallet can sign for, so holdings on a second
// or later address are never left out of the migration.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const WORDS = PHRASE.split(' ');
const CHAIN = 'migration-test-chain';
const OTHER_CHAIN = 'migration-other-chain';

const legacy = (index, extra = {}) => ({
    id: `legacy-${index}`,
    address: `legacy-address-${index}`,
    derivationPath: `m/0'/0/${index}`,
    source: 'hd',
    ...extra,
});
const NEW_ADDRESS = {
    id: 'new-address-id',
    address: 'new-address',
    derivationPath: "m/44'/0'/0'/0/0",
    source: 'hd',
};
const NEW_OTHER = {
    id: 'new-other-id',
    address: 'new-other-address',
    derivationPath: "m/44'/2'/0'/0/0",
    source: 'hd',
};

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        crypto: {
            ...actual.crypto,
            generateBip39Mnemonic: () => PHRASE,
        },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MigrateToBip39 } from '../../../packages/core/src/shared/routes/MigrateToBip39.jsx';

afterEach(() => {
    cleanup();
    localStorage.clear();
});

async function reachDone(legacyByChain, newByChain) {
    const messaging = {
        getAddressesByChain: vi.fn(async (walletId) => (walletId === 'wallet-old' ? legacyByChain : newByChain)),
        addImportedWallet: vi.fn().mockResolvedValue({ walletId: 'wallet-new' }),
    };
    const onSweepChain = vi.fn();
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MigrateToBip39
                legacyWalletId="wallet-old"
                onBack={vi.fn()}
                onMigrated={vi.fn()}
                onSweepChain={onSweepChain}
            />
        </MessagingProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate recovery phrase' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reveal recovery phrase' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Verify recovery phrase' }));
    await screen.findByRole('heading', { level: 1, name: 'Verify your written copy' });
    for (const input of screen.getAllByLabelText(/^Word \d+$/)) {
        const position = Number(input.labels[0].textContent.match(/\d+/)[0]);
        fireEvent.change(input, { target: { value: WORDS[position - 1] } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create BIP39 wallet' }));
    await screen.findByRole('heading', { level: 1, name: 'New BIP39 wallet ready' });
    await waitFor(() => expect(messaging.getAddressesByChain).toHaveBeenCalledTimes(2));
    return { onSweepChain };
}

describe('MigrateToBip39 sweep list covers every legacy address', () => {
    it('offers a sweep for each legacy receive address on a chain, in index order', async () => {
        const { onSweepChain } = await reachDone(
            {
                [CHAIN]: [
                    legacy(2),
                    legacy(0),
                    // A change address holds no tokens of its own and gets no row.
                    { ...legacy(9), id: 'legacy-change', address: 'legacy-change', derivationPath: "m/0'/1/0" },
                    legacy(1),
                ],
            },
            { [CHAIN]: [NEW_ADDRESS] },
        );

        const buttons = await screen.findAllByRole('button', { name: 'Review sweep' });
        expect(buttons).toHaveLength(3);
        expect(screen.queryByText('legacy-change')).toBeNull();
        buttons.forEach((button) => fireEvent.click(button));
        expect(onSweepChain.mock.calls.map(([call]) => call.fromAddress)).toEqual([
            'legacy-address-0',
            'legacy-address-1',
            'legacy-address-2',
        ]);
        for (const [call] of onSweepChain.mock.calls) {
            expect(call).toMatchObject({
                legacyWalletId: 'wallet-old',
                newWalletId: 'wallet-new',
                chainId: CHAIN,
                toAddress: NEW_ADDRESS.address,
            });
        }
    });

    it('offers a sweep for a key imported into the legacy wallet', async () => {
        const { onSweepChain } = await reachDone(
            {
                [CHAIN]: [
                    legacy(0),
                    { id: 'legacy-wif', address: 'legacy-imported', source: 'imported-wif' },
                    // Watch-only addresses hold no key, so nothing can sign their sweep.
                    { id: 'legacy-watch', address: 'legacy-watched', source: 'watch-only' },
                ],
                [OTHER_CHAIN]: [legacy(0, { id: 'other-0', address: 'other-legacy-0' })],
            },
            { [CHAIN]: [NEW_ADDRESS], [OTHER_CHAIN]: [NEW_OTHER] },
        );

        const buttons = await screen.findAllByRole('button', { name: 'Review sweep' });
        expect(buttons).toHaveLength(3);
        expect(screen.queryByText('legacy-watched')).toBeNull();
        buttons.forEach((button) => fireEvent.click(button));
        expect(onSweepChain.mock.calls.map(([call]) => [call.chainId, call.fromAddress, call.toAddress])).toEqual([
            [CHAIN, 'legacy-address-0', NEW_ADDRESS.address],
            [CHAIN, 'legacy-imported', NEW_ADDRESS.address],
            [OTHER_CHAIN, 'other-legacy-0', NEW_OTHER.address],
        ]);
    });
});
