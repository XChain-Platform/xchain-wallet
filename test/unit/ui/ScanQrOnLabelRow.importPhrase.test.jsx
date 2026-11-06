// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The Recovery phrase Scan QR control is a QR icon button on the field's
// label row, never a text button drawn inside the phrase box. A button inside
// the box needs a reserved strip under the text and offsets the box's
// content; on the label row the box stays a plain textarea.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import inputStyles from '../../../packages/core/src/ui/Input.module.css';
import importStyles from '../../../packages/core/src/shared/routes/ImportWallet.module.css';

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

describe('Recovery phrase Scan QR on the label row', () => {
    it.each([['phrase', undefined], ['FreeWallet', 'freewallet']])(
        'draws Scan QR as a QR icon button beside the %s label, outside the box',
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

            // The label row holds both the label and the button.
            const row = label.parentElement;
            expect(row.classList.contains(importStyles.mnemonicHeader)).toBe(true);
            expect(scan.parentElement).toBe(row);
            expect(scan.closest(`.${inputStyles.textareaControl}`)).toBeNull();

            // The box reserves no action strip: no actions wrapper and no padded class.
            const field = textarea.closest(`.${inputStyles.field}`);
            expect(field.querySelector(`.${inputStyles.textareaActions}`)).toBeNull();
            expect(field.querySelector(`.${inputStyles.textareaControl}`)).toBeNull();
            expect(field.querySelector('button')).toBeNull();
            expect(textarea.classList.contains(inputStyles.textareaWithActions)).toBe(false);
            expect(textarea.style.resize).toBe('vertical');

            fireEvent.click(scan);
            const cancel = screen.getByRole('button', { name: 'Cancel scan', exact: true });
            expect(cancel).toBe(scan);
            expect(cancel).toHaveAttribute('aria-pressed', 'true');
            expect(cancel.parentElement).toBe(row);

            fireEvent.click(cancel);
            expect(screen.getByRole('button', { name: 'Scan QR', exact: true })).toHaveAttribute('aria-pressed', 'false');
        },
    );
});
