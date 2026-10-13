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
import { readFileSync } from 'node:fs';
import React from 'react';

const useReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({ useReachability }));

import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';

const bannerCss = readFileSync(
    'packages/core/src/shared/components/ReachabilityBanner.module.css',
    'utf8',
);
const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');

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

afterEach(() => {
    cleanup();
    useReachability.mockReset();
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    if (originalInnerHeight) Object.defineProperty(window, 'innerHeight', originalInnerHeight);
});

describe('ReachabilityBanner delayed-data copy', () => {
    it('uses plain state wording and exposes one atomic polite announcement', () => {
        mount();
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('Network issues');
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
        expect(screen.getByRole('status')).toHaveTextContent('Wallet offline');
    });

    it('keeps a 360 by 800 phone banner compact and reveals complete details on request', () => {
        Object.defineProperties(window, {
            innerWidth: { configurable: true, value: 360 },
            innerHeight: { configurable: true, value: 800 },
        });
        mount({
            perChain: [chain({
                services: { encoder: 'unreachable', hub: 'unreachable', explorer: 'unreachable' },
            })],
        });

        const toggle = screen.getByRole('button', { name: 'Details' });
        const details = document.getElementById(toggle.getAttribute('aria-controls'));
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(details).not.toBeVisible();
        expect(screen.getByText('Network issues')).toBeVisible();
        expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();

        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute('aria-expanded', 'true');
        expect(details).toBeVisible();
        expect(details).toHaveTextContent(
            "On Litecoin testnet, you can't send or create transactions, fee prices are unavailable and balances and history may be out of date.",
        );
        expect(bannerCss).not.toMatch(/overflow(?:-y)?:\s*(?:auto|scroll)/);
        expect(bannerCss).toMatch(/\.title\s*\{[^}]*white-space:\s*nowrap/s);
        const phoneRule = /@media \(max-width:\s*(\d+)px\)\s*\{[\s\S]*?\.banner\s*\{([^}]*)\}/.exec(bannerCss);
        expect(phoneRule).not.toBeNull();
        expect(Number(phoneRule[1])).toBeGreaterThanOrEqual(window.innerWidth);
        const cap = /max-height:\s*min\(([\d.]+)vh,\s*([\d.]+)rem\)/.exec(phoneRule[2]);
        expect(cap).not.toBeNull();
        expect(Math.min(window.innerHeight * Number(cap[1]) / 100, Number(cap[2]) * 16))
            .toBeLessThanOrEqual(100);
    });

    it('names the last confirmed block and its age for a stale explorer', () => {
        const tipBlock = 4876327;
        mount({ perChain: [chain({ freshness: { explorer: { stale: true, tipBlock, tipAgeSeconds: 215254, replicaHalted: false } } })] });
        const text = screen.getByRole('status').textContent;
        expect(text).toMatch(/balances and history are behind/);
        expect(text).toContain(`last confirmed block ${tipBlock.toLocaleString()} was 2 days ago`);
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
