// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// Unit: Developer options > Logs and diagnostics console (operator walk
// 2026-11-15). Every filter (the Log, Info, Warn and Error toggles and the
// search) and the Copy all and Clear actions sit behind the title-bar filter
// button (G04); the body is only the explanatory note and the console list,
// whose messages are monospace one text step larger than before.

import React from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

let settings;

const mocks = vi.hoisted(() => ({ entries: [] }));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings, loading: false, error: null, update: vi.fn() }),
}));
vi.mock('../../../packages/core/src/shared/useMessaging.js', () => ({
    useMessaging: () => ({ messaging: {} }),
    screenVariantFor: () => 'full',
}));
vi.mock('../../../packages/core/src/shared/utils/logConsole.js', () => ({
    logConsole: {
        attach: vi.fn(),
        isAttached: vi.fn(() => true),
        entries: vi.fn(() => mocks.entries),
        subscribe: vi.fn(() => () => {}),
        clear: vi.fn(),
    },
}));

const { DeveloperLogsPage } = await import(
    '../../../packages/core/src/shared/components/settings/DeveloperModeSection.jsx'
);

const ENTRIES = [
    { id: 1, timestamp: 1, level: 'log', source: 'vault', message: 'plain line' },
    { id: 2, timestamp: 2, level: 'warn', source: 'encoder', message: 'careful line' },
    { id: 3, timestamp: 3, level: 'error', source: 'hub', message: 'broken thing' },
];

beforeEach(() => {
    settings = { ...createDefaultSettings(), developerMode: true };
    mocks.entries = ENTRIES;
});

afterEach(cleanup);

function titleBar() {
    return screen.getByRole('heading', { level: 1, name: 'Logs and Diagnostics Console' }).closest('div');
}

function body() {
    return document.querySelector('[data-developer-logs-body]');
}

function openFilter() {
    fireEvent.click(within(titleBar()).getByRole('button', { name: 'Filter' }));
    return screen.getByRole('dialog', { name: 'Filter' });
}

describe('Logs and diagnostics console page', () => {
    it('keeps every filter and action in the title-bar filter panel', () => {
        render(<DeveloperLogsPage onBack={() => {}} />);
        const panel = openFilter();
        expect(within(panel).getByRole('searchbox', { name: 'Search log messages' })).toBeTruthy();
        for (const name of ['Log', 'Info', 'Warn', 'Error']) {
            expect(within(panel).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
        }
        expect(within(panel).getByRole('button', { name: 'Copy all log entries' })).toBeTruthy();
        expect(within(panel).getByRole('button', { name: 'Clear log buffer' })).toBeTruthy();
    });

    it('shows only the explanatory note and the console list in the body', () => {
        render(<DeveloperLogsPage onBack={() => {}} />);
        const page = body();
        expect(page.children).toHaveLength(2);
        expect(page.children[0]).toHaveTextContent(/process-wide/i);
        expect(page.children[1].id).toBe('settings-log-console');
        expect(within(page).getByRole('log')).toBeTruthy();
        expect(within(page).queryAllByRole('button')).toHaveLength(0);
        expect(within(page).queryByRole('searchbox')).toBeNull();
    });

    it('filters by level and search from the panel, and lights the filter while narrowed', () => {
        render(<DeveloperLogsPage onBack={() => {}} />);
        const log = () => within(body()).getByRole('log');
        expect(log().children).toHaveLength(3);

        const panel = openFilter();
        fireEvent.click(within(panel).getByRole('button', { name: 'Log' }));
        expect(within(log()).queryByText('plain line')).toBeNull();
        expect(within(log()).getByText('careful line')).toBeTruthy();
        // A level off counts as a filter, so the button shows its dot.
        expect(titleBar().querySelector('[class*="filterBadge"]')).not.toBeNull();

        fireEvent.change(within(panel).getByRole('searchbox', { name: 'Search log messages' }), { target: { value: 'hub' } });
        expect(log().children).toHaveLength(1);
        expect(within(log()).getByText('broken thing')).toBeTruthy();

        fireEvent.change(within(panel).getByRole('searchbox', { name: 'Search log messages' }), { target: { value: '' } });
        fireEvent.click(within(panel).getByRole('button', { name: 'Log' }));
        expect(log().children).toHaveLength(3);
        expect(titleBar().querySelector('[class*="filterBadge"]')).toBeNull();
    });

    it('draws the console messages at the small text size, monospace', () => {
        render(<DeveloperLogsPage onBack={() => {}} />);
        const panel = within(body()).getByRole('log').parentElement;
        expect(panel.style.fontSize).toBe('var(--xc-text-sm)');
        expect(panel.style.fontFamily).toMatch(/--xc-font-mono/);
        // The old size was the extra-small token; the console no longer uses it for messages.
        const src = readFileSync('packages/core/src/shared/components/LogConsole.jsx', 'utf8');
        expect(src).toMatch(/fontSize: LOG_TEXT_SIZE/);
    });

    it('shows only the note and no filter while Developer mode is off', () => {
        settings = { ...settings, developerMode: false };
        render(<DeveloperLogsPage onBack={() => {}} />);
        expect(within(titleBar()).queryByRole('button', { name: 'Filter' })).toBeNull();
        expect(body()).toHaveTextContent(/Turn Developer Mode on to view/);
        expect(screen.queryByRole('log')).toBeNull();
    });

    it('draws its own screen, so Settings hands it Back', () => {
        const src = readFileSync('packages/core/src/shared/routes/Settings.jsx', 'utf8');
        expect(src).toMatch(/id: 'developer-logs',[\s\S]{0,200}?Component: DeveloperLogsPage,[\s\S]{0,120}?ownsScreen: true/);
    });
});
