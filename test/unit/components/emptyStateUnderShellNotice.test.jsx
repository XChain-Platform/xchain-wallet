// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// While the shell's reachability notice is up, a list that could not be
// checked is unavailable, not empty: its empty state steps aside and the page
// carries one message.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const useReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({ useReachability }));

import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { EmptyState, Screen } from '../../../packages/core/src/ui/index.js';

let savedResizeObserver;
beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });
afterEach(() => { cleanup(); useReachability.mockReset(); });

function mount(overall, routeKey, emptyProps = {}) {
    useReachability.mockReturnValue({
        loading: false, overall, perChain: [], refresh: () => {}, lastChecked: null,
    });
    return render(
        <FullLayoutWithNav routeKey={routeKey} notices={<ReachabilityBanner />}>
            <Screen>
                <EmptyState title="No polls yet" body="Polls appear here." {...emptyProps} />
            </Screen>
        </FullLayoutWithNav>,
    );
}

function pageMessages(container) {
    return container.querySelectorAll('[data-variant], [data-empty-state]').length;
}

describe('empty states under the shell reachability notice', () => {
    it.each(['offline', 'degraded'])('drops a network list empty state while %s', (overall) => {
        const { container } = mount(overall, 'governance-polls:1');
        expect(screen.getByText(/may be out of date/)).toBeInTheDocument();
        expect(screen.queryByText('No polls yet')).toBeNull();
        expect(pageMessages(container)).toBe(1);
    });

    it('keeps the actions of an empty state that steps aside', () => {
        const onAction = vi.fn();
        const { container } = mount('offline', 'messaging:1', { actionLabel: 'New message', onAction });
        expect(screen.queryByText('No polls yet')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'New message' }));
        expect(onAction).toHaveBeenCalledTimes(1);
        expect(pageMessages(container)).toBe(1);
    });

    it('shows the empty state when the services answer', () => {
        const { container } = mount('normal', 'governance-polls:1');
        expect(screen.getByText('No polls yet')).toBeInTheDocument();
        expect(pageMessages(container)).toBe(1);
    });

    it('keeps an empty state that states the outage or is not about network data', () => {
        mount('offline', 'governance-polls:1', { showWhileUnavailable: true });
        expect(screen.getByText('No polls yet')).toBeInTheDocument();
    });

    it('keeps the empty state of a screen whose data is held on the device', () => {
        const { container } = mount('offline', 'contacts:1');
        expect(screen.getByText('No polls yet')).toBeInTheDocument();
        expect(screen.queryByText(/may be out of date/)).toBeNull();
        expect(pageMessages(container)).toBe(1);
    });
});
