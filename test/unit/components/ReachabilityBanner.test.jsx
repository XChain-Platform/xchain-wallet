// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ReachabilityBanner keeps the default notice to one line and puts coin
// identities, without network kinds, behind its disclosure.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const useReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({ useReachability }));

import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { NoticesRouteContext } from '../../../packages/core/src/shared/components/noticesRoute.js';
import { TxStatusTimeline } from '../../../packages/core/src/shared/components/TxStatusTimeline.jsx';

const chain = (over = {}) => ({
    chainId: 'litecoin-testnet',
    mode: 'degraded',
    services: { encoder: 'reachable', hub: 'reachable', explorer: 'reachable' },
    ...over,
});

const css = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components/ReachabilityBanner.module.css',
), 'utf8');

function mount(state = {}) {
    useReachability.mockReturnValue({ loading: false, overall: 'degraded', perChain: [], refresh: () => {}, lastChecked: null, ...state });
    return render(<ReachabilityBanner />);
}

afterEach(() => { cleanup(); useReachability.mockReset(); });

describe('ReachabilityBanner', () => {
    it('uses one short atomic notice without technical status text', () => {
        mount({ perChain: [chain()] });
        const status = screen.getByRole('status');
        expect(screen.getByText('Some balances may be out of date')).toBeTruthy();
        expect(status).not.toHaveTextContent(/degraded|offline|hub|encoder|explorer/i);
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveAttribute('aria-atomic', 'true');
        expect(screen.queryByRole('button', { name: /dismiss|close/i })).toBeNull();
    });

    it('runs the retry action and reports when a check is already running', () => {
        const refresh = vi.fn();
        const view = mount({ refresh });
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(refresh).toHaveBeenCalledOnce();

        useReachability.mockReturnValue({
            loading: true,
            overall: 'offline',
            perChain: [],
            refresh,
            lastChecked: null,
        });
        view.rerender(<ReachabilityBanner />);
        expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Some balances may be out of date');
    });

    it('discloses each affected coin once by icon and name without a network kind', () => {
        mount({
            perChain: [
                chain(),
                chain({ chainId: 'litecoin-regtest', mode: 'offline' }),
                chain({ chainId: 'bitcoin-regtest' }),
                chain({ chainId: 'dogecoin-mainnet', mode: 'normal' }),
            ],
        });

        fireEvent.click(screen.getByText('Details'));
        const list = screen.getByRole('list', { name: 'Affected coins' });
        expect(within(list).getAllByRole('listitem')).toHaveLength(2);
        expect(list).toHaveTextContent('Litecoin');
        expect(list).toHaveTextContent('Bitcoin');
        expect(list).not.toHaveTextContent(/mainnet|testnet|regtest/i);
        for (const image of list.querySelectorAll('img')) {
            expect(image).toHaveAttribute('alt', '');
        }
    });

    it('adds the last-checked age to the Details panel', () => {
        mount({ perChain: [chain()], lastChecked: Date.now() - 120_000 });

        fireEvent.click(screen.getByText('Details'));
        expect(screen.getByText('Last checked 2m ago.')).toBeInTheDocument();
    });

    it('opens Details as a row below the notice line instead of a floating panel', () => {
        mount({ perChain: [chain()], lastChecked: Date.now() - 120_000 });
        const toggle = screen.getByRole('button', { name: 'Details' });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');

        fireEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        const panel = document.getElementById(toggle.getAttribute('aria-controls'));
        const line = screen.getByRole('status').parentElement;
        expect(panel).toHaveTextContent('Last checked 2m ago.');
        expect(line.contains(panel)).toBe(false);
        expect(panel.parentElement).toBe(line.parentElement);
        const panelRule = css.match(/\.detailPanel\s*\{[^}]*\}/s)?.[0] || '';
        expect(panelRule).not.toMatch(/position:\s*absolute|overflow|max-height/);
    });

    it('closes Details when the route changes', () => {
        useReachability.mockReturnValue({
            loading: false, overall: 'degraded', perChain: [chain()], refresh: () => {}, lastChecked: Date.now(),
        });
        const view = render(
            <NoticesRouteContext.Provider value="home"><ReachabilityBanner /></NoticesRouteContext.Provider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Details' }));
        expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'true');

        view.rerender(
            <NoticesRouteContext.Provider value="settings"><ReachabilityBanner /></NoticesRouteContext.Provider>,
        );
        expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByRole('list', { name: 'Affected coins' })).toBeNull();
    });

    it('announces only the reachability state when poll details rerender', () => {
        const view = mount({ lastChecked: 100 });
        const announcement = screen.getByRole('status');
        expect(announcement).toHaveTextContent('Some balances may be out of date');
        expect(announcement).not.toHaveTextContent('Last checked');

        useReachability.mockReturnValue({
            loading: false,
            overall: 'degraded',
            perChain: [],
            refresh: () => {},
            lastChecked: 200,
        });
        view.rerender(<ReachabilityBanner />);
        expect(screen.getByRole('status')).toBe(announcement);
        expect(screen.getByRole('status')).toHaveTextContent('Some balances may be out of date');
    });

    it('renders nothing for a chain that is current', () => {
        mount({ overall: 'normal', perChain: [chain({ mode: 'normal', freshness: { explorer: { stale: false } } })] });
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('keeps the sentence and inline actions in one row at 360 px', () => {
        const originalWidth = window.innerWidth;
        window.innerWidth = 360;
        try {
            mount({ perChain: [chain()] });
            const banner = screen.getByRole('status').parentElement;
            expect(window.innerWidth).toBe(360);
            expect(banner.children).toHaveLength(3);
            expect(banner.children[0]).toHaveTextContent('Some balances may be out of date');
            expect(banner.children[1]).toHaveTextContent('Try again');
            expect(banner.children[2]).toHaveTextContent('Details');
            expect(css).toMatch(/\.banner\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*nowrap;/s);
            expect(css).toMatch(/\.banner\s*\{[^}]*white-space:\s*nowrap;/s);
        } finally {
            window.innerWidth = originalWidth;
        }
    });
});

describe('transaction confirmation announcement', () => {
    it('announces the confirmation transition once and ignores later timeline rerenders', () => {
        const pending = { txHash: 'abc', blockIndex: 0, timestamp: 0 };
        const confirmed = { txHash: 'abc', blockIndex: 100, timestamp: 0 };
        const view = render(<TxStatusTimeline entry={pending} chainTip={99} />);
        const announcement = screen.getByRole('status');
        expect(announcement).toHaveAttribute('aria-live', 'polite');
        expect(announcement).toHaveTextContent('');

        view.rerender(<TxStatusTimeline entry={confirmed} chainTip={100} />);
        expect(screen.getByRole('status')).toBe(announcement);
        expect(announcement).toHaveTextContent('Transaction confirmed.');

        view.rerender(<TxStatusTimeline entry={confirmed} chainTip={101} />);
        expect(screen.getByRole('status')).toBe(announcement);
        expect(announcement).toHaveTextContent('Transaction confirmed.');
    });
});
