// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The Scan screen's paste box carries its Paste button inside the field, like
// every other field that takes pasted text, and a click fills the box.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ScanRoute } from '../../../packages/core/src/shared/routes/ScanRoute.jsx';

describe('ScanRoute paste box', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('puts a Paste button inside the field and fills it from the clipboard', async () => {
        const readText = vi.fn().mockResolvedValue('bitcoin:bc1qexample');
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
        render(<ScanRoute onClassified={() => {}} />);
        const field = screen.getByRole('textbox');
        const button = screen.getByRole('button', { name: /paste from clipboard/i });
        expect(field.parentElement.contains(button)).toBe(true);
        fireEvent.click(button);
        await waitFor(() => expect(field.value).toBe('bitcoin:bc1qexample'));
    });

    it('shows an unreadable paste as the first item of the form, above the scanner and the field', () => {
        render(<ScanRoute onClassified={() => {}} />);
        const field = screen.getByRole('textbox');
        fireEvent.change(field, { target: { value: 'hello not an address' } });
        fireEvent.click(screen.getByRole('button', { name: /use pasted text/i }));
        const form = screen.getByTestId('scan-route');
        const notice = screen.getByText(/doesn't know how to use/i);
        // The shared form template renders form notices just above the form,
        // so the notice is either inside it or immediately before it.
        const insideOrBefore = form.contains(notice)
            || Boolean(notice.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(insideOrBefore).toBe(true);
        // No form text or control comes before the notice.
        const before = [...form.querySelectorAll('button, input, textarea, p')]
            .filter((el) => el.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(before).toHaveLength(0);
    });
});
