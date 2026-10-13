// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StalenessLabel } from '../../../packages/core/src/shared/components/StalenessLabel.jsx';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete navigator.onLine;
});

describe('StalenessLabel', () => {
    it('keeps seeded elapsed-time labels concise at every supported scale', () => {
        vi.useFakeTimers();
        const now = new Date('2026-07-08T14:05:00Z');
        vi.setSystemTime(now);
        let state = 0x51a1e123;
        const timestamps = Array.from({ length: 24 }, () => {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            return now.getTime() - (state % (30 * 24 * 60 * 60 * 1000));
        });

        render(<>{timestamps.map((lastSyncedAt) => (
            <StalenessLabel key={lastSyncedAt} lastSyncedAt={lastSyncedAt} />
        ))}</>);

        const labels = screen.getAllByRole('status');
        expect(labels).toHaveLength(timestamps.length);
        for (const label of labels) {
            expect(label.textContent).toMatch(/^Last synced /);
            expect(label.textContent.length).toBeLessThanOrEqual(32);
            expect(label).toHaveAttribute('aria-live', 'off');
        }
    });

    it('uses the shared relative wording and exposes a local absolute time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-08T14:05:00Z'));
        vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jul 8, 2026, 7:00 AM PDT');

        render(<StalenessLabel lastSyncedAt={Date.parse('2026-07-08T14:00:00Z')} />);

        const label = screen.getByRole('status');
        expect(label).toHaveTextContent('Updated 5 minutes ago');
        expect(label).toHaveAttribute('title', 'Jul 8, 2026, 7:00 AM PDT');
        expect(label.textContent).not.toMatch(/\b5m ago\b|5 min ago/);
    });

    it('replaces elapsed wording with the shared saved-data message while offline', () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
        render(<StalenessLabel lastSyncedAt={Date.now() - 5 * 60_000} warnAfterMs={60_000} />);

        expect(screen.getByRole('status')).toHaveTextContent('Updated 5 minutes ago');

        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        act(() => { window.dispatchEvent(new Event('offline')); });

        const label = screen.getByRole('status');
        expect(label).toHaveTextContent('Offline, showing saved data');
        expect(label.className).toMatch(/stale/);
    });
});
