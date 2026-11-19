// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../packages/core/src/shared/hooks/useReachability.js', () => ({
    useReachability: () => ({ overall: 'normal', perChain: [] }),
}));

import { NetworkStatusIndicator } from '../../../packages/core/src/shared/components/NetworkStatusIndicator.jsx';
import { preloadOnDemandOverlays } from '../../../packages/core/src/shared/components/onDemandOverlays.js';

// The app loads these on idle after first paint; load them up front here.
beforeAll(() => preloadOnDemandOverlays());

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('header popover focus return', () => {
    it('returns network-status focus after an outside press', () => {
        render(<NetworkStatusIndicator onOpenNetworkSettings={() => {}} />);
        const trigger = screen.getByRole('button', { name: /Network connected/ });
        const wrap = trigger.closest('[data-open]');
        fireEvent.click(trigger);
        screen.getByRole('button', { name: 'Network settings' }).focus();

        fireEvent.mouseDown(document.body);

        expect(wrap).toHaveAttribute('data-open', 'false');
        expect(trigger).toHaveFocus();
    });

    it('returns network-status focus after its action closes the popover', () => {
        const onOpenNetworkSettings = vi.fn();
        render(<NetworkStatusIndicator onOpenNetworkSettings={onOpenNetworkSettings} />);
        const trigger = screen.getByRole('button', { name: /Network connected/ });
        fireEvent.click(trigger);

        fireEvent.click(screen.getByRole('button', { name: 'Network settings' }));

        expect(onOpenNetworkSettings).toHaveBeenCalledOnce();
        expect(trigger.closest('[data-open]')).toHaveAttribute('data-open', 'false');
        expect(trigger).toHaveFocus();
    });
});
