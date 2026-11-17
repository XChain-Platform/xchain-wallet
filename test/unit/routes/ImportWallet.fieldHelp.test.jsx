// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

afterEach(cleanup);

function renderImport({ shell = 'web', variant = 'default' } = {}) {
    render(
        <MessagingProvider shell={shell} messaging={{}}>
            <ImportWallet
                mode="fresh"
                variant={variant}
                onBack={() => {}}
                onImported={() => {}}
            />
        </MessagingProvider>,
    );
}

function expectHelpFor(labels) {
    for (const label of labels) {
        expect(screen.getByRole('button', { name: `About ${label}` })).toBeInTheDocument();
    }
}

describe('ImportWallet field help', () => {
    it('gives every recovery phrase field a help tip', () => {
        renderImport();

        expectHelpFor(['Wallet type', 'Recovery phrase', 'Wallet name', 'Password', 'Confirm password']);
    });

    it('gives every FreeWallet field a help tip', () => {
        renderImport({ variant: 'freewallet' });

        expectHelpFor(['Wallet type', 'Recovery phrase', 'Wallet name', 'Password', 'Confirm password']);
        const tip = screen.getByRole('button', { name: 'About Recovery phrase' });
        expect(document.getElementById(tip.getAttribute('aria-describedby')))
            .toHaveTextContent('Enter a 12-word legacy recovery phrase.');
        expect(screen.getByText('0 / 12 words')).toBeInTheDocument();
    });

    it('keeps the password help tip in the narrow layout', () => {
        renderImport({ shell: 'popup' });

        expect(screen.getByRole('button', { name: 'About Password' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Confirm' })).toBeInTheDocument();
        // U57: the length rule is static help, so it sits in the tip, not under the field.
        expect(screen.queryByText('At least 8 characters.')).toBeNull();
        const tip = screen.getByRole('button', { name: 'About Password' });
        expect(document.getElementById(tip.getAttribute('aria-describedby')))
            .toHaveTextContent('At least 8 characters.');
    });

    it('keeps help on editable private key fields and removes it from the derived address', () => {
        renderImport();
        fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));

        expect(screen.getByRole('heading', { name: 'Import Private Key' })).toBeInTheDocument();

        expectHelpFor([
            'Coin',
            'Coin network',
            'Address type',
            'WIF private key',
            'Wallet name',
            'Password',
            'Confirm password',
        ]);
        expect(screen.queryByRole('button', { name: 'About Address' })).not.toBeInTheDocument();
    });

    it('gives the backup password a help tip that says the wallet keeps its own password', () => {
        renderImport();
        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));

        // The drop area is a picker, not a labelled field: its title says
        // what to do, so it carries no tip of its own.
        expectHelpFor(['Backup password']);
        const tip = screen.getByRole('button', { name: 'About Backup password' });
        expect(document.getElementById(tip.getAttribute('aria-describedby')))
            .toHaveTextContent(/keeps its own password here; you can change it later in Security/);
    });
});
