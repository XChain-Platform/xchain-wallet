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
});
