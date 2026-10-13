// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

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

afterEach(() => cleanup());

async function reachDone() {
    const onBack = vi.fn();
    const onMigrated = vi.fn();
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({}),
        addImportedWallet: vi.fn().mockResolvedValue({ walletId: 'wallet-new' }),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <MigrateToBip39
                legacyWalletId="wallet-old"
                onBack={onBack}
                onMigrated={onMigrated}
            />
        </MessagingProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password1' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
        target: { value: 'password1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create BIP39 wallet' }));

    expect(await screen.findByText('Write down your recovery phrase')).toBeTruthy();
    expect(onMigrated).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue to sweep' }));
    expect(await screen.findByText('New BIP39 wallet ready')).toBeTruthy();
    expect(onMigrated).not.toHaveBeenCalled();
    return { onBack, onMigrated };
}

describe('MigrateToBip39 completion', () => {
    it('keeps the recovery phrase on screen and notifies the shell only when done', async () => {
        const { onBack, onMigrated } = await reachDone();

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));
        await waitFor(() => expect(onMigrated).toHaveBeenCalledWith('wallet-new'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('uses the same completion path from the final Back control', async () => {
        const { onBack, onMigrated } = await reachDone();

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));

        await waitFor(() => expect(onMigrated).toHaveBeenCalledWith('wallet-new'));
        expect(onBack).toHaveBeenCalledTimes(1);
    });
});
