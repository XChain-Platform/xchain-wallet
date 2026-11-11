// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShellReachabilityNoticeContext } from '../../../packages/core/src/shared/components/noticesRoute.js';
import { EmptyState } from '../../../packages/core/src/ui/EmptyState.jsx';

describe('<EmptyState> action variant', () => {
    it('uses a green primary action with the label icon by default', () => {
        render(<EmptyState title="No items" actionLabel="Create item" onAction={() => {}} />);

        const action = screen.getByRole('button', { name: 'Create item' });
        expect(action.className).toMatch(/success/);
        expect(action.querySelector('svg')).not.toBeNull();
    });

    it('allows the primary variant and icon to be supplied while keeping the secondary action unchanged', () => {
        render(
            <EmptyState
                title="No items"
                actionLabel="Open creator"
                actionVariant="primary"
                actionIcon={<svg data-testid="primary-icon" />}
                onAction={() => {}}
                secondaryActionLabel="Learn more"
                onSecondaryAction={() => {}}
            />,
        );

        const [primary, secondary] = screen.getAllByRole('button');
        expect(primary.className).toMatch(/primary/);
        expect(primary).toContainElement(screen.getByTestId('primary-icon'));
        expect(secondary.className).toMatch(/secondary/);
    });

    it('keeps the default variant and icon when only actions remain under a shell notice', () => {
        render(
            <ShellReachabilityNoticeContext.Provider value={{ kind: 'offline' }}>
                <EmptyState
                    title="No items"
                    actionLabel="Add item"
                    onAction={vi.fn()}
                    secondaryActionLabel="Learn more"
                    onSecondaryAction={vi.fn()}
                />
            </ShellReachabilityNoticeContext.Provider>,
        );

        expect(screen.queryByText('No items')).toBeNull();
        const actions = screen.getAllByRole('button');
        expect(actions[0].className).toMatch(/success/);
        expect(actions[0].querySelector('svg')).not.toBeNull();
        expect(actions[1].className).toMatch(/secondary/);
        expect(within(actions[1]).getByText('Learn more')).toBeInTheDocument();
    });
});
