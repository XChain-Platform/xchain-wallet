// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { ChevronIcon } from '../../../packages/core/src/ui/ChainPicker.icons.jsx';

describe('ChevronIcon', () => {
    it('renders a decorative compact chevron and rotates with the open state', () => {
        const { container, rerender } = render(<ChevronIcon open={false} />);
        const icon = container.querySelector('svg');

        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveAttribute('focusable', 'false');
        expect(icon.style.getPropertyValue('--xc-icon-size')).toBe('var(--xc-icon-xs)');
        expect(icon.style.transform).toBe('none');

        rerender(<ChevronIcon open />);

        expect(icon.style.transform).toBe('rotate(180deg)');
    });
});
