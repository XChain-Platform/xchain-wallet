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
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

const useReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({ useReachability }));

import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';

const chain = (over = {}) => ({
    chainId: 'litecoin-testnet',
    mode: 'degraded',
    services: { encoder: 'reachable', hub: 'reachable', explorer: 'reachable' },
    ...over,
});

function mount(state) {
    useReachability.mockReturnValue({ overall: 'degraded', perChain: [], refresh: () => {}, lastChecked: null, ...state });
    return render(<ReachabilityBanner />);
}

afterEach(() => { cleanup(); useReachability.mockReset(); });

describe('ReachabilityBanner delayed-data copy', () => {
    it('names the last confirmed block and its age for a stale explorer', () => {
        mount({ perChain: [chain({ freshness: { explorer: { stale: true, tipBlock: 4876327, tipAgeSeconds: 215254, replicaHalted: false } } })] });
        const text = screen.getByRole('status').textContent;
        expect(text).toMatch(/balances and history are behind/);
        expect(text).toMatch(/last confirmed block 4,876,327 was 2 days ago/);
        expect(text).toMatch(/catching up/);
    });

    it('says indexing is paused when the replica is halted', () => {
        mount({ perChain: [chain({ freshness: { explorer: { stale: true, tipBlock: 10, tipAgeSeconds: 90, replicaHalted: true } } })] });
        const text = screen.getByRole('status').textContent;
        expect(text).toMatch(/paused/);
        expect(text).toMatch(/2 minutes ago/);
    });

    it('still explains itself without tip fields', () => {
        mount({ perChain: [chain({ freshness: { explorer: { stale: true, tipBlock: null, tipAgeSeconds: null, replicaHalted: null } } })] });
        const text = screen.getByRole('status').textContent;
        expect(text).toMatch(/balances and history are behind\./);
    });

    it('renders nothing for a chain that is current', () => {
        mount({ overall: 'normal', perChain: [chain({ mode: 'normal', freshness: { explorer: { stale: false } } })] });
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('keeps the unreachable-service copy for a chain whose explorer is down rather than behind', () => {
        mount({ perChain: [chain({ services: { encoder: 'reachable', hub: 'reachable', explorer: 'unreachable' } })] });
        const text = screen.getByRole('status').textContent;
        expect(text).toMatch(/may be out of date/);
        expect(text).not.toMatch(/behind/);
    });
});
