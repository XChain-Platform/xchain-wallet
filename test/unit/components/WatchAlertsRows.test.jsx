// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings;
const update = vi.fn();
const getNativePlugin = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/nativeShell.js', () => ({ getNativePlugin }));

const { WatchAlertsRows } = await import(
    '../../../packages/core/src/shared/components/settings/WatchAlertsRows.jsx'
);

beforeEach(() => {
    settings = createDefaultSettings();
    update.mockReset();
    update.mockResolvedValue(undefined);
    getNativePlugin.mockReset();
});

afterEach(() => cleanup());

describe('WatchAlertsRows', () => {
    it('shows the setting help and writes an on-off change', () => {
        render(<WatchAlertsRows runTimes={[]} />);

        const control = screen.getByRole('switch', { name: 'Background activity check' });
        expect(control).toBeChecked();
        const help = screen.getByRole('button', { name: 'About Background activity check' });
        fireEvent.click(help);
        expect(within(help.parentElement).getByRole('tooltip')).toHaveTextContent(
            "Checks this wallet's public addresses a few times a day",
        );

        fireEvent.click(control);
        expect(update).toHaveBeenCalledWith({ watch: { backgroundActivityCheck: false } });
    });

    it('stays off under Tor, keeps the switch enabled for taps, and reveals the lock note', () => {
        settings = {
            ...settings,
            watch: { ...settings.watch, backgroundActivityCheck: true },
            privacy: { ...settings.privacy, torRouting: true },
        };
        render(<WatchAlertsRows runTimes={[]} />);

        const control = screen.getByRole('switch', { name: 'Background activity check' });
        expect(control).not.toBeChecked();
        expect(control).not.toBeDisabled();
        expect(control).toHaveAttribute('aria-disabled', 'true');
        expect(screen.queryByText('Not available while Tor routing is on.')).toBeNull();

        fireEvent.click(control);
        expect(screen.getByText('Not available while Tor routing is on.')).toBeTruthy();
        expect(update).not.toHaveBeenCalled();
        expect(control).not.toBeChecked();
    });

    it('shows the newest native run times and their limited count', () => {
        const runTimes = Array.from({ length: 21 }, (_, index) => Date.UTC(2026, 0, 1, 0, index));
        render(<WatchAlertsRows runTimes={runTimes} />);

        const runs = screen.getByRole('region', { name: 'Last runs (20)' });
        const times = within(runs).getAllByRole('time');
        expect(times).toHaveLength(20);
        expect(times.map((node) => node.getAttribute('datetime'))).toEqual(
            runTimes.slice(1).reverse().map((time) => new Date(time).toISOString()),
        );
    });

    it('reads the run log from the native activity plugin', async () => {
        const time = Date.UTC(2026, 0, 1);
        getNativePlugin.mockReturnValue({ runLog: vi.fn().mockResolvedValue({ times: [time] }) });

        render(<WatchAlertsRows />);

        await waitFor(() => expect(screen.getByRole('region', { name: 'Last runs (1)' })).toBeTruthy());
        expect(getNativePlugin).toHaveBeenCalledWith('XChainActivity', { method: 'runLog' });
        expect(screen.getByRole('time')).toHaveAttribute('datetime', new Date(time).toISOString());
    });

    it('shows an empty run count', () => {
        render(<WatchAlertsRows runTimes={[]} />);

        expect(screen.getByRole('region', { name: 'Last runs (0)' })).toHaveTextContent(
            'No background checks have run yet.',
        );
    });
});
