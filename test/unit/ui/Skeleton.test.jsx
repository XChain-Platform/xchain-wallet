// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { Skeleton } from '../../../packages/core/src/ui/Skeleton.jsx';
import { Button, Spinner } from '../../../packages/core/src/ui/Button.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

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

    it('includes padding inside an explicit loaded-row height', () => {
        const { container } = render(<Skeleton.Row height={72} />);
        const row = container.firstChild;
        const css = readFileSync('packages/core/src/ui/Skeleton.module.css', 'utf8');

        expect(row).toHaveStyle({ height: '72px' });
        expect(css).toMatch(/\.row\s*\{[^}]*box-sizing:\s*border-box[^}]*min-height:\s*var\(--xc-control-h-lg\)/s);
    });

    it('normalizes list row counts and forwards row geometry', () => {
        const { container, rerender } = render(
            <Skeleton.List
                rows={2.9}
                avatar={false}
                rowHeight={60}
                titleWidth="52%"
                subtitleWidth="34%"
            />,
        );
        expect(container.firstChild.children).toHaveLength(2);
        expect(container.firstChild.firstChild).toHaveStyle({ height: '60px' });
        expect(container.querySelectorAll('[style]')[1]).toHaveStyle({ width: '52%' });
        expect(container.querySelectorAll('[style]')[2]).toHaveStyle({ width: '34%' });
        rerender(<Skeleton.List rows={-1} />);
        expect(container.firstChild).toBeEmptyDOMElement();
    });
});

describe('<Spinner>', () => {
    it('uses one shared spinner size for each loading context', () => {
        render(
            <>
                <Button loading size="sm" data-testid="button-sm">Small</Button>
                <Button loading size="lg" data-testid="button-lg">Large</Button>
                <Spinner size="md" label="Checking" />
            </>,
        );

        expect(screen.getByTestId('button-sm').querySelector(`.${buttonStyles.spinner}`))
            .toHaveClass(buttonStyles.spinner_sm);
        expect(screen.getByTestId('button-lg').querySelector(`.${buttonStyles.spinner}`))
            .toHaveClass(buttonStyles.spinner_lg);
        expect(screen.getByRole('status', { name: 'Checking' }).querySelector(`.${buttonStyles.spinner}`))
            .toHaveClass(buttonStyles.spinner_md);
    });

    it('paints placeholders with a token every palette defines, not the raised surface that is white in light themes', () => {
        const css = readFileSync('packages/core/src/ui/Skeleton.module.css', 'utf8');
        const tokens = readFileSync('packages/core/src/ui/tokens.css', 'utf8');
        expect(css).toMatch(/background-color:\s*var\(--xc-skeleton,/);
        const raised = tokens.match(/--xc-surface-raised:/g).length;
        const skeleton = tokens.match(/--xc-skeleton:/g).length;
        expect(skeleton).toBe(raised);
    });
});
