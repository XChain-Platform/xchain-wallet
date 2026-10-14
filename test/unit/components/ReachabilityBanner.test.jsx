// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ReachabilityBanner copy for a chain whose explorer is reachable but BEHIND.
// The explorer serves a stale coin (marked, never refused), so the wallet keeps
// working and this banner is the only place the delay is said out loud; it
// has to name where the data stops and why, not "may be out of date".

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';

const useReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({ useReachability }));

import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { TxStatusTimeline } from '../../../packages/core/src/shared/components/TxStatusTimeline.jsx';

const chain = (over = {}) => ({
    chainId: 'litecoin-testnet',
    mode: 'degraded',
    services: { encoder: 'reachable', hub: 'reachable', explorer: 'reachable' },
    ...over,
});

function mount(state = {}) {
    useReachability.mockReturnValue({ loading: false, overall: 'degraded', perChain: [], refresh: () => {}, lastChecked: null, ...state });
    return render(<ReachabilityBanner />);
}

afterEach(() => { cleanup(); useReachability.mockReset(); });

describe('ReachabilityBanner delayed-data copy', () => {
    it('uses plain state wording and exposes one atomic polite announcement', () => {
        mount();
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Some wallet information is unavailable');
        expect(status).not.toHaveTextContent('degraded mode');
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
        expect(screen.getByRole('status')).toHaveTextContent('Wallet is offline');
    });

    it('announces only the reachability state when poll details rerender', () => {
        const view = mount({ lastChecked: 100 });
        const announcement = screen.getByRole('status');
        expect(announcement).toHaveTextContent('Some wallet information is unavailable');
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
        expect(screen.getByRole('status')).toHaveTextContent('Some wallet information is unavailable');
    });

    it('names the last confirmed block and its age for a stale explorer', () => {
        const tipBlock = 4876327;
        mount({ perChain: [chain({ freshness: { explorer: { stale: true, tipBlock, tipAgeSeconds: 215254, replicaHalted: false } } })] });
        const text = document.body.textContent;
        expect(text).toMatch(/balances and history are behind/);
        expect(text).toContain(`last confirmed block ${tipBlock.toLocaleString()} was 2 days ago`);
        expect(text).toMatch(/catching up/);
    });

    it('says indexing is paused when the replica is halted', () => {
        mount({ perChain: [chain({ freshness: { explorer: { stale: true, tipBlock: 10, tipAgeSeconds: 90, replicaHalted: true } } })] });
        const text = document.body.textContent;
        expect(text).toMatch(/paused/);
        expect(text).toMatch(/2 minutes ago/);
    });

    it('still explains itself without tip fields', () => {
        mount({ perChain: [chain({ freshness: { explorer: { stale: true, tipBlock: null, tipAgeSeconds: null, replicaHalted: null } } })] });
        const text = document.body.textContent;
        expect(text).toMatch(/balances and history are behind\./);
    });

    it('renders nothing for a chain that is current', () => {
        mount({ overall: 'normal', perChain: [chain({ mode: 'normal', freshness: { explorer: { stale: false } } })] });
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('keeps the unreachable-service copy for a chain whose explorer is down rather than behind', () => {
        mount({ perChain: [chain({ services: { encoder: 'reachable', hub: 'reachable', explorer: 'unreachable' } })] });
        const text = document.body.textContent;
        expect(text).toMatch(/may be out of date/);
        expect(text).not.toMatch(/behind/);
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
