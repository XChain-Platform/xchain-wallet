// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A page shows at most one empty state. Sections that are all empty (open
// dispensers, DEX orders, dispenses, swaps) each say so in a plain line under
// their header instead of stacking centred empty states.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { EmptyState, FormNotice, FormPage, Screen } from '../../../packages/core/src/ui/index.js';

afterEach(cleanup);

function pageEmptyStates(container) {
    return container.querySelectorAll('[data-empty-state]').length;
}

describe('one empty state per page', () => {
    it('keeps a lone empty state as the page message', () => {
        const { container } = render(
            <Screen>
                <EmptyState title="No contracts" body="Published contracts appear here." />
            </Screen>,
        );
        expect(pageEmptyStates(container)).toBe(1);
        expect(screen.getByText('Published contracts appear here.')).toBeInTheDocument();
    });

    it('draws several empty states on one page as section lines', () => {
        const { container } = render(
            <Screen>
                <section><h2>Open dispensers</h2><EmptyState titleAs="p" title="No open dispensers" body="Open dispensers appear here." actionLabel="Create" onAction={() => {}} /></section>
                <section><h2>Open DEX orders</h2><EmptyState titleAs="p" title="No open DEX orders" body="Open orders appear here." /></section>
                <section><h2>Recent dispenses</h2><EmptyState titleAs="p" title="No recent dispenses" body="Recent dispenses appear here." /></section>
            </Screen>,
        );
        expect(pageEmptyStates(container)).toBe(0);
        expect(screen.getByText('No open dispensers')).toBeInTheDocument();
        expect(screen.getByText('No recent dispenses')).toBeInTheDocument();
        // A section line keeps its action but not the help text.
        expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
        expect(screen.queryByText('Open orders appear here.')).toBeNull();
    });

    it('returns to a page message when the other sections fill', () => {
        function Page() {
            const [filled, setFilled] = useState(false);
            return (
                <Screen>
                    <EmptyState title="No published contracts" body="Published contracts appear here." />
                    {filled ? <p>One interaction</p> : <EmptyState title="No contract interactions" />}
                    <button type="button" onClick={() => setFilled(true)}>Fill</button>
                </Screen>
            );
        }
        const { container } = render(<Page />);
        expect(pageEmptyStates(container)).toBe(0);
        fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
        expect(pageEmptyStates(container)).toBe(1);
    });

    it('draws an empty state inside a form body as a line beside the form notice', () => {
        const { container } = render(
            <Screen>
                <FormPage>
                    <FormNotice>A union follows each member's edits.</FormNotice>
                    <EmptyState title="No usable lists" body="Local and shared lists appear here." />
                </FormPage>
            </Screen>,
        );
        expect(pageEmptyStates(container)).toBe(0);
        expect(screen.getByText('No usable lists')).toBeInTheDocument();
        expect(screen.getByText('Local and shared lists appear here.')).toBeInTheDocument();
        expect(container.querySelectorAll('[data-variant]')).toHaveLength(1);
    });

    it('counts each page on its own', () => {
        const { container } = render(
            <div>
                <Screen><EmptyState title="No alerts" /></Screen>
                <Screen><EmptyState title="No contacts yet" /></Screen>
            </div>,
        );
        expect(pageEmptyStates(container)).toBe(2);
    });
});
