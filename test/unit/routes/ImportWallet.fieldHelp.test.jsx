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

        expectHelpFor(['Recovery phrase', 'Wallet name', 'Password', 'Confirm password']);
    });

    it('gives every FreeWallet field a help tip', () => {
        renderImport({ variant: 'freewallet' });

        expectHelpFor(['Recovery phrase', 'Wallet name', 'Password', 'Confirm password']);
        const tip = screen.getByRole('button', { name: 'About Recovery phrase' });
        expect(document.getElementById(tip.getAttribute('aria-describedby')))
            .toHaveTextContent('Enter your 12-word FreeWallet recovery phrase.');
        expect(screen.getByText('0 / 12 words')).toBeInTheDocument();
    });

    it('keeps the password help tip in the narrow layout', () => {
        renderImport({ shell: 'popup' });

        expect(screen.getByRole('button', { name: 'About Password' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About Confirm' })).toBeInTheDocument();
        expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
    });

    it('gives every private key field a help tip', () => {
        renderImport();
        fireEvent.click(screen.getByRole('tab', { name: 'Private key' }));

        expectHelpFor([
            'Coin network',
            'Private key type',
            'WIF private key',
            'Address',
            'Wallet name',
            'Password',
            'Confirm password',
        ]);
    });

    it('gives every encrypted backup field a help tip and keeps both descriptions under their fields', () => {
        renderImport();
        fireEvent.click(screen.getByRole('tab', { name: 'Encrypted backup' }));

        expectHelpFor([
            'Backup file',
            'Backup file contents',
            'Backup password',
            'Password of the wallet in this backup',
            'Password for this device',
        ]);
        expect(screen.getByRole('button', { name: 'Choose backup file' }).nextElementSibling)
            .toHaveTextContent('Choose or drop a backup file');
        expect(document.getElementById('xc-backup-content-description'))
            .toHaveTextContent('Paste backup file contents here');
    });
});
