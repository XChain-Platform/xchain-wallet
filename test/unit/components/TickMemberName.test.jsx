// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { TickMemberName } from '../../../packages/core/src/shared/components/TickMemberName.jsx';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

function fakeMessaging(impl) {
    const calls = [];
    return {
        calls,
        getTokenInfo(args) {
            calls.push(args);
            return impl(args);
        },
    };
}

function mount(item, messaging, chainId = 'bitcoin-testnet') {
    return render(React.createElement(TickMemberName, { item, messaging, chainId }));
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

describe('TickMemberName', () => {
    beforeEach(() => __clearTokenInfoCache());

    it('renders a bare item as written without a lookup', () => {
        const m = fakeMessaging(() => Promise.resolve(null));
        const { container } = mount('FOO', m);
        const code = container.querySelector('code');
        expect(code.textContent).toBe('FOO');
        expect(code).toHaveAttribute('aria-label', 'FOO');
        expect(code).toHaveAttribute('title', 'FOO');
        expect(m.calls).toEqual([]);
    });

    it('visually truncates a long ticker while preserving its complete name', () => {
        const item = 'A-VERY-LONG-TICKER-NAME-THAT-MUST-NOT-GROW-THE-ROW';
        const m = fakeMessaging(() => Promise.resolve(null));
        const { container } = mount(item, m);
        const code = container.querySelector('code');

        expect(code).toHaveAttribute('aria-label', item);
        expect(code).toHaveAttribute('title', item);
        expect(code.style.maxWidth).toBe('100%');
        expect(code.style.overflow).toBe('hidden');
        expect(code.style.textOverflow).toBe('ellipsis');
        expect(code.style.whiteSpace).toBe('nowrap');
    });

    it('renders a future-root item as written', () => {
        const m = fakeMessaging(() => Promise.resolve(null));
        const { container } = mount('ETH:FOO', m);
        expect(container.querySelector('code').textContent).toBe('ETH:FOO');
        expect(m.calls).toEqual([]);
    });

    it('looks a DOGE id item up on the dogecoin chain of the same network', async () => {
        const m = fakeMessaging(() => Promise.resolve({ canonicalTick: 'DOGEPEPE' }));
        const { container } = mount('DOGE:^42', m);
        await waitFor(() => expect(container.querySelector('code').textContent).toContain('DOGEPEPE'));
        expect(m.calls).toEqual([{ chainId: 'dogecoin-testnet', tick: '^42', demo: false }]);
        expect(screen.getByTestId('tick-member-coin').textContent).toBe('DOGE');
    });

    it('shows id <id> while loading', () => {
        const m = fakeMessaging(() => new Promise(() => {}));
        const { container } = mount('DOGE:^42', m);
        expect(container.querySelector('code').textContent).toContain('id 42');
    });

    it('shows id <id> on a null answer', async () => {
        const response = deferred();
        const m = fakeMessaging(() => response.promise);
        const { container } = mount('DOGE:^42', m);
        const code = container.querySelector('code');
        expect(code).toHaveAttribute('aria-busy', 'true');
        expect(code.textContent).toContain('id 42');

        await act(async () => {
            response.resolve(null);
            await response.promise;
        });

        await waitFor(() => expect(code).not.toHaveAttribute('aria-busy'));
        expect(code.textContent).toContain('id 42');
    });

    it('shows id <id> on a failure', async () => {
        const response = deferred();
        const m = fakeMessaging(() => response.promise);
        const { container } = mount('DOGE:^42', m);
        const code = container.querySelector('code');
        expect(code).toHaveAttribute('aria-busy', 'true');
        expect(code.textContent).toContain('id 42');

        await act(async () => {
            response.reject(new Error('down'));
            await response.promise.catch(() => {});
        });

        await waitFor(() => expect(code).not.toHaveAttribute('aria-busy'));
        expect(code.textContent).toContain('id 42');
    });

    it('keeps a coin-qualified non-id rest as written beside the coin label', () => {
        const m = fakeMessaging(() => Promise.resolve(null));
        const { container } = mount('LTC:FOO', m);
        const code = container.querySelector('code');
        expect(code.textContent).toContain('FOO');
        expect(code).toHaveAttribute('aria-label', 'LTC FOO');
        expect(code).toHaveAttribute('title', 'LTC FOO');
        expect(screen.getByTestId('tick-member-coin').textContent).toBe('LTC');
        expect(m.calls).toEqual([]);
    });
});
