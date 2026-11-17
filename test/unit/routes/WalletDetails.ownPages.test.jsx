// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Wallet Details opens Export backup and Remove wallet as pages for the
// wallet on screen, which need not be the active one. Export Backup exports
// that wallet without switching the active wallet; each shell routes both
// actions to their pages for that wallet.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { WalletDetails } from '../../../packages/core/src/shared/routes/WalletDetails.jsx';
import { ExportWalletBackup } from '../../../packages/core/src/shared/routes/ExportWalletBackup.jsx';

const ACTIVE = { id: 'wallet-active', name: 'Everyday', format: 'bip39', origin: 'created', passphraseEnabled: false };
const CHOSEN = { id: 'wallet-chosen', name: 'Cold Vault', format: 'bip39', origin: 'created', passphraseEnabled: false };

let originalCreateObjectURL;
let originalRevokeObjectURL;
let originalAnchorClick;

afterEach(() => {
    cleanup();
    if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
    if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
    if (originalAnchorClick) HTMLAnchorElement.prototype.click = originalAnchorClick;
    vi.restoreAllMocks();
});

async function renderDetails(props) {
    const messaging = {
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        listAccounts: () => Promise.resolve([]),
        listWallets: () => Promise.resolve([ACTIVE, CHOSEN]),
    };
    await act(async () => {
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <WalletDetails walletId={CHOSEN.id} activeWalletId={ACTIVE.id} onBack={() => {}} {...props} />
            </MessagingProvider>,
        );
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
}

describe('Wallet Details actions open pages for the wallet on screen', () => {
    it('hands the chosen wallet, not the active one, to Export backup and Remove wallet', async () => {
        const onExportBackup = vi.fn();
        const onRemoveWallet = vi.fn();
        const onOpenSettings = vi.fn();
        await renderDetails({ onExportBackup, onRemoveWallet, onOpenSettings });

        fireEvent.click(screen.getByRole('button', { name: /^Export Backup/ }));
        expect(onExportBackup).toHaveBeenCalledTimes(1);
        expect(onExportBackup.mock.calls[0][0].id).toBe(CHOSEN.id);

        fireEvent.click(screen.getByRole('button', { name: /^Remove wallet/ }));
        expect(onRemoveWallet).toHaveBeenCalledTimes(1);
        expect(onRemoveWallet.mock.calls[0][0].id).toBe(CHOSEN.id);

        // Neither borrows the Settings backup page.
        expect(onOpenSettings).not.toHaveBeenCalled();
    });
});

describe('<ExportWalletBackup>', () => {
    it('exports the wallet the page was opened for', async () => {
        originalCreateObjectURL = URL.createObjectURL;
        originalRevokeObjectURL = URL.revokeObjectURL;
        originalAnchorClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = vi.fn(() => 'blob:backup-test');
        URL.revokeObjectURL = vi.fn();
        HTMLAnchorElement.prototype.click = function click() {};

        const exportBackupFile = vi.fn(async () => ({ fileContent: '{"magic":"XCHAIN-WALLET-BACKUP"}' }));
        render(
            <MessagingProvider shell="web" messaging={{ exportBackupFile }}>
                <ExportWalletBackup walletId={CHOSEN.id} walletName={CHOSEN.name} onBack={() => {}} />
            </MessagingProvider>,
        );

        expect(screen.getByRole('heading', { name: 'Export Backup' })).toBeTruthy();
        // The password fields are there at once: no intro card, no grey Export… button.
        expect(screen.queryByRole('button', { name: 'Export…' })).toBeNull();
        expect(screen.queryByText('Export encrypted backup')).toBeNull();
        expect(screen.getByLabelText('Backup password')).toBeTruthy();
        const logSpies = ['log', 'info', 'warn', 'error', 'debug'].map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
        fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'short' } });
        expect(screen.getByText(/at least 8 characters/i)).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Confirm backup password'), { target: { value: 'different' } });
        expect(screen.getByText(/passwords don't match/i)).toBeTruthy();
        // G130: Export Backup stays enabled; the mismatch is refused on the press.
        expect(screen.getAllByRole('button', { name: /^export backup$/i }).find((b) => b.type === 'submit')).toBeEnabled();
        fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'backup-secret' } });
        fireEvent.change(screen.getByLabelText('Confirm backup password'), { target: { value: 'backup-secret' } });
        // The prompt's submit button (its label's case follows the locale copy).
        const submit = screen.getAllByRole('button', { name: /^export backup$/i }).find((b) => b.type === 'submit');
        await act(async () => {
            fireEvent.click(submit);
            for (let i = 0; i < 8; i += 1) await Promise.resolve();
        });

        expect(exportBackupFile).toHaveBeenCalledTimes(1);
        expect(exportBackupFile.mock.calls[0][0].walletId).toBe(CHOSEN.id);
        for (const spy of logSpies) {
            expect(JSON.stringify(spy.mock.calls)).not.toContain('backup-secret');
            spy.mockRestore();
        }
    });

    it('hands the export to a tab when the host supplies one', () => {
        const onExportInTab = vi.fn();
        const exportBackupFile = vi.fn();
        render(
            <MessagingProvider shell="extension" messaging={{ exportBackupFile }}>
                <ExportWalletBackup walletId={CHOSEN.id} walletName={CHOSEN.name} onBack={() => {}} onExportInTab={onExportInTab} />
            </MessagingProvider>,
        );

        fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'backup-secret' } });
        fireEvent.change(screen.getByLabelText('Confirm backup password'), { target: { value: 'backup-secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Export Backup' }));
        expect(onExportInTab).toHaveBeenCalledTimes(1);
        expect(exportBackupFile).not.toHaveBeenCalled();
    });
});

// Each shell keys the Export Backup page off the wallet Wallet Details shows,
// and the Remove wallet page off that same wallet.
describe.each([
    ['web', 'packages/web/src/App.jsx'],
    ['desktop', 'packages/desktop/renderer/App.jsx'],
    ['extension', 'packages/extension/src/popup/App.jsx'],
])('%s shell routes', (_shell, file) => {
    const src = readFileSync(file, 'utf8');

    it('opens Export Backup as its own page for the Wallet Details wallet', () => {
        expect(src).toMatch(/onExportBackup=\{\(\) => setUnlockedView\('wallet-backup'\)\}/);
        expect(src).toMatch(/unlockedView === 'wallet-backup' && walletDetailsId\)[\s\S]{0,400}<ExportWalletBackup\s+walletId=\{walletDetailsId\}/);
    });

    // Remove wallet opens a Remove Wallet page keyed by the Wallet Details
    // wallet, so opening it never switches the active wallet.
    it('opens Remove Wallet as its own page for the Wallet Details wallet, without switching wallets', () => {
        expect(src).toMatch(/onRemoveWallet=\{\(\) => setUnlockedView\('wallet-remove'\)\}/);
        expect(src).toMatch(/unlockedView === 'wallet-remove' && walletDetailsId\)[\s\S]{0,400}<RemoveWallet\s+walletId=\{walletDetailsId\}/);
    });
});
