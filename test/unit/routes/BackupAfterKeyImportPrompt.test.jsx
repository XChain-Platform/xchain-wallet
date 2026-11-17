// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// After a private key import the wallet offers a backup file at once
// (operator ruling 2026-11-16): a key has no recovery phrase, so the encrypted
// backup is the only way to bring it back.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AddressList } from '../../../packages/core/src/shared/routes/AddressList.jsx';

const ACCOUNT = { id: 'account-a', index: 0, walletId: 'wallet-a' };
const IMPORTED = {
    id: 'address-imported',
    accountId: null,
    address: 'mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp',
    chain: 'bitcoin',
    network: 'regtest',
    source: 'imported-wif',
    addressType: 'p2pkh',
    derivationPath: null,
    label: '',
    role: 'receive',
};

afterEach(() => cleanup());

function messagingFor({ importWifRequest } = {}) {
    return {
        listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-a', name: 'Main Wallet', format: 'bip39' }]),
        listAccounts: vi.fn().mockResolvedValue([ACCOUNT]),
        getWalletBalances: vi.fn().mockResolvedValue({}),
        // Empty before the import; the imported key's address after it.
        getAddressesByChain: vi.fn()
            .mockResolvedValueOnce({})
            .mockResolvedValue({ 'bitcoin-regtest': [IMPORTED] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ schemaVersion: 1, activeNetwork: 'regtest', fees: { 'bitcoin-regtest': { strategy: 'normal' } } }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        importWifRequest: importWifRequest ?? vi.fn(async () => ({ address: { address: 'mq1XCn2HANMQ17vYYno9nzZf5Uwpisfarp' } })),
    };
}

async function importKey({ messaging, onExportBackup }) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <AddressList walletId="wallet-a" accountId={ACCOUNT.id} onBack={() => {}} onExportBackup={onExportBackup} />
        </MessagingProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Add or import address/i }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Import address/i }));
    fireEvent.change(await screen.findByLabelText(/WIF private key/i, { selector: 'input' }), {
        target: { value: 'cSV3exampleRegtestWifValue' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));
    await waitFor(() => expect(messaging.importWifRequest).toHaveBeenCalledTimes(1));
}

describe('backup prompt after a private key import', () => {
    it('offers Save Backup File, which opens the export', async () => {
        const onExportBackup = vi.fn();
        await importKey({ messaging: messagingFor(), onExportBackup });
        const prompt = await screen.findByTestId('backup-after-key-import');
        expect(prompt).toHaveTextContent('Back Up This Key');
        expect(prompt).toHaveTextContent(/A private key has no recovery phrase/);
        fireEvent.click(screen.getByRole('button', { name: 'Save Backup File' }));
        expect(onExportBackup).toHaveBeenCalledOnce();
        expect(screen.queryByTestId('backup-after-key-import')).toBeNull();
    });

    it('Not now dismisses it without opening the export', async () => {
        const onExportBackup = vi.fn();
        await importKey({ messaging: messagingFor(), onExportBackup });
        await screen.findByTestId('backup-after-key-import');
        fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
        expect(screen.queryByTestId('backup-after-key-import')).toBeNull();
        expect(onExportBackup).not.toHaveBeenCalled();
    });

    it('a failed import shows no prompt', async () => {
        const onExportBackup = vi.fn();
        const importWifRequest = vi.fn().mockRejectedValue(Object.assign(new Error('bad key'), { name: 'InvalidWifError' }));
        await importKey({ messaging: messagingFor({ importWifRequest }), onExportBackup });
        await waitFor(() => expect(screen.queryAllByText(/Could not import|not a valid|private key/i).length).toBeGreaterThan(0));
        expect(screen.queryByTestId('backup-after-key-import')).toBeNull();
    });
});
