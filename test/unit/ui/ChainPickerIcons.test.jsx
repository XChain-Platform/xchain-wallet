// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { ChevronIcon } from '../../../packages/core/src/ui/ChainPicker.icons.jsx';

describe('<ChevronIcon>', () => {
    it('renders a decorative, unfocusable closed-state icon', () => {
        const { container } = render(<ChevronIcon open={false} />);
        const icon = container.querySelector('svg');

        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveAttribute('focusable', 'false');
        expect(icon).toHaveAttribute('data-xc-icon');
        expect(icon).toHaveStyle({ transform: 'none' });
        expect(icon.style.getPropertyValue('--xc-icon-size')).toBe('');
    });

    it('rotates the same icon for the open state', () => {
        const { container } = render(<ChevronIcon open />);

        expect(container.querySelector('svg')).toHaveStyle({ transform: 'rotate(180deg)' });
    });
});
