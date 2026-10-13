// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { FileTypeIcon } from '../../../packages/core/src/ui/icons/index.jsx';

function iconParts(container) {
    const icon = container.querySelector('svg');
    return {
        icon,
        label: icon.querySelector('text'),
        badge: icon.querySelector('rect'),
    };
}

describe('<FileTypeIcon>', () => {
    it('renders a known file type with normalized extension styling', () => {
        const { container } = render(<FileTypeIcon type=".PDF" />);
        const { icon, label, badge } = iconParts(container);

        expect(label).toHaveTextContent('PDF');
        expect(badge).toHaveAttribute('fill', '#dc2626');
        expect(icon).toHaveAttribute('width', '18');
        expect(icon).toHaveAttribute('height', '18');
    });

    it('uses a short uppercase label and fallback color for unknown types', () => {
        const { container } = render(<FileTypeIcon type="walletbackup" />);
        const { label, badge } = iconParts(container);

        expect(label).toHaveTextContent('WALL');
        expect(label).toHaveAttribute('font-size', '4');
        expect(badge).toHaveAttribute('fill', '#6b7280');
    });

    it('renders an empty type as a decorative generic file icon', () => {
        const { container } = render(<FileTypeIcon />);
        const { icon, label } = iconParts(container);

        expect(label).toHaveTextContent('FILE');
        expect(icon).toHaveAttribute('aria-hidden', 'true');
        expect(icon).toHaveAttribute('focusable', 'false');
        expect(icon).toHaveAttribute('data-xc-icon');
    });
});
