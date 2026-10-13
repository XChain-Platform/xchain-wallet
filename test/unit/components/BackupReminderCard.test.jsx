// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { markBackupVerified } from '../../../packages/core/src/flows/backupReminder.js';
import { BackupReminderCard } from '../../../packages/core/src/shared/components/BackupReminderCard.jsx';
import { MessagingContext } from '../../../packages/core/src/shared/MessagingContext.js';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');
const THREE_DAYS_AGO = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();

function mount(props = {}) {
    const messaging = {};
    const cardProps = { onAction: vi.fn(), ...props };
    const tree = (nextProps) => (
        <MessagingContext.Provider value={{ shell: 'web', messaging }}>
            <BackupReminderCard
                walletId="wallet-1"
                walletCreatedAt={THREE_DAYS_AGO}
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
    it('shows accurate recovery options only for an unverified wallet', async () => {
        mount();

        const card = await screen.findByRole('region', { name: 'Back up your wallet' });
        expect(card).toHaveTextContent(/save your recovery phrase or export an encrypted backup/i);
        expect(screen.getByRole('button', { name: 'Back up now' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Remind me tomorrow' })).toBeEnabled();
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
    });

    it('never renders after the wallet backup is verified', async () => {
        const { rerenderCard } = mount();
        await screen.findByRole('region', { name: 'Back up your wallet' });

        markBackupVerified('wallet-2', '2020-01-01T00:00:00.000Z');
        rerenderCard({ walletId: 'wallet-2' });

        await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    });
});
