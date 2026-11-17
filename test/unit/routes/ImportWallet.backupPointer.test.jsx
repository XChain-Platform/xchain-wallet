// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Backup tab restores from a backup FILE only. The backup-pointer QR scan
// that used to sit in the tab's paste box went with the paste box when the tab
// was rebuilt (restore-v2, 2026-11-14): a pointer names where a backup file
// lives, so the way in is to save that file and choose it. The host's pointer
// restore stays, but this screen never sends one.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { chooseBackupFile, openBackupTab, typeInto } from '../../helpers/backupFileChoice.js';

afterEach(cleanup);

function renderImport(messaging, { mode = 'add', onImported = () => {} } = {}) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ImportWallet onBack={() => {}} onImported={onImported} mode={mode} />
        </MessagingProvider>,
    );
}

describe('ImportWallet backup tab takes a file, never a pointer', () => {
    it('offers no pointer scan and no paste box', () => {
        renderImport({ importBackupRequest: vi.fn() });
        openBackupTab();
        expect(screen.queryByRole('button', { name: /scan/i })).toBeNull();
        expect(screen.queryByRole('textbox', { name: /contents/i })).toBeNull();
        expect(document.getElementById('xc-backup-scanner')).toBeNull();
    });

    it('an add restores the chosen file through the host, never the pointer path, and ends on the notice', async () => {
        const importBackupRequest = vi.fn().mockResolvedValue({ walletId: 'w1' });
        const importBackupPointerRequest = vi.fn();
        const onImported = vi.fn();
        renderImport({ importBackupRequest, importBackupPointerRequest }, { onImported });
        openBackupTab();
        await chooseBackupFile();
        typeInto('Backup password', 'pw12345678');
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await waitFor(() => expect(importBackupRequest).toHaveBeenCalledTimes(1));
        expect(importBackupPointerRequest).not.toHaveBeenCalled();
        // §36.1: the restore ends on the ADS notice; only its Continue
        // hands control back to App.
        expect(onImported).not.toHaveBeenCalled();
        fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
        await waitFor(() => expect(onImported).toHaveBeenCalled());
    });

    it('a FRESH install goes to the pre-host lane, not the host one', async () => {
        // On a device with no wallet there is no host, so the host-registered
        // restore has nothing to answer it. The lane has to split here or the
        // restore silently never happens.
        const importBackupFresh = vi.fn().mockResolvedValue({ walletId: 'w1' });
        const importBackupRequest = vi.fn();
        renderImport({ importBackupFresh, importBackupRequest }, { mode: 'fresh' });
        openBackupTab();
        await chooseBackupFile();
        typeInto('Backup password', 'pw12345678');
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

        await waitFor(() => expect(importBackupFresh).toHaveBeenCalledTimes(1));
        expect(importBackupRequest,
            'the fresh lane went through the HOST-registered restore, which a fresh install has no '
            + 'host to answer').not.toHaveBeenCalled();
        expect(importBackupFresh.mock.calls[0][0]).not.toHaveProperty('pointer');
    });

    it('reports plainly when the shell has no restore at all', async () => {
        renderImport({});
        openBackupTab();
        await chooseBackupFile();
        typeInto('Backup password', 'pw12345678');
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        expect(await screen.findByText("Restoring a backup isn't available in this app.")).toBeTruthy();
    });
});
