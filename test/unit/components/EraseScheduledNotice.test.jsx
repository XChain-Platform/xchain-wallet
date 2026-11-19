// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// Security review of the Forgot Password recovery, 2026-11-16: on web a
// second tab can schedule the erase from its lock screen while the owner is
// unlocked in another. The unlocked app shows that erase at the top and
// cancels it.

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import {
    ERASE_HOLD_MS,
    ERASE_SCHEDULE_STORAGE_KEY,
    __resetEraseScheduleForTests,
    configureEraseSchedulePersistence,
    getEraseSchedule,
    scheduleErase,
} from '../../../packages/core/src/flows/eraseSchedule.js';
import { EraseScheduledNotice } from '../../../packages/core/src/shared/components/EraseScheduledNotice.jsx';

const TITLE = 'An erase of this wallet was scheduled from the lock screen';

beforeEach(() => {
    __resetEraseScheduleForTests();
    globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
    globalThis.localStorage.removeItem('xchain-wallet:erase-cancelled');
});

afterEach(async () => {
    cleanup();
    await configureEraseSchedulePersistence(null);
    __resetEraseScheduleForTests();
    globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
    globalThis.localStorage.removeItem('xchain-wallet:erase-cancelled');
});

describe('EraseScheduledNotice', () => {
    it('shows nothing while no erase is scheduled', () => {
        const { container } = render(<EraseScheduledNotice />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows a scheduled erase with one Cancel Erase action, and cancelling it removes it', async () => {
        await scheduleErase();
        render(<EraseScheduledNotice />);
        expect(screen.getByText(TITLE)).toBeInTheDocument();
        expect(screen.getByText(/erased in 48 hours/)).toBeInTheDocument();
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Cancel Erase' }));
        });
        expect(getEraseSchedule()).toBeNull();
        expect(screen.queryByText(TITLE)).toBeNull();
    });

    it('appears when another tab schedules the erase', async () => {
        render(<EraseScheduledNotice />);
        expect(screen.queryByText(TITLE)).toBeNull();
        const now = Date.now();
        const value = JSON.stringify({ scheduledAt: now, dueAt: now + ERASE_HOLD_MS });
        globalThis.localStorage.setItem(ERASE_SCHEDULE_STORAGE_KEY, value);
        await act(async () => {
            window.dispatchEvent(new StorageEvent('storage', { key: ERASE_SCHEDULE_STORAGE_KEY, newValue: value }));
        });
        expect(screen.getByText(TITLE)).toBeInTheDocument();
    });

    it('a cancel the store refuses says so and keeps the notice', async () => {
        let slot = null;
        await configureEraseSchedulePersistence({
            load: async () => slot,
            save: async (s) => { slot = s; },
            clear: async () => { throw new Error('keystore is locked'); },
        });
        await scheduleErase();
        render(<EraseScheduledNotice />);
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Cancel Erase' }));
        });
        expect(screen.getAllByRole('alert').some((el) => /couldn't cancel/i.test(el.textContent))).toBe(true);
        expect(screen.getByText(TITLE)).toBeInTheDocument();
    });

    it('is mounted at the top of the unlocked app in every shell', () => {
        const repo = process.cwd();
        for (const app of [
            ['packages', 'web', 'src', 'App.jsx'],
            ['packages', 'extension', 'src', 'popup', 'App.jsx'],
            ['packages', 'desktop', 'renderer', 'App.jsx'],
        ]) {
            const source = readFileSync(join(repo, ...app), 'utf8');
            expect(source, app.join('/')).toMatch(/<EraseScheduledNotice\b/);
        }
    });
});
