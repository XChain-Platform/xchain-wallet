// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Import Wallet's Backup tab under axe in each state the operator picked
// (restore-v2, 2026-11-14): the empty drop area with its Choose File button
// inside it, the chosen file's summary card, a wrong password, and the second
// Wallet password field. The area takes a click but is no control of its own,
// so the button inside it is not a nested interactive element.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { BackupPasswordError } from '../../../packages/core/src/crypto/backup.js';
import { BackupSeedPasswordError } from '../../../packages/core/src/flows/backupFile.js';
import { chooseBackupFile, openBackupTab, typeInto } from '../../helpers/backupFileChoice.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

afterEach(cleanup);

function renderTab(importBackupFresh = vi.fn()) {
    const view = render(
        <MessagingProvider shell="web" messaging={{ importBackupFresh }}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" />
        </MessagingProvider>,
    );
    openBackupTab();
    return view;
}

describe('Import Wallet backup tab accessibility', () => {
    it('has no serious violations with the empty drop area', async () => {
        const { container } = renderTab();
        expect(screen.getByRole('button', { name: 'Choose File' })).toBeInTheDocument();
        await expectNoSeriousAxeViolations(container);
    });

    it('has no serious violations with a chosen file', async () => {
        const { container } = renderTab();
        await chooseBackupFile();
        await expectNoSeriousAxeViolations(container);
    });

    it('has no serious violations with a wrong password', async () => {
        const { container } = renderTab(vi.fn().mockRejectedValue(new BackupPasswordError()));
        await chooseBackupFile();
        typeInto('Backup password', 'wrong-password');
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await screen.findByRole('alert', { name: 'Form errors' });
        await expectNoSeriousAxeViolations(container);
    });

    it('has no serious violations with the Wallet password field shown', async () => {
        const { container } = renderTab(vi.fn().mockRejectedValue(new BackupSeedPasswordError('seed')));
        await chooseBackupFile();
        typeInto('Backup password', 'file-password');
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        await screen.findByLabelText('Wallet password');
        await expectNoSeriousAxeViolations(container);
    });
});
