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
// leaving a bare "cannot find fake-scan" to read like a product bug.
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

// The lane now collects three distinct secrets, and the Restore
// button stays disabled until all three are present. Every case that submits
// has to fill all three, so it lives in one helper - and the labels are
// asserted by using them, since `getByLabelText` throws when one is renamed.
function fillBackupPasswords({
    file = 'pw12345678',
    wallet = 'the-old-devices-password',
    device = 'this-devices-password',
    mode = 'add',
} = {}) {
    fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: file } });
    fireEvent.change(screen.getByLabelText('Password of the wallet in this backup'), { target: { value: wallet } });
    // The device field's label differs by mode on purpose: on a fresh install
    // the user is CHOOSING this password, on an open vault they are confirming
    // one they already have.
    fireEvent.change(
        screen.getByLabelText(mode === 'add' ? 'Your password on this device' : 'Password for this device'),
        { target: { value: device } },
    );
}

function renderImport(messaging, mode = 'add') {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode={mode} />
        </MessagingProvider>,
    );
}

/** Scan a pointer QR in the backup lane and wait for the pointer card. */
async function scanPointerInBackupLane() {
    fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scan pointer QR' }));
    clickFakeScan();
    await waitFor(() => expect(screen.getByText(/Backup pointer loaded/)).toBeTruthy());
}

describe('ImportWallet backup-pointer restore', () => {
    it('scans a pointer and restores via importBackupPointerRequest', async () => {
        const importBackupPointerRequest = vi.fn().mockResolvedValue({ walletId: 'w1' });
        const onImported = vi.fn();
        const pointerUri = buildBackupPointer({ location: 'https://backups.example/a.json', name: 'Rig' });
        globalThis.__XC_SCAN_FRAME__ = pointerUri;

        render(
            <MessagingProvider shell="web" messaging={{ importBackupPointerRequest }}>
                <ImportWallet onBack={() => {}} onImported={onImported} mode="add" />
            </MessagingProvider>,
        );

        await scanPointerInBackupLane();
        expect(screen.getByText(/backups\.example\/a\.json/)).toBeTruthy();

        // Enter all three passwords and submit.
        fillBackupPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await waitFor(() => expect(importBackupPointerRequest).toHaveBeenCalledTimes(1));
        const arg = importBackupPointerRequest.mock.calls[0][0];
        expect(arg.pointer.location).toBe('https://backups.example/a.json');
        expect(arg.password).toBe('pw12345678');
        expect(arg.onConflict).toBe('error');
        // The two re-key passwords reach the host, and each carries
        // the value from its OWN field. Crossing them here is invisible in the
        // UI and produces a wallet that restores and then cannot sign.
        expect(arg.walletPassword).toBe('the-old-devices-password');
        expect(arg.devicePassword).toBe('this-devices-password');
        await waitFor(() => expect(onImported).toHaveBeenCalled());
    });

    it('will not submit until all three passwords are present', async () => {
        const importBackupPointerRequest = vi.fn().mockResolvedValue({ walletId: 'w1' });
        globalThis.__XC_SCAN_FRAME__ = buildBackupPointer({ location: 'https://backups.example/c.json' });

        renderImport({ importBackupPointerRequest });
        await scanPointerInBackupLane();

        // Only the file password: the old lane would have restored right here,
        // sealed under a password this device does not use.
        fireEvent.change(screen.getByLabelText('Backup password'), { target: { value: 'pw12345678' } });
        const restore = screen.getByRole('button', { name: 'Restore' });
        expect(restore.disabled,
            'Restore is enabled with only the backup-file password, so a restore can still be '
            + 'submitted with nothing to re-key the wallet onto').toBe(true);

        fillBackupPasswords();
        expect(screen.getByRole('button', { name: 'Restore' }).disabled).toBe(false);
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await waitFor(() => expect(importBackupPointerRequest).toHaveBeenCalledTimes(1));
    });

    it('a FRESH install goes to the pre-host lane, not the host one', async () => {
        // The whole point: on a device with no wallet there is no
        // host, so `importBackupPointerRequest` has nothing to answer it. The
        // lane has to split here or the restore silently never happens.
        const importBackupFresh = vi.fn().mockResolvedValue({ walletId: 'w1' });
        const importBackupPointerRequest = vi.fn();
        const onImported = vi.fn();
        globalThis.__XC_SCAN_FRAME__ = buildBackupPointer({ location: 'https://backups.example/d.json' });

        render(
            <MessagingProvider shell="web" messaging={{ importBackupFresh, importBackupPointerRequest }}>
                <ImportWallet onBack={() => {}} onImported={onImported} mode="fresh" />
            </MessagingProvider>,
        );

        await scanPointerInBackupLane();
        fillBackupPasswords({ mode: 'fresh' });
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await waitFor(() => expect(importBackupFresh).toHaveBeenCalledTimes(1));
        expect(importBackupPointerRequest,
            'the fresh lane went through the HOST-registered restore, which a fresh install has no '
            + 'host to answer').not.toHaveBeenCalled();

        const arg = importBackupFresh.mock.calls[0][0];
        // `password` here is the DEVICE password being set, not the file's.
        expect(arg.password).toBe('this-devices-password');
        expect(arg.backupPassword).toBe('pw12345678');
        expect(arg.walletPassword).toBe('the-old-devices-password');
        expect(arg.pointer.location).toBe('https://backups.example/d.json');
        await waitFor(() => expect(onImported).toHaveBeenCalled());
    });

    it('a FRESH install with a pasted FILE takes the same pre-host lane', async () => {
        const importBackupFresh = vi.fn().mockResolvedValue({ walletId: 'w1' });
        const importBackupRequest = vi.fn();

        render(
            <MessagingProvider shell="web" messaging={{ importBackupFresh, importBackupRequest }}>
                <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />
            </MessagingProvider>,
        );

        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));
        fireEvent.change(screen.getByPlaceholderText(/argon2id/), { target: { value: '{"v":1}' } });
        fillBackupPasswords({ mode: 'fresh' });
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await waitFor(() => expect(importBackupFresh).toHaveBeenCalledTimes(1));
        expect(importBackupRequest).not.toHaveBeenCalled();
        expect(importBackupFresh.mock.calls[0][0].fileContent).toBe('{"v":1}');
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

        fillBackupPasswords();
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await waitFor(() => expect(screen.getByText(/not available in this shell/i)).toBeTruthy());
    });
});
