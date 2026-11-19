// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The Backup tab's lines of text: the drop area's title and hint, the summary
// card's lines, and the reason under a second password field, each set the
// way the rest of the form sets its help and error lines.

import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { BackupSeedPasswordError } from '../../../packages/core/src/flows/backupFile.js';
import { chooseBackupFile, openBackupTab, typeInto } from '../../helpers/backupFileChoice.js';

afterEach(cleanup);

function renderTab(messaging = {}) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />
        </MessagingProvider>,
    );
    openBackupTab();
}

describe('ImportWallet backup tab text', () => {
    it('describes the Choose File button by the area title it sits under', () => {
        renderTab();
        const choose = screen.getByRole('button', { name: 'Choose File' });
        expect(choose).toHaveAccessibleDescription('Choose your backup file');
    });

    it('sets the wallet field\'s reason as the field\'s own hint line', async () => {
        renderTab({ importBackupFresh: vi.fn().mockRejectedValue(new BackupSeedPasswordError('seed')) });
        await chooseBackupFile();
        typeInto('Backup password', 'file-password');
        fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
        const field = await screen.findByLabelText('Wallet password');
        const hintId = field.getAttribute('aria-describedby').split(' ').find((id) => id.endsWith('-hint'));
        expect(document.getElementById(hintId))
            .toHaveTextContent('The file opened, but the wallet inside uses a different password.');
    });

    it('sets the area refusal the help gap under it, in the error colour, and the card uses the shared notice', () => {
        const fieldCss = readFileSync('packages/core/src/shared/components/FileField.module.css', 'utf8');
        const routeCss = readFileSync('packages/core/src/shared/routes/ImportWallet.module.css', 'utf8');
        expect(fieldCss).toMatch(/\.areaError\s*\{[^}]*margin:\s*var\(--xc-help-gap\) 0 0;[^}]*color:\s*var\(--xc-danger-fg\)/s);
        // A refusal while a file stays chosen is the shared StatusMessage, not a route rule.
        expect(routeCss).not.toMatch(/\.backupCardError/);
        // The card's text wraps rather than pushing a long file name off the card.
        expect(routeCss).toMatch(/\.backupCardName\s*\{[^}]*overflow-wrap:\s*anywhere/s);
        expect(routeCss).toMatch(/\.backupCardFile\s*\{[^}]*overflow-wrap:\s*anywhere/s);
    });
});
