// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { BellIcon } from '../../../packages/core/src/ui/icons/index.jsx';

describe('<BellIcon>', () => {
    it('renders an SVG using the shared icon contract', () => {
        const { container } = render(<BellIcon />);
        const icon = container.querySelector('svg');

        expect(icon).not.toBeNull();
        expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
        expect(icon).toHaveAttribute('stroke', 'currentColor');
        expect(icon).toHaveAttribute('data-xc-icon');
    });
});
