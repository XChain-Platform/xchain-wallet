// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { createSignThrottle } from '../../../packages/core/src/flows/signThrottle.js';
import { selectOption } from '../../helpers/selectOption.js';

let messaging;
let settings;
let update;

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging }),
}));

const { SignThrottlePanel } = await import(
    '../../../packages/core/src/shared/components/settings/SignThrottlePanel.jsx'
);
const { en } = await import('../../../packages/core/src/i18n/locales/en/index.js');

const STATUS = {
    burst: 5,
    windowMs: 60000,
    sites: [
        { origin: 'https://dex.xchain.io', used: 5, waitMs: 38000 },
        { origin: 'https://bets.xchain.io', used: 3, waitMs: 0 },
    ],
};

beforeEach(() => {
    settings = createDefaultSettings();
    update = vi.fn(async () => settings);
    messaging = { getSignThrottleStatus: vi.fn(async () => STATUS) };
});

afterEach(() => cleanup());

describe('SignThrottlePanel (Options view)', () => {
    it('renders the status card, the two limit rows and the sites using it', async () => {
        render(<SignThrottlePanel />);

        expect(await screen.findByText('5 sign requests per site per minute')).toBeTruthy();
        expect(screen.getByText('In effect now')).toBeTruthy();
        expect(screen.getByText(/https:\/\/dex\.xchain\.io reached the limit and can ask again in 38 s\./)).toBeTruthy();
        expect(screen.getByText('Limits')).toBeTruthy();
        expect(screen.getByTestId('throttle-select-burst')).toHaveTextContent('5');
        expect(screen.getByTestId('throttle-select-windowMs')).toHaveTextContent('1 min');
        expect(screen.getAllByRole('button', { name: /^About / })).toHaveLength(2);
        expect(screen.getByText('Sites using it now')).toBeTruthy();
        expect(screen.getByText('Limit reached, next request in 38 s')).toBeTruthy();
        expect(screen.getByText('3 of 5 used in the last 60 s')).toBeTruthy();
        // Applies at once: no Save or Apply button.
        expect(screen.queryByRole('button', { name: /apply|save/i })).toBeNull();
    });

    it('says the window is a rolling count, never that it resets', () => {
        const text = en['settings.connectedSites.windowSecondsHelp'];
        expect(text).toMatch(/last stretch/);
        expect(text).not.toMatch(/reset/i);
        expect(en['settings.connectedSites.burstHelp']).not.toMatch(/reset/i);
    });

    it('shows the limit and "No sites are waiting" where the shell has no throttle', async () => {
        messaging = {};
        render(<SignThrottlePanel />);

        expect(await screen.findByText('5 sign requests per site per minute')).toBeTruthy();
        expect(screen.getByText('No sites are waiting.')).toBeTruthy();
        expect(screen.getByTestId('throttle-no-sites')).toBeTruthy();
    });

    it('applies a preset at once and writes both fields, as Apply did', async () => {
        settings = { ...createDefaultSettings(), signThrottle: { burst: 20, windowMs: 120000 } };
        render(<SignThrottlePanel />);

        selectOption(screen.getByTestId('throttle-select-burst'), '10');
        await waitFor(() => expect(update).toHaveBeenCalledWith({
            signThrottle: { burst: 10, windowMs: 120000 },
        }));

        selectOption(screen.getByTestId('throttle-select-windowMs'), '300000');
        await waitFor(() => expect(update).toHaveBeenLastCalledWith({
            signThrottle: { burst: 20, windowMs: 300000 },
        }));
    });

    it('opens a Custom field in place and checks the grouped 1 to 1,000 and 1 s to 24 h bounds', async () => {
        render(<SignThrottlePanel />);

        selectOption(screen.getByTestId('throttle-select-burst'), 'custom');
        const field = await screen.findByTestId('throttle-custom-burst');
        fireEvent.change(field, { target: { value: '1001' } });
        fireEvent.blur(field);
        expect(await screen.findByText('Enter a whole number from 1 to 1,000.')).toBeTruthy();
        expect(update).not.toHaveBeenCalled();
        fireEvent.change(field, { target: { value: '250' } });
        fireEvent.blur(field);
        await waitFor(() => expect(update).toHaveBeenCalledWith({
            signThrottle: { burst: 250, windowMs: 60000 },
        }));

        selectOption(screen.getByTestId('throttle-select-windowMs'), 'custom');
        const win = await screen.findByTestId('throttle-custom-windowMs');
        fireEvent.change(win, { target: { value: '86401' } });
        fireEvent.blur(win);
        expect(await screen.findByText(/Enter from 1 to 86,400 seconds/)).toBeTruthy();
        fireEvent.change(win, { target: { value: '0.5' } });
        fireEvent.blur(win);
        expect(await screen.findByText(/Enter from 1 to 86,400 seconds/)).toBeTruthy();
        fireEvent.change(win, { target: { value: '90' } });
        fireEvent.blur(win);
        await waitFor(() => expect(update).toHaveBeenLastCalledWith({
            signThrottle: { burst: 5, windowMs: 90000 },
        }));
    });

    it('groups displayed request counts without changing the stored values', async () => {
        settings = { ...createDefaultSettings(), signThrottle: { burst: 1000, windowMs: 60000 } };
        messaging = {
            getSignThrottleStatus: vi.fn(async () => ({
                burst: 1000,
                windowMs: 60000,
                sites: [{ origin: 'https://busy.example', used: 1000, waitMs: 0 }],
            })),
        };
        render(<SignThrottlePanel />);

        expect(await screen.findByText('1,000 sign requests per site per minute')).toBeTruthy();
        expect(screen.getByText('1,000 of 1,000 used in the last 60 s')).toBeTruthy();
        expect(screen.getByTestId('throttle-custom-burst')).toHaveValue('1000');
    });

    it('reports a refused save under the row', async () => {
        update = vi.fn(async () => { throw new Error('refused'); });
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        render(<SignThrottlePanel />);

        selectOption(screen.getByTestId('throttle-select-burst'), '10');
        expect(await screen.findByText('Saving the limit failed. Try again.')).toBeTruthy();
        spy.mockRestore();
    });

    it('reads the host once for any number of sites', async () => {
        for (const count of [2, 40]) {
            cleanup();
            const sites = Array.from({ length: count }, (_, i) => ({
                origin: `https://site${i}.example`, used: 1, waitMs: 0,
            }));
            const read = vi.fn(async () => ({ burst: 5, windowMs: 60000, sites }));
            messaging = { getSignThrottleStatus: read };
            render(<SignThrottlePanel />);
            await waitFor(() => expect(screen.getAllByTestId('throttle-site')).toHaveLength(count));
            expect(read).toHaveBeenCalledTimes(1);
        }
    });
});

describe('sign throttle host read', () => {
    it('status() returns the limits and every site in one pass without mutating', () => {
        let clock = 1_000_000;
        const persist = vi.fn();
        const throttle = createSignThrottle({
            getLimits: () => ({ burst: 2, windowMs: 60000 }),
            now: () => clock,
            onPersist: persist,
        });
        throttle.check('https://a.example');
        clock += 1000;
        throttle.check('https://a.example');
        throttle.check('https://b.example');
        persist.mockClear();

        const status = throttle.status();
        expect(status.burst).toBe(2);
        expect(status.windowMs).toBe(60000);
        expect(status.sites).toEqual([
            { origin: 'https://a.example', used: 2, waitMs: 59000 },
            { origin: 'https://b.example', used: 1, waitMs: 0 },
        ]);
        expect(persist).not.toHaveBeenCalled();
        expect(throttle.snapshot().buckets['https://a.example']).toHaveLength(2);

        clock += 61000;
        expect(throttle.status().sites).toEqual([]);
    });

    it('reads the limits once however many sites it holds', () => {
        for (const count of [3, 300]) {
            const buckets = {};
            for (let i = 0; i < count; i += 1) buckets[`https://s${i}.example`] = [Date.now()];
            const getLimits = vi.fn(() => ({ burst: 5, windowMs: 60000 }));
            const throttle = createSignThrottle({ initialState: { buckets }, getLimits });
            getLimits.mockClear();
            expect(throttle.status().sites).toHaveLength(count);
            expect(getLimits).toHaveBeenCalledTimes(1);
        }
    });
});
