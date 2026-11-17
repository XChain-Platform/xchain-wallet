// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// The first field of each Import Wallet tab sits exactly 8px under the
// Phrase / Private key / Backup toggle. The form stack adds --xc-form-gap
// (16px) between its children, so the toggle's bottom margin must be the 8px
// token less that gap; a plain 8px margin stacked to 24px.

import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';

afterEach(cleanup);

const EXPECTED_MARGIN = 'calc(var(--xc-space-2) - var(--xc-form-gap, var(--xc-space-4)))';

function renderImport() {
    render(
        <MessagingProvider shell="web" messaging={{}}>
            <ImportWallet mode="fresh" onBack={() => {}} onImported={() => {}} />
        </MessagingProvider>,
    );
}

describe('ImportWallet toggle to first field gap', () => {
    it('keeps the form stack gap token as the only spacing under the toggle', () => {
        const css = readFileSync('packages/core/src/ui/FormPage.module.css', 'utf8');
        expect(css).toMatch(/\.body\s*\{[^}]*gap:\s*var\(--xc-form-gap\)/s);
        expect(readFileSync('packages/core/src/ui/tokens.css', 'utf8'))
            .toMatch(/--xc-form-gap:\s*var\(--xc-space-4\)/);
        const route = readFileSync('packages/core/src/shared/routes/ImportWallet.jsx', 'utf8');
        expect(route).toContain(`style={{ marginBottom: '${EXPECTED_MARGIN}' }}`);
        expect(route).not.toMatch(/marginBottom:\s*'var\(--xc-space-2\)'/);
    });

    it.each([
        ['Phrase', 'Wallet type'],
        ['Private key', null],
        ['Backup', null],
    ])('the %s tab follows the toggle directly with no spacer or wrapper', (tabName, fieldLabel) => {
        renderImport();
        const tabs = screen.getAllByRole('tab');
        const tab = tabs.find((el) => el.textContent.includes(tabName)) || tabs[tabs.length - 1];
        fireEvent.click(tab);
        const group = screen.getByRole('tablist');
        // The toggle carries the one margin, in the 8px-less-gap form.
        expect(group.style.marginBottom).toBe(EXPECTED_MARGIN);
        // The next sibling is the first field itself, not an empty slot.
        const next = group.nextElementSibling;
        expect(next).not.toBeNull();
        expect(next.textContent.trim().length).toBeGreaterThan(0);
        if (fieldLabel) expect(next.textContent).toContain(fieldLabel);
        // No inline top margin or padding on that first field.
        expect(next.style.marginTop).toBe('');
        expect(next.style.paddingTop).toBe('');
    });
});
