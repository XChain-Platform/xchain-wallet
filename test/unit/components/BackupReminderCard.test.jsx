// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { markBackupVerified } from '../../../packages/core/src/flows/backupReminder.js';
import { BackupReminderCard } from '../../../packages/core/src/shared/components/BackupReminderCard.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const cardStyles = readFileSync(join(
    process.cwd(),
    'packages/core/src/shared/components/BackupReminderCard.module.css',
), 'utf8');

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
function mount(props = {}) {
    const messaging = {};
    const cardProps = { onAction: vi.fn(), hasFunds: true, ...props };
    const tree = (nextProps) => (
        <MessagingContext.Provider value={{ shell: 'web', messaging }}>
            <BackupReminderCard
                walletId="wallet-1"
                {...nextProps}
            />
        </MessagingContext.Provider>
    );
    const view = render(tree(cardProps));
    return {
        ...view,
        rerenderCard(nextProps) {
            view.rerender(tree({ ...cardProps, ...nextProps }));
        },
    };
}

beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    globalThis.localStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('BackupReminderCard', () => {
    it('stays out of the receive path until funds arrive', async () => {
        const { rerenderCard } = mount({ hasFunds: false });
        await waitFor(() => expect(screen.queryByRole('region')).toBeNull());

        rerenderCard({ hasFunds: true });
        expect(await screen.findByRole('region', { name: 'Back up your wallet' })).toBeTruthy();
    });

    it('shows accurate recovery options only for an unverified wallet', async () => {
        mount();

        const card = await screen.findByRole('region', { name: 'Back up your wallet' });
        expect(card).toHaveTextContent(/save your recovery phrase or export an encrypted backup/i);
        expect(screen.getByRole('button', { name: 'Back up now' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Remind me tomorrow' })).toBeEnabled();
    });

    it('uses the shared small control size for both actions', async () => {
        mount();

        const backup = await screen.findByRole('button', { name: 'Back up now' });
        const remind = screen.getByRole('button', { name: 'Remind me tomorrow' });
        expect(backup).toHaveClass(buttonStyles.btn, buttonStyles.sm);
        expect(remind).toHaveClass(buttonStyles.btn, buttonStyles.sm);
    });

    it.each([360, 844, 1280])('wraps whole action buttons inside the card at %ipx', async (viewportWidth) => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
        mount();

        const backup = await screen.findByRole('button', { name: 'Back up now' });
        const remind = screen.getByRole('button', { name: 'Remind me tomorrow' });
        expect(backup.parentElement).toBe(remind.parentElement);
        expect(cardStyles).toMatch(
            /\.actions\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/,
        );
    });

    it('runs the backup action and snoozes the gentle reminder for 24 hours', async () => {
        const onAction = vi.fn();
        const { unmount } = mount({ onAction });
        fireEvent.click(await screen.findByRole('button', { name: 'Back up now' }));
        expect(onAction).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: 'Remind me tomorrow' }));
        await waitFor(() => expect(screen.queryByRole('region')).toBeNull());

        unmount();
        mount({ onAction });
        await waitFor(() => expect(screen.queryByRole('region')).toBeNull());

        act(() => vi.advanceTimersByTime(24 * 60 * 60 * 1000));
        expect(await screen.findByRole('region', { name: 'Back up your wallet' })).toBeTruthy();
    });

    it('disappears immediately when the mounted wallet is verified', async () => {
        mount();
        await screen.findByRole('region', { name: 'Back up your wallet' });

        markBackupVerified('wallet-1', '2020-01-01T00:00:00.000Z');

        await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    });
});
