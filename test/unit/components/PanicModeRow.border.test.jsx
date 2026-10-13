// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Activate and Deactivate each set one border shorthand, so React never
// sees a shorthand mixed with borderColor and the colour survives a swap.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { clearPanicModeState } from '../../../packages/core/src/flows/panicMode.js';
import { PanicModeRow } from '../../../packages/core/src/shared/components/settings/PanicModeRow.jsx';

afterEach(() => { cleanup(); clearPanicModeState(); vi.restoreAllMocks(); });

describe('PanicModeRow borders', () => {
    it('uses the danger border on Activate and the neutral border on Deactivate without warnings', () => {
        const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<PanicModeRow />);
        const activate = screen.getByRole('button', { name: 'Activate' });
        expect(activate.style.border).toContain('var(--xc-danger)');
        fireEvent.click(activate);
        const deactivate = screen.getByRole('button', { name: 'Deactivate' });
        expect(deactivate.style.border).toContain('var(--xc-border-strong)');
        expect(warn).not.toHaveBeenCalled();
    });
});
