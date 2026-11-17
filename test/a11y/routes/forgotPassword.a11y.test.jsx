// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The lock screen's Forgot Password pages under axe (operator ruling
// 2026-11-16): the choices, Reset with Recovery Phrase with its error summary,
// Restore from Backup File before and after the check, Erase Everything, and
// the lock screen with an erase scheduled.

import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { clearLockoutState } from '../../../packages/core/src/flows/index.js';
import {
    ERASE_SCHEDULE_STORAGE_KEY,
    __resetEraseScheduleForTests,
    scheduleErase,
} from '../../../packages/core/src/flows/eraseSchedule.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

function messaging() {
    return {
        unlockWallet: vi.fn(),
        recoveryStatus: vi.fn().mockResolvedValue({ hasWallet: true, phraseReset: true }),
        resetPasswordWithPhrase: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'RecoveryPhraseMismatchError' })),
        verifyBackupForRestore: vi.fn().mockResolvedValue({ verified: true, walletName: 'Savings', belongsToVault: true }),
    };
}

function renderLocked() {
    return render(
        <MessagingProvider shell="web" messaging={messaging()}>
            <Locked onUnlocked={() => {}} />
        </MessagingProvider>,
    );
}

async function openRow(name) {
    fireEvent.click(screen.getByRole('button', { name: 'Forgot Password?' }));
    const list = await screen.findByRole('list', { name: 'Ways back into your wallet' });
    if (name) fireEvent.click(within(list).getByRole('button', { name: new RegExp(`^${name}`) }));
}

beforeEach(() => {
    clearLockoutState();
    __resetEraseScheduleForTests();
    globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
});

afterEach(() => {
    cleanup();
    __resetEraseScheduleForTests();
    globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
});

describe('Forgot Password accessibility', () => {
    it('has no serious violations on the choices', async () => {
        const { container } = renderLocked();
        await openRow(null);
        await expectNoSeriousAxeViolations(container);
    });

    it('has no serious violations on the phrase reset with its error summary', async () => {
        const { container } = renderLocked();
        await openRow('Reset with Recovery Phrase');
        fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
        await screen.findByRole('alert', { name: 'Form errors' });
        await expectNoSeriousAxeViolations(container);
    });

    it('has no serious violations on the backup restore before and after the check', async () => {
        const { container } = renderLocked();
        await openRow('Restore from Backup File');
        await expectNoSeriousAxeViolations(container);
        fireEvent.change(screen.getByLabelText('Choose Backup File'), {
            target: { files: [new File(['{}'], 'savings.xchain-wallet', { type: 'application/json' })] },
        });
        await screen.findByDisplayValue('savings.xchain-wallet');
        fireEvent.change(screen.getByLabelText('Backup File Password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
        await screen.findByText('Backup File Checked');
        await expectNoSeriousAxeViolations(container);
    });

    it('has no serious violations on Erase Everything and on the lock screen with an erase scheduled', async () => {
        const { container } = renderLocked();
        await openRow('Erase Everything');
        await expectNoSeriousAxeViolations(container);
        cleanup();
        await scheduleErase();
        const view = renderLocked();
        await screen.findByText('Erase Scheduled');
        await expectNoSeriousAxeViolations(view.container);
    });
});
