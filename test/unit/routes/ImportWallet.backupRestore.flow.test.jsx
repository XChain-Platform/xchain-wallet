// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { WalletPicker } from '../../../packages/core/src/shared/routes/WalletPicker.jsx';
import { encryptWalletSeed } from '../../../packages/core/src/crypto/walletBlob.js';
import {
    exportBackupFile,
    importBackupFile,
} from '../../../packages/core/src/flows/backupFile.js';
import { ARGON2ID_TEST_TIMEOUT_MS } from '../../helpers/argon2idTimeout.js';
import { chooseBackupFile, chooseRefusedBackupFile } from '../../helpers/backupFileChoice.js';

vi.setConfig({ testTimeout: ARGON2ID_TEST_TIMEOUT_MS });

const BACKUP_PASSWORD = 'backup-file-password';
const WALLET_PASSWORD = 'source-wallet-password';
const KDF_PARAMS = {
    algorithm: 'argon2id',
    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
    iterations: 2,
    memory: 8192,
    parallelism: 1,
};

function collection(initial = []) {
    const records = new Map(initial.map((record) => [record.id, structuredClone(record)]));
    return {
        get: async (id) => records.has(id) ? structuredClone(records.get(id)) : null,
        list: async () => Array.from(records.values(), (record) => structuredClone(record)),
        put: async (record) => { records.set(record.id, structuredClone(record)); },
    };
}

function vault(initialWallets = []) {
    return {
        wallets: collection(initialWallets),
        accounts: collection(),
        addresses: collection(),
        contacts: collection(),
        connectedSites: collection(),
        signers: collection(),
        pendingTxs: collection(),
        settings: { get: async () => null, put: async () => {} },
    };
}

async function backupFile() {
    const sealed = await encryptWalletSeed({
        password: WALLET_PASSWORD,
        seed: new TextEncoder().encode(
            'legal winner thank year wave sausage worth useful legal winner thank yellow',
        ),
        kdfParams: KDF_PARAMS,
    });
    const wallet = {
        id: 'wallet-from-backup',
        schemaVersion: 3,
        name: 'Restored savings',
        createdAt: '2026-10-13T12:00:00.000Z',
        origin: 'created',
        format: 'bip39',
        passphraseEnabled: false,
        encryptionAlgorithm: 'aes-256-gcm',
        encryptedSeed: sealed.encryptedSeed,
        encryptedPassphrase: null,
        kdfParams: sealed.kdfParams,
        importedKeys: [],
        multisigs: [],
    };
    const result = await exportBackupFile({
        vault: vault([wallet]),
        walletId: wallet.id,
        password: BACKUP_PASSWORD,
        kdfParams: KDF_PARAMS,
    });
    return result.fileContent;
}

function RestoreFlow() {
    const [restored, setRestored] = useState(false);
    if (!restored) {
        return (
            <ImportWallet
                mode="add"
                onBack={() => {}}
                onImported={() => setRestored(true)}
            />
        );
    }
    return (
        <WalletPicker
            activeWalletId="wallet-already-here"
            onSwitch={() => {}}
            onAddWallet={() => {}}
            onBack={() => {}}
        />
    );
}

function typePassword(label, value) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(cleanup);

describe('encrypted backup restore flow', () => {
    it('recovers from wrong-password and corrupt-file errors, then lists the restored wallet', async () => {
        const fileContent = await backupFile();
        const target = vault([{
            id: 'wallet-already-here',
            name: 'Daily wallet',
            format: 'bip39',
        }]);
        const messaging = {
            importBackupRequest: vi.fn((request) => importBackupFile({ vault: target, ...request })),
            listWallets: vi.fn(() => target.wallets.list()),
        };

        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <RestoreFlow />
            </MessagingProvider>,
        );
        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));

        await chooseBackupFile({ content: fileContent, name: 'savings.xchain-wallet' });
        // The summary card reads the file's own header: the name it was saved under.
        expect(screen.getByRole('region', { name: 'Chosen backup file' })).toHaveTextContent('Restored savings');
        typePassword('Backup password', 'wrong-backup-password');
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        expect(await screen.findByRole('alert', { name: 'Form errors' })).toHaveTextContent("That password doesn't open this backup.");
        expect(await target.wallets.list()).toHaveLength(1);

        // A corrupt file is refused where it is chosen; nothing is sent.
        const refusal = await chooseRefusedBackupFile('{not valid json', 'corrupt.xchain-wallet');
        expect(refusal).toHaveTextContent(/isn't a wallet backup file this app can read/i);
        expect(messaging.importBackupRequest).toHaveBeenCalledTimes(1);

        // The right file password opens the file, but the wallet inside was
        // sealed under another one, so the screen asks for it in its own field.
        await chooseBackupFile({ content: fileContent, name: 'savings.xchain-wallet' });
        typePassword('Backup password', BACKUP_PASSWORD);
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await screen.findByLabelText('Wallet password');
        expect(await target.wallets.list()).toHaveLength(1);

        typePassword('Wallet password', WALLET_PASSWORD);
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        expect(await screen.findByRole('heading', { name: 'Automatic Donations' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

        await waitFor(() => expect(messaging.listWallets).toHaveBeenCalledTimes(1));
        expect(await screen.findByText(/Daily wallet/)).toBeTruthy();
        expect(screen.getByText(/Restored savings/)).toBeTruthy();
        expect(await target.wallets.list()).toHaveLength(2);
        expect(messaging.importBackupRequest).toHaveBeenCalledTimes(3);
    });
});
