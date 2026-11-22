// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Forgot Password on the lock screen (operator ruling 2026-11-16): reset with a
// recovery phrase (nothing erased), restore from a backup file only after it
// is checked, or erase everything after a 48-hour hold that any unlock cancels.

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const wipeWalletStorage = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/utils/wipeWalletStorage.js', () => ({
    wipeWalletStorage,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { FORGOT_PASSWORD_RESTORE_LANE_KEY } from '../../../packages/core/src/shared/utils/forgotPasswordRecovery.js';
import { POST_DEMO_INTENT_KEY } from '../../../packages/core/src/shared/utils/demoGraduation.js';
import { clearDemoWalletId, clearLockoutState, markDemoWallet } from '../../../packages/core/src/flows/index.js';
import {
    ERASE_HOLD_MS,
    ERASE_SCHEDULE_STORAGE_KEY,
    __resetEraseScheduleForTests,
    getEraseSchedule,
    scheduleErase,
} from '../../../packages/core/src/flows/eraseSchedule.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';

let reload;

function named(name, extra = {}) {
    return Object.assign(new Error(name), { name, ...extra });
}

// A real vault: the demo password is refused, as every real wallet password
// is 8 characters or more. Each other password in `refused` is wrong too.
function realVaultUnlock(...refused) {
    return vi.fn(async (password) => {
        if (password === 'demo' || refused.includes(password)) throw named('InvalidPasswordError');
        return { unlocked: true, passphraseCaptureNeeded: [] };
    });
}

function baseMessaging(overrides = {}) {
    return {
        unlockWallet: realVaultUnlock(),
        recoveryStatus: vi.fn().mockResolvedValue({ hasWallet: true, phraseReset: true }),
        resetPasswordWithPhrase: vi.fn().mockResolvedValue({ unlocked: true, passphraseCaptureNeeded: [], passwordReset: true, skippedWalletIds: [] }),
        verifyBackupForRestore: vi.fn().mockResolvedValue({ verified: true, walletName: 'Savings', belongsToVault: true }),
        ...overrides,
    };
}

function mount(messaging = baseMessaging(), onUnlocked = vi.fn()) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Locked onUnlocked={onUnlocked} />
        </MessagingProvider>,
    );
    return { messaging, onUnlocked };
}

async function openForgot() {
    fireEvent.click(screen.getByRole('button', { name: 'Forgot Password?' }));
    return screen.findByRole('list', { name: 'Ways back into your wallet' });
}

function rowTitles(list) {
    return within(list).getAllByRole('button').map((b) => b.textContent);
}

function pressBack() {
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
}

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
    __resetEraseScheduleForTests();
    globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
    globalThis.localStorage.removeItem(FORGOT_PASSWORD_RESTORE_LANE_KEY);
    globalThis.localStorage.removeItem(POST_DEMO_INTENT_KEY);
    wipeWalletStorage.mockReset();
    wipeWalletStorage.mockResolvedValue(undefined);
    reload = vi.fn();
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { reload } });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    resetBackStackForTests();
    clearLockoutState();
    __resetEraseScheduleForTests();
    globalThis.localStorage.removeItem(ERASE_SCHEDULE_STORAGE_KEY);
    globalThis.localStorage.removeItem(FORGOT_PASSWORD_RESTORE_LANE_KEY);
    globalThis.localStorage.removeItem(POST_DEMO_INTENT_KEY);
    delete globalThis.location;
});

describe('Forgot Password choices', () => {
    it('lists phrase reset, backup restore, then erase, in that order, without erasing', async () => {
        mount();
        const list = await openForgot();
        const titles = rowTitles(list);
        expect(titles[0]).toMatch(/^Reset with Recovery Phrase/);
        expect(titles[1]).toMatch(/^Restore from Backup File/);
        expect(titles[2]).toMatch(/^Erase Everything/);
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('a hardware-only vault (no phrase wrap) sees only backup restore and erase', async () => {
        mount(baseMessaging({ recoveryStatus: vi.fn().mockResolvedValue({ hasWallet: true, phraseReset: false }) }));
        const list = await openForgot();
        const titles = rowTitles(list);
        expect(titles).toHaveLength(2);
        expect(titles[0]).toMatch(/^Restore from Backup File/);
        expect(titles[1]).toMatch(/^Erase Everything/);
    });

    it('Back returns to the choices, then to the lock screen', async () => {
        mount();
        const list = await openForgot();
        fireEvent.click(within(list).getByRole('button', { name: /^Erase Everything/ }));
        expect(screen.getByLabelText('Type WIPE to confirm')).toBeInTheDocument();
        pressBack();
        expect(await screen.findByRole('list', { name: 'Ways back into your wallet' })).toBeInTheDocument();
        pressBack();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });
});

describe('Reset with Recovery Phrase', () => {
    async function openPhrase(messaging) {
        const env = mount(messaging);
        const list = await openForgot();
        fireEvent.click(within(list).getByRole('button', { name: /^Reset with Recovery Phrase/ }));
        return env;
    }

    function fill({ phrase = 'legal winner thank year wave sausage worth useful legal winner thank yellow', password = 'brand-new-password', confirm = password } = {}) {
        fireEvent.change(screen.getByLabelText('Recovery Phrase'), { target: { value: phrase } });
        fireEvent.change(screen.getByLabelText('New Password'), { target: { value: password } });
        fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: confirm } });
    }

    it('names each missing field at the top and on the field, sending nothing', async () => {
        const { messaging } = await openPhrase();
        const submit = screen.getByRole('button', { name: 'Reset Password' });
        expect(submit.className).toMatch(/success/);
        fireEvent.click(submit);
        expect(messaging.resetPasswordWithPhrase).not.toHaveBeenCalled();
        expect(screen.getAllByText('Enter the recovery phrase.').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Use at least 8 characters.').length).toBeGreaterThan(0);
        expect(screen.getByLabelText('Recovery Phrase')).toHaveAttribute('aria-invalid', 'true');
    });

    it('refuses mismatched passwords before sending', async () => {
        const { messaging } = await openPhrase();
        fill({ confirm: 'something-else' });
        fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
        expect(messaging.resetPasswordWithPhrase).not.toHaveBeenCalled();
        expect(screen.getAllByText("The two passwords don't match.").length).toBeGreaterThan(0);
    });

    it('a wrong phrase changes nothing and marks the phrase field with the error at the top', async () => {
        const messaging = baseMessaging({
            resetPasswordWithPhrase: vi.fn().mockRejectedValue(named('RecoveryPhraseMismatchError')),
        });
        const onUnlocked = vi.fn();
        mount(messaging, onUnlocked);
        const list = await openForgot();
        fireEvent.click(within(list).getByRole('button', { name: /^Reset with Recovery Phrase/ }));
        fill();
        fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
        const message = "That recovery phrase doesn't match any wallet on this device. Check each word and try again.";
        await waitFor(() => expect(screen.getAllByText(message).length).toBeGreaterThan(0));
        expect(screen.getByLabelText('Recovery Phrase')).toHaveAttribute('aria-invalid', 'true');
        expect(onUnlocked).not.toHaveBeenCalled();
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('resets, unlocks, tells the user, and opens the app on Continue', async () => {
        const messaging = baseMessaging();
        const onUnlocked = vi.fn();
        mount(messaging, onUnlocked);
        const list = await openForgot();
        fireEvent.click(within(list).getByRole('button', { name: /^Reset with Recovery Phrase/ }));
        fill();
        fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
        await waitFor(() => expect(messaging.resetPasswordWithPhrase).toHaveBeenCalledWith({
            phrase: 'legal winner thank year wave sausage worth useful legal winner thank yellow',
            newPassword: 'brand-new-password',
        }));
        expect(await screen.findByText(/Your password was reset and every wallet is unlocked/)).toBeInTheDocument();
        expect(onUnlocked).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(onUnlocked).toHaveBeenCalledOnce();
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('says how many wallets kept a separate password', async () => {
        const messaging = baseMessaging({
            resetPasswordWithPhrase: vi.fn().mockResolvedValue({ unlocked: true, passphraseCaptureNeeded: [], skippedWalletIds: ['w9'] }),
        });
        mount(messaging);
        const list = await openForgot();
        fireEvent.click(within(list).getByRole('button', { name: /^Reset with Recovery Phrase/ }));
        fill();
        fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));
        expect(await screen.findByText(/1 wallet uses a different password and kept it/)).toBeInTheDocument();
    });
});

describe('Restore from Backup File', () => {
    async function openBackup(messaging) {
        const env = mount(messaging);
        const list = await openForgot();
        fireEvent.click(within(list).getByRole('button', { name: /^Restore from Backup File/ }));
        return env;
    }

    async function chooseFile(content = '{"magic":"XCHAIN-WALLET-BACKUP"}') {
        const input = screen.getByLabelText('Choose Backup File');
        fireEvent.change(input, { target: { files: [new File([content], 'savings.xchain-wallet', { type: 'application/json' })] } });
        await screen.findByDisplayValue('savings.xchain-wallet');
    }

    it('a wrong file password erases nothing', async () => {
        const messaging = baseMessaging({ verifyBackupForRestore: vi.fn().mockRejectedValue(named('BackupPasswordError')) });
        await openBackup(messaging);
        await chooseFile();
        fireEvent.change(screen.getByLabelText('Backup File Password'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
        await waitFor(() => expect(screen.getAllByText("That isn't this backup file's password.").length).toBeGreaterThan(0));
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        expect(getEraseSchedule()).toBeNull();
        expect(reload).not.toHaveBeenCalled();
        expect(screen.queryByRole('button', { name: 'Erase and Restore' })).toBeNull();
    });

    it('a file that is not a backup erases nothing', async () => {
        const messaging = baseMessaging({ verifyBackupForRestore: vi.fn().mockRejectedValue(named('BackupFormatError')) });
        await openBackup(messaging);
        await chooseFile('not a backup');
        fireEvent.change(screen.getByLabelText('Backup File Password'), { target: { value: 'pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
        await waitFor(() => expect(screen.getAllByText("That file isn't a wallet backup.").length).toBeGreaterThan(0));
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('asks for the wallet password when the wallet inside has its own, then sends it', async () => {
        const verify = vi.fn()
            .mockRejectedValueOnce(named('BackupSeedPasswordError'))
            .mockResolvedValueOnce({ verified: true, walletName: 'Savings', belongsToVault: true });
        await openBackup(baseMessaging({ verifyBackupForRestore: verify }));
        await chooseFile();
        fireEvent.change(screen.getByLabelText('Backup File Password'), { target: { value: 'file-pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
        const walletField = await screen.findByLabelText('Wallet Password');
        fireEvent.change(walletField, { target: { value: 'wallet-pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
        await screen.findByText('The file and its password open Savings.');
        expect(verify).toHaveBeenLastCalledWith(expect.objectContaining({ password: 'file-pw', walletPassword: 'wallet-pw' }));
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('a matching backup erases only after the check passes and WIPE is typed, then opens restore', async () => {
        const messaging = baseMessaging();
        await openBackup(messaging);
        fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
        expect(messaging.verifyBackupForRestore).not.toHaveBeenCalled();
        expect(screen.getAllByText('Choose the backup file to check.').length).toBeGreaterThan(0);

        await chooseFile();
        fireEvent.change(screen.getByLabelText('Backup File Password'), { target: { value: 'file-pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
        await screen.findByText('Backup File Checked');
        expect(messaging.verifyBackupForRestore).toHaveBeenCalledWith({
            fileContent: '{"magic":"XCHAIN-WALLET-BACKUP"}',
            password: 'file-pw',
        });
        expect(wipeWalletStorage).not.toHaveBeenCalled();

        const erase = screen.getByRole('button', { name: 'Erase and Restore' });
        fireEvent.click(erase);
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPEX' } });
        fireEvent.click(erase);
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        fireEvent.click(erase);
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(wipeWalletStorage).toHaveBeenCalledTimes(1);
        expect(globalThis.localStorage.getItem(FORGOT_PASSWORD_RESTORE_LANE_KEY)).toBe('backup');
    });

    it('a valid backup from another wallet schedules the 48-hour hold and never erases immediately', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
        const messaging = baseMessaging({
            verifyBackupForRestore: vi.fn().mockResolvedValue({
                verified: true,
                walletName: 'Other Wallet',
                belongsToVault: false,
            }),
        });
        await openBackup(messaging);
        await chooseFile();
        fireEvent.change(screen.getByLabelText('Backup File Password'), { target: { value: 'file-pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));

        expect(await screen.findByText('This backup is from a different wallet. Erasing this device waits 48 hours.'))
            .toBeInTheDocument();
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        expect(getEraseSchedule()).toBeNull();

        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        fireEvent.click(screen.getByRole('button', { name: 'Schedule Erase' }));
        await screen.findByText('Erase Scheduled');
        expect(getEraseSchedule().dueAt - getEraseSchedule().scheduledAt).toBe(ERASE_HOLD_MS);
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();
        expect(globalThis.localStorage.getItem(FORGOT_PASSWORD_RESTORE_LANE_KEY)).toBeNull();
    });
});

describe('Erase Everything with a 48-hour hold', () => {
    async function scheduleFromPage() {
        const list = await openForgot();
        fireEvent.click(within(list).getByRole('button', { name: /^Erase Everything/ }));
        const submit = screen.getByRole('button', { name: 'Schedule Erase' });
        fireEvent.click(submit);
        expect(getEraseSchedule()).toBeNull();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WİPE' } });
        fireEvent.click(submit);
        expect(getEraseSchedule()).toBeNull();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        fireEvent.click(submit);
        await screen.findByText('Erase Scheduled');
    }

    it('typing WIPE schedules, never wipes, and the lock screen shows the time left', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
        const { messaging } = mount();
        await scheduleFromPage();
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        // One demo-password check, refused, before the hold was scheduled.
        expect(messaging.unlockWallet).toHaveBeenCalledTimes(1);
        expect(messaging.unlockWallet).toHaveBeenCalledWith('demo');
        const schedule = getEraseSchedule();
        expect(schedule.dueAt - schedule.scheduledAt).toBe(ERASE_HOLD_MS);
        expect(screen.getByText(/erased in 48 hours/)).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('a successful unlock cancels the erase and tells the user', async () => {
        const { messaging, onUnlocked } = mount();
        await scheduleFromPage();
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        expect(await screen.findByText('Erase Cancelled')).toBeInTheDocument();
        expect(messaging.unlockWallet).toHaveBeenCalledWith('secret');
        expect(getEraseSchedule()).toBeNull();
        expect(onUnlocked).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
        expect(onUnlocked).toHaveBeenCalledOnce();
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('Cancel Erase asks for the password through the unlock form; a wrong one keeps the erase', async () => {
        mount(baseMessaging({ unlockWallet: realVaultUnlock('wrong') }));
        await scheduleFromPage();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel Erase' }));
        const submit = screen.getByRole('button', { name: 'Cancel Erase and Unlock' });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
        fireEvent.click(submit);
        expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
        expect(getEraseSchedule()).not.toBeNull();
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'right' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel Erase and Unlock' }));
        expect(await screen.findByText('Erase Cancelled')).toBeInTheDocument();
        expect(getEraseSchedule()).toBeNull();
    });

    it('before the due time an app start keeps the wallet; after it, the start erases and offers restore', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
        await scheduleErase();

        vi.setSystemTime(new Date(Date.now() + ERASE_HOLD_MS - 60_000));
        mount();
        expect(screen.getByText(/erased in 1 minute/)).toBeInTheDocument();
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        cleanup();

        vi.setSystemTime(new Date(Date.now() + 60_000));
        mount();
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(wipeWalletStorage).toHaveBeenCalledTimes(1);
        expect(globalThis.localStorage.getItem(POST_DEMO_INTENT_KEY)).toBe('import');
    });

    it('the demo wallet keeps its immediate Exit Demo & Wipe and offers no Forgot Password', () => {
        markDemoWallet('demo-1');
        mount();
        expect(screen.getByRole('button', { name: 'Exit Demo & Wipe' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Forgot Password?' })).toBeNull();
    });
});

describe('a demo vault whose marker was lost', () => {
    // The vault opens with the demo password; no xc:demoWallet* keys remain,
    // so the lock screen shows Forgot Password instead of Exit Demo.
    function demoVaultMessaging(overrides = {}) {
        return baseMessaging({
            unlockWallet: vi.fn(async (password) => {
                if (password !== 'demo') throw named('InvalidPasswordError');
                return { unlocked: true, passphraseCaptureNeeded: [] };
            }),
            lockWallet: vi.fn().mockResolvedValue({ locked: true }),
            ...overrides,
        });
    }

    async function submitEraseEverything() {
        const list = await openForgot();
        fireEvent.click(within(list).getByRole('button', { name: /^Erase Everything/ }));
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        fireEvent.click(screen.getByRole('button', { name: 'Schedule Erase' }));
    }

    it('Erase Everything erases at once, skipping the 48-hour hold', async () => {
        const { messaging } = mount(demoVaultMessaging());
        await submitEraseEverything();
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(messaging.unlockWallet).toHaveBeenCalledTimes(1);
        expect(messaging.unlockWallet).toHaveBeenCalledWith('demo');
        expect(wipeWalletStorage).toHaveBeenCalledTimes(1);
        expect(getEraseSchedule()).toBeNull();
    });

    it('a backup from another wallet erases at once and opens the backup restore', async () => {
        const messaging = demoVaultMessaging({
            verifyBackupForRestore: vi.fn().mockResolvedValue({ verified: true, walletName: 'Other', belongsToVault: false }),
        });
        mount(messaging);
        const list = await openForgot();
        fireEvent.click(within(list).getByRole('button', { name: /^Restore from Backup File/ }));
        const input = screen.getByLabelText('Choose Backup File');
        fireEvent.change(input, { target: { files: [new File(['{}'], 'other.xchain-wallet', { type: 'application/json' })] } });
        await screen.findByDisplayValue('other.xchain-wallet');
        fireEvent.change(screen.getByLabelText('Backup File Password'), { target: { value: 'file-pw' } });
        fireEvent.click(screen.getByRole('button', { name: 'Check Backup File' }));
        await screen.findByText('Backup File Checked');
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        fireEvent.click(screen.getByRole('button', { name: 'Schedule Erase' }));
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(wipeWalletStorage).toHaveBeenCalledTimes(1);
        expect(getEraseSchedule()).toBeNull();
        expect(globalThis.localStorage.getItem(FORGOT_PASSWORD_RESTORE_LANE_KEY)).toBe('backup');
    });

    it('a failed wipe locks the vault again, says so, and schedules nothing', async () => {
        wipeWalletStorage.mockRejectedValue(new Error('host storage is busy'));
        const { messaging } = mount(demoVaultMessaging());
        await submitEraseEverything();
        await waitFor(() => expect(screen.getAllByText("Couldn't erase wallet data. Close and reopen the app, then try again.").length)
            .toBeGreaterThan(0));
        expect(messaging.lockWallet).toHaveBeenCalledTimes(1);
        expect(getEraseSchedule()).toBeNull();
        expect(reload).not.toHaveBeenCalled();
    });

    it('typing demo on the lock screen opens it', async () => {
        const { messaging, onUnlocked } = mount(demoVaultMessaging());
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'demo' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
        await waitFor(() => expect(onUnlocked).toHaveBeenCalledTimes(1));
        expect(messaging.unlockWallet).toHaveBeenCalledWith('demo');
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });
});
