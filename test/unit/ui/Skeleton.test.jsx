// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Skeleton } from '../../../packages/core/src/ui/Skeleton.jsx';

describe('<Skeleton>', () => {
    it('is hidden from assistive technology by default and applies dimensions', () => {
        const { container } = render(
            <Skeleton shape="card" width={120} height="4rem" className="extra" style={{ opacity: 0.5 }} />,
        );
        const skeleton = container.firstChild;
        expect(skeleton).toHaveAttribute('aria-hidden', 'true');
        expect(skeleton).toHaveClass('extra');
        expect(skeleton).toHaveStyle({ width: '120px', height: '4rem', opacity: '0.5' });
    });

    it('becomes a named status when ariaLabel is supplied', () => {
        render(<Skeleton ariaLabel="Loading balances" />);
        const skeleton = screen.getByRole('status', { name: 'Loading balances' });
        expect(skeleton).not.toHaveAttribute('aria-hidden');
    });

    it('renders row variants with optional avatars', () => {
        const { container, rerender } = render(<Skeleton.Row />);
        expect(container.firstChild.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
        rerender(<Skeleton.Row avatar={false} titleWidth="70%" subtitleWidth="30%" />);
        expect(container.firstChild.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
        expect(container.querySelectorAll('[style]')[0]).toHaveStyle({ width: '70%' });
        expect(container.querySelectorAll('[style]')[1]).toHaveStyle({ width: '30%' });
    });

    it('normalizes list row counts and forwards the avatar state', () => {
        const { container, rerender } = render(<Skeleton.List rows={2.9} avatar={false} />);
        expect(container.firstChild.children).toHaveLength(2);
        rerender(<Skeleton.List rows={-1} />);
        expect(container.firstChild).toBeEmptyDOMElement();
    });
});
