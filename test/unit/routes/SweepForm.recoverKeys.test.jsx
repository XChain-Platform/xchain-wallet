// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { SweepForm } from '../../../packages/core/src/shared/routes/SweepForm.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = {
    id: 'addr-1',
    address: 'bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3',
    publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
};
const DESTINATION = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

function messagingFor(error) {
    const missingHash = 'b'.repeat(64);
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [SOURCE] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: SOURCE.id } }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getWalletBalances: vi.fn().mockResolvedValue({ [CHAIN]: [] }),
        sweepPreview: vi.fn().mockResolvedValue({ rows: [], gatedTicks: { rows: ['GATED'] } }),
        listGatedContent: vi.fn().mockResolvedValue([
            { keyHash: 'a'.repeat(64), files: [{ actionIndex: 101 }] },
            { keyHash: missingHash, files: [{ actionIndex: 102 }] },
        ]),
        listGatedKeys: vi.fn().mockResolvedValue([{ keyHash: 'a'.repeat(64) }]),
        copyGatedKeysToWallet: vi.fn().mockResolvedValue({ copied: 1, skipped: 0 }),
        gatedContentScan: vi.fn().mockRejectedValue(error),
    };
    return new Proxy(target, {
        get: (value, prop) => (prop in value ? value[prop] : () => Promise.resolve({ rows: [] })),
        has: (value, prop) => prop in value,
    });
}

async function runRecovery(error) {
    publishWalletModes({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
    const messaging = messagingFor(error);
    const { container } = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <SweepForm
                walletId="w"
                onBack={() => {}}
                initialChainId={CHAIN}
                initialFromAddress={SOURCE.address}
                migrateTo={{ walletId: 'new-wallet', name: 'New wallet', address: DESTINATION }}
            />
        </MessagingProvider>,
    );
    await waitFor(() => expect(container).toHaveTextContent('GATED: 1/2 unlock keys in the vault - missing'));
    fireEvent.click(within(container).getByRole('button', { name: /^Gated-Content Keys/ }));
    fireEvent.change(within(container).getByLabelText('Wallet password (key recovery scan)'), {
        target: { value: 'secret' },
    });
    fireEvent.click(within(container).getByRole('button', { name: 'Recover Keys' }));
    await waitFor(() => expect(messaging.gatedContentScan).toHaveBeenCalledTimes(1));
    return container;
}

afterEach(() => {
    cleanup();
    resetWalletModes();
});

describe('SweepForm key recovery errors', () => {
    it('shows authored recovery copy instead of a raw scan error', async () => {
        const container = await runRecovery(new Error('recoverGatedKeysForTick: tick is required'));

        await waitFor(() => expect(container).toHaveTextContent(
            'Could not recover unlock keys. Check your connection and try again.',
        ));
        expect(container).not.toHaveTextContent(/recoverGatedKeysForTick|tick is required/);
    });

    it('keeps the specific wrong-password message', async () => {
        const error = new Error('wrong password');
        error.name = 'InvalidPasswordError';
        const container = await runRecovery(error);

        await waitFor(() => expect(container).toHaveTextContent('Incorrect password.'));
        expect(container).not.toHaveTextContent('wrong password');
    });
});
