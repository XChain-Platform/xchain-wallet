// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StatusMessage } from '../../../packages/core/src/ui/StatusMessage.jsx';

describe('<StatusMessage>', () => {
    it.each([
        ['status', 'status', 'polite'],
        ['success', 'status', 'polite'],
        ['error', 'alert', 'assertive'],
    ])('maps %s to the expected live-region semantics', (variant, role, live) => {
        render(<StatusMessage variant={variant}>Saved</StatusMessage>);
        expect(screen.getByRole(role)).toHaveAttribute('aria-live', live);
    });

    it.each([
        ['warning', 'alert', 'assertive'],
        ['error', 'status', 'polite'],
    ])('lets a %s message announce as %s while keeping its tone', (variant, role, live) => {
        render(<StatusMessage variant={variant} role={role}>Check this</StatusMessage>);
        const message = screen.getByRole(role);
        expect(message).toHaveAttribute('aria-live', live);
        expect(message).toHaveAttribute('data-variant', variant);
    });

    it('renders a note as static context, not a live region', () => {
        render(<StatusMessage variant="warning" role="note">Watch-only</StatusMessage>);
        const message = screen.getByRole('note');
        expect(message).not.toHaveAttribute('aria-live');
        expect(message).not.toHaveAttribute('aria-atomic');
    });

    it('ignores an unknown role and keeps the variant semantics', () => {
        render(<StatusMessage variant="error" role="banner">Failed</StatusMessage>);
        expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    });

    it('renders IDs, custom classes, and collapsed technical details', () => {
        render(
            <StatusMessage id="save-state" className="spaced" details="RPC 503">
                Could not save
            </StatusMessage>,
        );
        const message = screen.getByRole('status');
        expect(message).toHaveAttribute('id', 'save-state');
        expect(message).toHaveClass('spaced');
        expect(screen.getByText('Technical details')).toBeInTheDocument();
        expect(screen.getByText('RPC 503')).toBeInTheDocument();
    });

    it('runs a valid recovery action with its custom accessible name', () => {
        const onAction = vi.fn();
        render(
            <StatusMessage recovery={{ label: 'Retry', ariaLabel: 'Retry saving', onAction }}>
                Save failed
            </StatusMessage>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
        expect(onAction).toHaveBeenCalledOnce();
    });

    it('omits incomplete recovery controls', () => {
        render(<StatusMessage recovery={{ label: 'Retry' }}>Save failed</StatusMessage>);
        expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it.each([null, undefined, ''])('renders nothing for empty content %#', (children) => {
        const { container } = render(<StatusMessage>{children}</StatusMessage>);
        expect(container).toBeEmptyDOMElement();
    });
});
