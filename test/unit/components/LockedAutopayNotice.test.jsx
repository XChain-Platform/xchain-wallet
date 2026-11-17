// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// PC-16 Phase B: the Locked screen line "Auto pay is on for N orders, up to
// <cap>" with a Stop that needs no password, and no time left (operator ruling
// 2026-11-13: locked auto pay has no time limit). Hidden when the shell has no
// status call or nothing is running.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import {
    lockedAutopayText,
    useLockedAutopayNotice,
} from '../../../packages/core/src/shared/components/LockedAutopayNotice.jsx';

function Host({ messaging }) {
    const notice = useLockedAutopayNotice(messaging);
    return <div data-testid="host">{notice}</div>;
}

afterEach(() => cleanup());

describe('Locked screen auto pay line', () => {
    it('states the order count and cap, with no time left', () => {
        expect(lockedAutopayText({ active: true, orders: 2, caps: [{ chainId: 'bitcoin-regtest', ticker: 'BTC', amount: '0.045' }] }))
            .toBe('Auto pay is on for 2 orders, up to 0.045 BTC.');
        expect(lockedAutopayText({ active: true, orders: 1, caps: [{ ticker: 'BTC', amount: '0.05' }, { ticker: 'LTC', amount: '3' }] }))
            .toBe('Auto pay is on for 1 order, up to 0.05 BTC, 3 LTC.');
        expect(lockedAutopayText({ active: true, orders: 0, caps: [] }))
            .toBe('Auto pay is on. No armed order has anything left to pay.');
        expect(lockedAutopayText({ active: false })).toBeNull();
        expect(lockedAutopayText(null)).toBeNull();
    });

    it('renders the line with Stop, and Stop ends it without a password', async () => {
        let active = true;
        const messaging = {
            lockedAutopayStatus: vi.fn(async () => (active
                ? { active: true, orders: 1, caps: [{ ticker: 'BTC', amount: '0.05' }] }
                : { active: false })),
            stopLockedAutopay: vi.fn(async () => { active = false; return { active: false }; }),
        };
        render(<Host messaging={messaging} />);
        expect(await screen.findByText('Auto pay is on for 1 order, up to 0.05 BTC.')).toBeTruthy();
        expect(screen.queryByText(/hour|minute|left/i)).toBeNull();
        expect(screen.queryByRole('textbox')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Stop auto pay' }));
        await waitFor(() => expect(messaging.stopLockedAutopay).toHaveBeenCalledWith());
        await waitFor(() => expect(screen.queryByTestId('locked-autopay')).toBeNull());
    });

    it('renders nothing when the shell has no status call or nothing runs', async () => {
        const { unmount } = render(<Host messaging={{}} />);
        expect(screen.getByTestId('host').textContent).toBe('');
        unmount();
        const messaging = { lockedAutopayStatus: vi.fn(async () => ({ active: false })) };
        render(<Host messaging={messaging} />);
        await waitFor(() => expect(messaging.lockedAutopayStatus).toHaveBeenCalled());
        expect(screen.getByTestId('host').textContent).toBe('');
    });
});
