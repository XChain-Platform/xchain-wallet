// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Panic mode actions use the style-guide Button's semantic variants.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { clearPanicModeState } from '../../../packages/core/src/flows/panicMode.js';
import { PanicModeRow } from '../../../packages/core/src/shared/components/settings/PanicModeRow.jsx';

afterEach(() => { cleanup(); clearPanicModeState(); vi.restoreAllMocks(); });

describe('PanicModeRow style-guide actions', () => {
    it('uses danger actions for activation and a ghost action for deactivation', () => {
        const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<PanicModeRow />);
        const activate = screen.getByRole('button', { name: 'Activate' });
        expect(activate.className).toMatch(/danger/);
        expect(activate.style.border).toBe('');
        fireEvent.click(activate);
        const confirm = screen.getByRole('button', { name: 'Confirm 24-hour freeze' });
        expect(confirm.className).toMatch(/danger/);
        fireEvent.click(confirm);
        const deactivate = screen.getByRole('button', { name: 'Deactivate' });
        expect(deactivate.className).toMatch(/ghost/);
        expect(deactivate.style.border).toBe('');
        expect(warn).not.toHaveBeenCalled();
    });
});
