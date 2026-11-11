// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Keep the Recovery phrase Scan QR control inside the field as a plain icon,
// while the field primitive reserves text space for the action.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';

afterEach(() => {
    cleanup();
    localStorage.clear();
});

function renderImport(variant) {
    render(
        <MessagingProvider shell="web" messaging={{ importMnemonic: vi.fn().mockResolvedValue({}) }}>
            <ImportWallet onBack={() => {}} onImported={() => {}} mode="fresh" variant={variant} />
        </MessagingProvider>,
    );
}

describe('Recovery phrase Scan QR field action', () => {
    it.each([['phrase', undefined], ['FreeWallet', 'freewallet']])(
        'draws Scan QR as a QR icon button inside the %s box',
        (_name, variant) => {
            renderImport(variant);
            const textarea = screen.getByLabelText('Recovery phrase');
            const label = document.querySelector(`label[for="${textarea.id}"]`);
            const scan = screen.getByRole('button', { name: 'Scan QR', exact: true });

            // Icon only: the QR glyph and no visible text.
            const glyph = scan.querySelector('svg');
            expect(glyph).not.toBeNull();
            expect(glyph.getAttribute('class') || '').toMatch(/qr-code/);
            expect(scan.textContent.trim()).toBe('');
            expect(scan).toHaveAttribute('aria-label', 'Scan QR');
            expect(scan).toHaveAttribute('aria-pressed', 'false');

            // The field wrapper holds the button after the textarea, not beside the label.
            const field = textarea.closest(`.${inputStyles.field}`);
            const control = textarea.closest(`.${inputStyles.textareaControl}`);
            expect(control).toContainElement(scan);
            expect(label.parentElement).not.toBe(scan.parentElement);
            expect(field.querySelector(`.${inputStyles.textareaActions}`)).toBeNull();
            expect(control).not.toBeNull();
            expect(textarea.classList.contains(inputStyles.textareaWithActions)).toBe(false);
            expect(textarea.classList.contains(inputStyles.inputWithFieldAction)).toBe(true);
            expect(textarea.style.resize).toBe('vertical');

            fireEvent.click(scan);
            const cancel = screen.getByRole('button', { name: 'Cancel scan', exact: true });
            expect(cancel).toBe(scan);
            expect(cancel).toHaveAttribute('aria-pressed', 'true');
            expect(control).toContainElement(cancel);

            fireEvent.click(cancel);
            expect(screen.getByRole('button', { name: 'Scan QR', exact: true })).toHaveAttribute('aria-pressed', 'false');
        },
    );
});
