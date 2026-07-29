// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §15.4 QR-from-backup-pointer restore wiring in ImportWallet. Drives
// the encrypted-backup lane: scanning a backup-pointer QR should switch
// the lane to the pointer path and dispatch `importBackupPointerRequest`
// with the parsed pointer + backup password (never the file path).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { buildBackupPointer } from '../../../packages/core/src/uri/backupPointer.js';

// The route renders `<QrScanner onFrame={...} />`; stub it with a button
// that fires a canned frame so the test can inject a scan result without
// a camera.
vi.mock('@xchain-wallet/core/ui', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        QrScanner: ({ onFrame }) => (
            <button type="button" data-testid="fake-scan" onClick={() => onFrame(globalThis.__XC_SCAN_FRAME__)}>
                scan
            </button>
        ),
    };
});

// The stub above only reaches ImportWallet if the route resolves
// `@xchain-wallet/core/ui` to the same file this mock is keyed on. When it
// does not, vi.mock is a silent no-op: the real camera-backed QrScanner
// renders and the button is simply absent. Say that out loud instead of
// leaving a bare "cannot find fake-scan" to read like a product bug .
function clickFakeScan() {
    const stub = screen.queryByTestId('fake-scan');
    expect(
        stub,
        'the @xchain-wallet/core/ui mock never reached ImportWallet - the route resolved '
        + 'the specifier to a different copy of core than this file mocked '
        + '(check test/vitest/workspaceAlias.js and node_modules/@xchain-wallet)',
    ).toBeTruthy();
    fireEvent.click(stub);
}

function renderImport(messaging) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ImportWallet onBack={() => {}} onImported={() => {}} />
        </MessagingProvider>,
    );
}

describe('ImportWallet backup-pointer restore', () => {
    it('scans a pointer and restores via importBackupPointerRequest', async () => {
        const importBackupPointerRequest = vi.fn().mockResolvedValue({ walletId: 'w1' });
        const onImported = vi.fn();
        const pointerUri = buildBackupPointer({ location: 'https://backups.example/a.json', name: 'Rig' });
        globalThis.__XC_SCAN_FRAME__ = pointerUri;

        render(
            <MessagingProvider shell="web" messaging={{ importBackupPointerRequest }}>
                <ImportWallet onBack={() => {}} onImported={onImported} />
            </MessagingProvider>,
        );

        // Switch to the Encrypted-backup lane.
        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));
        // Open the pointer scanner, then fire a scan frame.
        fireEvent.click(screen.getByRole('button', { name: 'Scan pointer QR' }));
        clickFakeScan();

        // Pointer card appears.
        await waitFor(() => expect(screen.getByText(/Backup pointer loaded/)).toBeTruthy());
        expect(screen.getByText(/backups\.example\/a\.json/)).toBeTruthy();

        // Enter the backup password and submit.
        fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'pw12345678' } });
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await waitFor(() => expect(importBackupPointerRequest).toHaveBeenCalledTimes(1));
        const arg = importBackupPointerRequest.mock.calls[0][0];
        expect(arg.pointer.location).toBe('https://backups.example/a.json');
        expect(arg.password).toBe('pw12345678');
        expect(arg.onConflict).toBe('error');
        await waitFor(() => expect(onImported).toHaveBeenCalled());
    });

    it('rejects a non-pointer QR in the backup lane', async () => {
        globalThis.__XC_SCAN_FRAME__ = 'bitcoin:bc1qexampleaddressxxxxxxxxxxxxxxxxx';
        renderImport({ importBackupPointerRequest: vi.fn() });

        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));
        fireEvent.click(screen.getByRole('button', { name: 'Scan pointer QR' }));
        clickFakeScan();

        await waitFor(() => expect(screen.getByText(/not a backup pointer/i)).toBeTruthy());
    });

    it('reports gracefully when the shell lacks the pointer method', async () => {
        globalThis.__XC_SCAN_FRAME__ = buildBackupPointer({ location: 'https://backups.example/b.json' });
        // messaging without importBackupPointerRequest.
        renderImport({});

        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));
        fireEvent.click(screen.getByRole('button', { name: 'Scan pointer QR' }));
        clickFakeScan();
        await waitFor(() => expect(screen.getByText(/Backup pointer loaded/)).toBeTruthy());

        fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'pw12345678' } });
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await waitFor(() => expect(screen.getByText(/not available in this shell/i)).toBeTruthy());
    });
});
