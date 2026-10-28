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

    it('keeps role="alert" on a warning that must interrupt', () => {
        render(<StatusMessage variant="warning" role="alert">Check the address</StatusMessage>);
        const message = screen.getByRole('alert');
        expect(message).toHaveAttribute('aria-live', 'assertive');
        expect(message).toHaveAttribute('data-variant', 'warning');
    });

    it('drops the live region for a warning that is part of the page from the first paint', () => {
        const { container } = render(<StatusMessage variant="warning" role={null}>Sharing is permanent.</StatusMessage>);
        const message = container.firstElementChild;
        expect(message).not.toHaveAttribute('role');
        expect(message).not.toHaveAttribute('aria-live');
        expect(message).not.toHaveAttribute('aria-atomic');
        expect(message).toHaveAttribute('data-variant', 'warning');
    });

    it('passes a note role and a test hook through', () => {
        render(<StatusMessage variant="warning" role="note" testId="outside-note">Outside address</StatusMessage>);
        const message = screen.getByTestId('outside-note');
        expect(message).toHaveAttribute('role', 'note');
        expect(message).not.toHaveAttribute('aria-live');
    });

    it('holds several lines in one box and one announcement', () => {
        render(
            <StatusMessage variant="warning" role="alert">
                <p>First line</p>
                <p>Second line</p>
            </StatusMessage>,
        );
        const [message] = screen.getAllByRole('alert');
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(message).toHaveTextContent('First line');
        expect(message).toHaveTextContent('Second line');
    });

    it('opens the message with a bold lead-in sentence', () => {
        render(<StatusMessage variant="warning" lead="Locking is permanent.">Each flag is a one-way switch.</StatusMessage>);
        const lead = screen.getByText('Locking is permanent.');
        expect(lead.tagName).toBe('STRONG');
        expect(lead.closest('[data-variant]')).toHaveTextContent('Locking is permanent. Each flag is a one-way switch.');
    });

    it('names a loading notice and marks it busy', () => {
        render(<StatusMessage label="Loading markets" busy>Loading markets</StatusMessage>);
        expect(screen.getByRole('status', { name: 'Loading markets' })).toHaveAttribute('aria-busy', 'true');
    });

    it('leaves the name and busy state off by default', () => {
        render(<StatusMessage>Saved</StatusMessage>);
        const notice = screen.getByRole('status');
        expect(notice).not.toHaveAttribute('aria-label');
        expect(notice).not.toHaveAttribute('aria-busy');
    });

    it.each([null, undefined, ''])('renders nothing for empty content %#', (children) => {
        const { container } = render(<StatusMessage>{children}</StatusMessage>);
        expect(container).toBeEmptyDOMElement();
    });
});
