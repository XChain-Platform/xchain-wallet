// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StalenessLabel } from '../../../packages/core/src/shared/components/StalenessLabel.jsx';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('StalenessLabel', () => {
    it('uses the shared relative wording and exposes a local absolute time', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-08T14:05:00Z'));
        vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jul 8, 2026, 7:00 AM PDT');

        render(<StalenessLabel lastSyncedAt={Date.parse('2026-07-08T14:00:00Z')} />);

        const label = screen.getByRole('status');
        expect(label).toHaveTextContent('Last synced 5 min ago');
        expect(label).toHaveAttribute('title', 'Jul 8, 2026, 7:00 AM PDT');
        expect(label.textContent).not.toMatch(/\b5m ago\b|5 minutes ago/);
    });
});
