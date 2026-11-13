// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A switch on a form carries the same label-row '?' help as a field: the tip
// follows the label text, opening it never flips the switch, and the
// switch's accessible name stays its label.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Switch } from '../../../packages/core/src/ui/Switch.jsx';

afterEach(cleanup);

describe('<Switch help>', () => {
    it('draws a ? help tip after the label and keeps the switch named by its label', () => {
        render(<Switch label="Divisible" help="On lets holders send fractions." checked={false} onChange={() => {}} />);
        const control = screen.getByRole('switch', { name: 'Divisible' });
        const tip = screen.getByRole('button', { name: 'About Divisible' });
        expect(control).toBeTruthy();
        expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe('On lets holders send fractions.');
        expect(tip.closest('label')).toBe(control.closest('label'));
    });

    it('opens the tip without flipping the switch', () => {
        const onChange = vi.fn();
        render(<Switch label="Coin control" help="Pick the coins that pay." checked={false} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'About Coin control' }));
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('tooltip').hidden).toBe(false);
    });

    it('draws no tip without help', () => {
        render(<Switch label="Divisible" checked={false} onChange={() => {}} />);
        expect(screen.queryByRole('button')).toBeNull();
    });
});
