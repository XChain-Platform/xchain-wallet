// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WatchStatusRows } from '../../../packages/core/src/shared/components/settings/WatchStatusRows.jsx';

afterEach(cleanup);

const cases = [
    ['iOS not paired', 'ios', { paired: false, installed: false, reachable: false }, 'Pair a watch in the Apple Watch app'],
    ['iOS not installed', 'ios', { paired: true, installed: false, reachable: false }, 'Turn on XChain in the Apple Watch app'],
    ['Wear not installed', 'android', { paired: false, installed: false, reachable: false }, 'Install XChain from Google Play on your watch'],
    ['installed but unreachable', 'android', { paired: true, installed: true, reachable: false }, 'Bring your watch near'],
];

describe('WatchStatusRows', () => {
    it.each(cases)('shows the one next step for %s', async (_name, platform, status, hint) => {
        const bridge = { status: vi.fn(async () => status) };
        render(<WatchStatusRows bridge={bridge} platform={platform} />);

        expect(await screen.findByText(hint)).toBeTruthy();
        expect(bridge.status).toHaveBeenCalledOnce();
        for (const other of cases.map((entry) => entry[3]).filter((text) => text !== hint)) {
            expect(screen.queryByText(other)).toBeNull();
        }
    });

    it('reads status and sends the test and removal payloads through the bridge', async () => {
        const bridge = {
            status: vi.fn(async () => ({ paired: true, installed: true, reachable: true, lastSyncAt: Date.now() })),
            sendSnapshot: vi.fn(async () => true),
            removeWatchData: vi.fn(async () => true),
        };
        render(<WatchStatusRows bridge={bridge} platform="ios" />);
        await waitFor(() => expect(bridge.status).toHaveBeenCalledOnce());

        fireEvent.click(screen.getByRole('button', { name: 'Send Test Alert' }));
        await waitFor(() => expect(bridge.sendSnapshot).toHaveBeenCalledTimes(1));
        expect(bridge.sendSnapshot.mock.calls[0][0].inbox[0]).toMatchObject({
            title: 'Test alert', body: 'Your watch is getting alerts.', read: false,
        });

        fireEvent.click(screen.getByRole('button', { name: 'Remove Watch Data' }));
        await waitFor(() => expect(bridge.removeWatchData).toHaveBeenCalledOnce());
        expect(bridge.sendSnapshot.mock.calls[1][0]).toMatchObject({
            rows: [], inbox: [], settings: { enabled: false, showTotal: false },
        });
    });
});
