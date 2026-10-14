// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The reveal password, the export confirmation and the test-backup
// passphrase were named only by a placeholder, which disappears as soon as
// the user types, so two filled export fields could not be told apart. Each
// now has a visible label above it, like every other field on these screens.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../../packages/core/src/shared/components/settings/BackupSection.jsx';

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,cXI=') },
}));

afterEach(cleanup);

function mount() {
    render(
        <MessagingProvider shell="web" messaging={{}}>
            <BackupSection activeWallet={{ id: 'wallet-1', name: 'Label Wallet' }} />
        </MessagingProvider>,
    );
}

function visibleLabelOf(field) {
    const label = document.querySelector(`label[for="${field.id}"]`);
    expect(label, `${field.getAttribute('aria-label')} has no visible label`).not.toBeNull();
    expect(field).not.toHaveAttribute('placeholder');
    return label.textContent;
}

describe('Backup prompt password labels', () => {
    it('labels the recovery phrase password', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        expect(visibleLabelOf(screen.getByLabelText('Wallet password'))).toBe('Wallet password');
    });

    it('labels the export confirmation', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
        expect(visibleLabelOf(screen.getByLabelText('Confirm backup password')))
            .toBe('Confirm backup password');
    });

    it('labels the test-backup passphrase as optional', () => {
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Test…' }));
        const field = screen.getByLabelText('BIP39 passphrase');
        expect(visibleLabelOf(field)).toBe('BIP39 passphrase (optional)');
        expect(field).toHaveAttribute('aria-required', 'false');
    });
});
