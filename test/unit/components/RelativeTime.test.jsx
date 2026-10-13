// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RelativeTime } from '../../../packages/core/src/shared/components/RelativeTime.jsx';

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

    it('exposes the exact local time on hover and reveals it after a long press', () => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jan 15, 2026, 3:58 AM PST');

        render(<RelativeTime timestamp={NOW.getTime() - 2 * 60_000} />);
        const time = screen.getByText('2 min ago');

        expect(time).toHaveAttribute('title', 'Jan 15, 2026, 3:58 AM PST');
        expect(time).toHaveAttribute('dateTime', '2026-01-15T11:58:00.000Z');

        fireEvent.pointerDown(time, { pointerType: 'touch' });
        act(() => vi.advanceTimersByTime(500));
        expect(screen.getByText('Jan 15, 2026, 3:58 AM PST')).toBeTruthy();
    });
});
