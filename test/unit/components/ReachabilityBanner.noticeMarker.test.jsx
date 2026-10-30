// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The shell's reachability notice marks its outermost box as a notice, so a
// placement check measures the full-width box and not the inner status span
// that holds the live region. The live region stays on that one span.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

const useReachability = vi.hoisted(() => vi.fn());
vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({ useReachability }));

import { ReachabilityBanner } from '../../../packages/core/src/shared/components/ReachabilityBanner.jsx';
import { StatusMessage } from '../../../packages/core/src/ui/StatusMessage.jsx';

afterEach(() => { cleanup(); useReachability.mockReset(); });

describe('ReachabilityBanner notice marker', () => {
    it('marks the outermost box as a notice and keeps one status element inside it', () => {
        useReachability.mockReturnValue({
            loading: false, overall: 'degraded', perChain: [], refresh: () => {}, lastChecked: null,
        });
        const { container } = render(<ReachabilityBanner />);
        const box = container.firstElementChild;
        expect(box).toHaveAttribute('data-xc-notice');
        expect(box).not.toHaveAttribute('role');
        expect(box).not.toHaveAttribute('aria-live');
        expect(box.querySelectorAll('[role="status"]')).toHaveLength(1);
        expect(container.querySelectorAll('[aria-live], [role="status"], [role="alert"]')).toHaveLength(1);
        expect(container.querySelectorAll('[data-xc-notice]')).toHaveLength(1);
    });

    it('leaves other StatusMessage boxes without the marker unless they opt in', () => {
        const { container } = render(<StatusMessage variant="warning" role={null}>Heads up</StatusMessage>);
        expect(container.firstElementChild).not.toHaveAttribute('data-xc-notice');
    });
});
