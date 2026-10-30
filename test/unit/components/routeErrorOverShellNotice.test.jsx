// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// A screen's own error ("Couldn't load your listings") says more than the
// shell's "Some balances may be out of date", so the shell's notice steps
// aside while the error shows.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

const useReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({ useReachability }));

import { FullLayoutWithNav } from '../../../packages/core/src/shared/components/LeftNav.jsx';
import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { FormNotice, FormPage, Screen, StatusMessage } from '../../../packages/core/src/ui/index.js';

let savedResizeObserver;
beforeAll(() => {
    savedResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterAll(() => { globalThis.ResizeObserver = savedResizeObserver; });
afterEach(() => { cleanup(); useReachability.mockReset(); });

function boxes(container) {
    const all = [...container.querySelectorAll('[data-variant]')];
    return all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
}

function mount(overall, content) {
    useReachability.mockReturnValue({
        loading: false, overall, perChain: [], refresh: () => {}, lastChecked: null,
    });
    return render(
        <FullLayoutWithNav routeKey="my-orders:1" notices={<ReachabilityBanner />}>
            <Screen>{content}</Screen>
        </FullLayoutWithNav>,
    );
}

describe('a screen error over the shell reachability notice', () => {
    it('shows only the screen error', () => {
        const { container } = mount('degraded', (
            <StatusMessage variant="error">Could not load your orders. Try again.</StatusMessage>
        ));
        const shown = boxes(container);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toHaveTextContent('Could not load your orders.');
    });

    it('brings the shell notice back when the error clears', () => {
        function Page() {
            const [failed, setFailed] = useState(true);
            return (
                <>
                    {failed ? <StatusMessage variant="error">Could not load your orders.</StatusMessage> : null}
                    <button type="button" onClick={() => setFailed(false)}>Retry</button>
                </>
            );
        }
        const { container } = mount('offline', <Page />);
        expect(screen.queryByText(/may be out of date/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(boxes(container)).toHaveLength(1);
        expect(screen.getByText(/may be out of date/)).toBeInTheDocument();
    });

    it('keeps a warning beside the shell notice for the form to merge', () => {
        const { container } = mount('offline', (
            <FormPage>
                <FormNotice lead="Locking is permanent.">Each flag is a one-way switch.</FormNotice>
            </FormPage>
        ));
        const shown = boxes(container);
        expect(shown).toHaveLength(1);
        expect(shown[0]).toHaveTextContent('Some balances may be out of date');
        expect(shown[0]).toHaveTextContent('Locking is permanent.');
    });
});
