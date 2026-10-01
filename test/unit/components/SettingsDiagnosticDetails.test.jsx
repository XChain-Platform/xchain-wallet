// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ContactsSection } from '../../../packages/core/src/shared/components/settings/ContactsSection.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { RegtestRow } from '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx';

function mount(component, messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            {component}
        </MessagingProvider>,
    );
}

const settings = { walletMode: 'full', language: 'en', display: {} };

afterEach(() => cleanup());

describe('settings diagnostic disclosures', () => {
    it('lists every address mismatch reported by a backup dry run', async () => {
        const messaging = {
            dryRunRestoreRequest: vi.fn().mockResolvedValue({
                overallMatch: false,
                perChain: [{
                    chainId: 'bitcoin-mainnet',
                    addressType: 'p2wpkh',
                    matchedCount: 1,
                    divergentCount: 1,
                    missingCount: 1,
                    derived: [
                        { index: 1, path: "m/84'/0'/0'/0/1", address: 'bc1qderivedmismatch' },
                        { index: 2, path: "m/84'/0'/0'/0/2", address: 'bc1qderivednew' },
                    ],
                    comparisons: [
                        { index: 1, expected: 'bc1qexpected', derived: 'bc1qderivedmismatch', match: false },
                        { index: 2, expected: null, derived: 'bc1qderivednew', match: false },
                    ],
                }],
            }),
        };
        mount(<BackupSection activeWallet={{ id: 'wallet-1', name: 'Wallet' }} />, messaging);

        fireEvent.click(screen.getByRole('button', { name: 'Test…' }));
        fireEvent.change(screen.getByLabelText('Recovery phrase to test'), {
            target: { value: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Run test' }));

        const mismatch = await screen.findByText(/Address #2: your wallet has bc1qexpected, but this recovery phrase gives bc1qderivedmismatch/);
        const missing = screen.getByText(/Address #3: not in your wallet yet; this recovery phrase gives bc1qderivednew/);
        expect(mismatch.tagName).toBe('LI');
        expect(missing.tagName).toBe('LI');

        // Paths stay reachable, but only inside the technical-details disclosure.
        const details = screen.getByText('Technical details').closest('details');
        expect(details).toBeTruthy();
        expect(details.textContent).toContain("m/84'/0'/0'/0/1");
        expect(details.textContent).toContain("m/84'/0'/0'/0/2");
        expect(mismatch.textContent).not.toMatch(/m\/84|\bderived\b/);
        expect(missing.textContent).not.toMatch(/m\/84|\bderived\b/);

        // The heading names the chain and address type in words, not by code.
        expect(screen.queryByText(/bitcoin-mainnet/)).toBeNull();
        expect(screen.getByText('Bitcoin')).toBeTruthy();
        expect(screen.getByText('SegWit')).toBeTruthy();
    });

    it('lists every contact that an import skips with its rejection message', async () => {
        const saveContact = vi.fn(async ({ record }) => {
            if (record.name === 'Broken contact') throw new Error('entries must contain an address');
        });
        const messaging = {
            getSettings: vi.fn().mockResolvedValue(settings),
            listContacts: vi.fn().mockResolvedValue([]),
            saveContact,
        };
        mount(<ContactsSection />, messaging);

        const file = {
            text: async () => JSON.stringify([
                { id: 'ok', name: 'Good contact' },
                { id: 'bad', name: 'Broken contact' },
            ]),
        };
        fireEvent.change(await screen.findByLabelText('Import contacts JSON'), {
            target: { files: [file] },
        });

        expect(await screen.findByText('Imported 1 contact; 1 skipped.')).toBeTruthy();
        const summary = screen.getByText('Skipped contacts (1)');
        fireEvent.click(summary);
        expect(screen.getByText('Broken contact')).toBeTruthy();
        expect(screen.getByText(/entries must contain an address/)).toBeTruthy();
    });

    it('lists each account left unchanged during network activation', async () => {
        const messaging = {
            getSettings: vi.fn().mockResolvedValue(settings),
            listWallets: vi.fn().mockResolvedValue([{ id: 'wallet-1' }]),
            listSigners: vi.fn().mockResolvedValue([]),
            activateChainRequest: vi.fn().mockResolvedValue({
                addresses: [{ accountId: 'account-2', address: {} }],
                skippedAccounts: 1,
                skippedAccountDetails: [{ accountId: 'account-1', name: 'Savings' }],
            }),
        };
        const descriptor = { id: 'bitcoin-regtest', displayName: 'Bitcoin Regtest' };
        mount(<RegtestRow descriptor={descriptor} isActive={false} disabled={false} />, messaging);

        fireEvent.click(await screen.findByRole('button', { name: 'Activate…' }));
        const password = await screen.findByLabelText('Bitcoin Regtest activation password');
        fireEvent.change(password, { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Activate' }));

        expect(await screen.findByText('Activated. Derived 1 address.')).toBeTruthy();
        const summary = screen.getByText('Accounts not changed (1)');
        fireEvent.click(summary);
        expect(screen.getByText('Savings')).toBeTruthy();
        expect(screen.getByText(/Already has an address on Bitcoin Regtest/)).toBeTruthy();
        await waitFor(() => expect(messaging.activateChainRequest).toHaveBeenCalledOnce());
    });
});
