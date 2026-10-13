// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelativeTime } from '../../../packages/core/src/shared/components/RelativeTime.jsx';
import { StalenessLabel } from '../../../packages/core/src/shared/components/StalenessLabel.jsx';
import { BridgeOriginTick } from '../../../packages/core/src/shared/routes/BridgeOriginBadge.jsx';

const NOW = new Date('2026-01-15T12:00:00Z');

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('RelativeTime', () => {
    it('updates while mounted and changes to an absolute date at one week', () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('Jan 8, 2026');

        const timestamp = NOW.getTime() - 7 * 24 * 60 * 60 * 1000 + 30_000;
        render(<RelativeTime timestamp={timestamp} />);

        expect(screen.getByText('6 days ago')).toBeTruthy();
        act(() => vi.advanceTimersByTime(30_000));
        expect(screen.getByText('Jan 8, 2026')).toBeTruthy();
    });

    it('exposes the exact local time on hover, keyboard focus, and long press', () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jan 15, 2026, 3:58 AM PST');

        render(<RelativeTime timestamp={NOW.getTime() - 2 * 60_000} />);
        const time = screen.getByText('2 min ago');

        expect(time).toHaveAttribute('title', 'Jan 15, 2026, 3:58 AM PST');
        expect(time).toHaveAttribute('dateTime', '2026-01-15T11:58:00.000Z');
        expect(time).toHaveAttribute('tabIndex', '0');

        fireEvent.focus(time);
        expect(screen.getByText('Jan 15, 2026, 3:58 AM PST')).toBeTruthy();
        fireEvent.blur(time);
        expect(screen.getByText('2 min ago')).toBeTruthy();

        fireEvent.pointerDown(time, { pointerType: 'touch' });
        act(() => vi.advanceTimersByTime(500));
        expect(screen.getByText('Jan 15, 2026, 3:58 AM PST')).toBeTruthy();
    });

    it('reveals a staleness timestamp on keyboard focus and touch', () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jan 15, 2026, 3:55 AM PST');

        render(<StalenessLabel lastSyncedAt={NOW.getTime() - 5 * 60_000} />);
        const label = screen.getByRole('status');

        expect(label).toHaveAttribute('tabIndex', '0');
        fireEvent.focus(label);
        expect(label).toHaveTextContent('Last updated Jan 15, 2026, 3:55 AM PST');
        fireEvent.blur(label);
        expect(label).toHaveTextContent('Updated 5 min ago');
        fireEvent.pointerUp(label, { pointerType: 'touch' });
        expect(label).toHaveTextContent('Last updated Jan 15, 2026, 3:55 AM PST');
    });

    it('keeps a bridged token wire name visible without hover', () => {
        render(<BridgeOriginTick tick="BTC.PEPECASH" localCoin="DOGE" />);

        expect(screen.getByTitle('On-chain token name: BTC.PEPECASH').parentElement)
            .toHaveTextContent('On-chain token name: BTC.PEPECASH');
    });
});
