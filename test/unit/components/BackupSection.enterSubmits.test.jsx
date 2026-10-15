// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Backup prompts (reveal recovery phrase, export encrypted backup, test
// backup) were sections with click-only buttons and no form, so pressing
// Enter in the password field did nothing. A browser submits a form on Enter
// only when the field sits in a <form> with a submit button, which is what
// these tests pin; jsdom has no implicit submission, so the submit itself is
// fired on the field's own form.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,cXI=') },
}));

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function mount(messaging) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <BackupSection activeWallet={{ id: 'wallet-1', name: 'Enter Wallet' }} />
        </MessagingProvider>,
    );
}

function expectEnterSubmits(field, submitName) {
    expect(field.form, 'the field is not inside a form, so Enter cannot submit').not.toBeNull();
    const submit = screen.getByRole('button', { name: submitName });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.form).toBe(field.form);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
}

describe('Backup prompts submit on Enter', () => {
    it('reveals the recovery phrase from the password field', () => {
        const revealMnemonicRequest = vi.fn(() => new Promise(() => {}));
        mount({ revealMnemonicRequest });
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        const field = screen.getByLabelText('Wallet password');
        expectEnterSubmits(field, 'Reveal');

        fireEvent.submit(field.form);
        expect(revealMnemonicRequest).not.toHaveBeenCalled();

        fireEvent.change(field, { target: { value: 'wallet-secret' } });
        fireEvent.submit(field.form);
        expect(revealMnemonicRequest).toHaveBeenCalledTimes(1);
    });

    it('exports the backup from the confirmation field only once both passwords agree', () => {
        const exportBackupFile = vi.fn(() => new Promise(() => {}));
        mount({ exportBackupFile });
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        const first = screen.getByLabelText('Backup password');
        const confirm = screen.getByLabelText('Confirm backup password');
        expectEnterSubmits(confirm, 'Export');

        fireEvent.change(first, { target: { value: 'backup-secret' } });
        fireEvent.change(confirm, { target: { value: 'backup-secreT' } });
        fireEvent.submit(confirm.form);
        expect(exportBackupFile).not.toHaveBeenCalled();

        fireEvent.change(confirm, { target: { value: 'backup-secret' } });
        fireEvent.submit(confirm.form);
        expect(exportBackupFile).toHaveBeenCalledTimes(1);
    });

    it('does not submit the export early from the first password field', () => {
        mount({ exportBackupFile: vi.fn() });
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        const first = screen.getByLabelText('Backup password');
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        // getClientRects is empty in jsdom; give both fields a box so the
        // last-field rule sees them as visible.
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}]);
        first.dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(true);
    });

    it('runs the backup test from the form', () => {
        const dryRunRestoreRequest = vi.fn(() => new Promise(() => {}));
        mount({ dryRunRestoreRequest });
        fireEvent.click(screen.getByRole('button', { name: 'Test…' }));
        const phrase = screen.getByLabelText('Recovery phrase to test');
        expectEnterSubmits(screen.getByLabelText('BIP39 passphrase'), 'Run test');

        fireEvent.change(phrase, { target: { value: 'abandon ability able' } });
        fireEvent.submit(phrase.form);
        expect(dryRunRestoreRequest).toHaveBeenCalledTimes(1);
    });
});
