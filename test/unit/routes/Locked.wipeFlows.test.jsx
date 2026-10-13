// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const wipeWalletStorage = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/utils/wipeWalletStorage.js', () => ({
    wipeWalletStorage,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ImportWallet } from '../../../packages/core/src/shared/routes/ImportWallet.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { userEvent } from '../../helpers/userEvent.js';
import { FORGOT_PASSWORD_RESTORE_LANE_KEY } from '../../../packages/core/src/shared/utils/forgotPasswordRecovery.js';
import { POST_DEMO_INTENT_KEY, takePostDemoIntent } from '../../../packages/core/src/shared/utils/demoGraduation.js';
import {
    clearDemoWalletId,
    clearLockoutState,
    getDemoWalletId,
    markDemoWallet,
} from '../../../packages/core/src/flows/index.js';

let reload;

function mount({ messaging = { unlockWallet: vi.fn() }, onUnlocked = vi.fn() } = {}) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Locked onUnlocked={onUnlocked} />
        </MessagingProvider>,
    );
    return { messaging, onUnlocked };
}

function openForgotDialog() {
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    return screen.getByRole('alertdialog', { name: 'Restore wallet access' });
}

function chooseRestorePath(name) {
    fireEvent.click(screen.getByRole('button', { name }));
}

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
    globalThis.localStorage?.removeItem(FORGOT_PASSWORD_RESTORE_LANE_KEY);
    globalThis.localStorage?.removeItem(POST_DEMO_INTENT_KEY);
    wipeWalletStorage.mockReset();
    wipeWalletStorage.mockResolvedValue(undefined);
    reload = vi.fn();
    Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { reload },
    });
});

afterEach(() => {
    cleanup();
    clearLockoutState();
    globalThis.localStorage?.removeItem(FORGOT_PASSWORD_RESTORE_LANE_KEY);
    globalThis.localStorage?.removeItem(POST_DEMO_INTENT_KEY);
    delete globalThis.location;
});

describe('Locked forgot-password wipe', () => {
    it('hides SDK and stack text when unlocking fails', async () => {
        const internal = Object.assign(
            new Error('ERR_UNLOCK_BRIDGE\n    at unlock.js:7:4'),
            { name: 'SDKWalletError', code: 'ERR_UNLOCK_BRIDGE' },
        );
        mount({ messaging: { unlockWallet: vi.fn().mockRejectedValue(internal) } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));

        expect(await screen.findByText(
            'Could not unlock the wallet. Close and reopen the app, then try again.',
        )).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('ERR_UNLOCK_BRIDGE');
        expect(document.body).not.toHaveTextContent('unlock.js');
    });

    it('keeps keyboard focus in the restore dialog, closes on Escape, and continues to unlock', async () => {
        const user = userEvent.setup();
        const messaging = { unlockWallet: vi.fn().mockResolvedValue({}) };
        const onUnlocked = vi.fn();
        mount({ messaging, onUnlocked });

        const password = screen.getByLabelText('Password');
        fireEvent.change(password, { target: { value: 'secret' } });
        password.focus();
        await user.tab();
        const trigger = screen.getByRole('button', { name: 'Forgot password?' });
        expect(trigger).toHaveFocus();
        await user.keyboard('{Enter}');

        await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus());
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('alertdialog', { name: 'Restore wallet access' })).toBeNull();
        expect(trigger).toHaveFocus();
        expect(wipeWalletStorage).not.toHaveBeenCalled();

        await user.tab();
        expect(screen.getByRole('button', { name: 'Unlock Wallet' })).toHaveFocus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(messaging.unlockWallet).toHaveBeenCalledWith('secret'));
        expect(onUnlocked).toHaveBeenCalledOnce();
    });

    it('plainly explains recovery and offers both restore paths without wiping', () => {
        mount();
        const dialog = openForgotDialog();
        expect(dialog).toHaveAttribute('aria-modal', 'false');
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
        expect(dialog).toHaveTextContent(/password cannot be recovered or reset/i);
        expect(dialog).toHaveTextContent(/choose a new password/i);
        expect(screen.getByRole('button', { name: 'Use recovery phrase' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Use backup file' })).toBeEnabled();

        chooseRestorePath('Use recovery phrase');
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        expect(dialog).toHaveTextContent(/every wallet saved in this app on this device/i);
        expect(dialog).toHaveTextContent(/recovery information, accounts, addresses, and queued transactions/i);
        expect(dialog).toHaveTextContent(/opens the recovery-phrase restore form/i);

        const wipe = screen.getByRole('button', { name: 'Erase vault and restore' });
        expect(wipe).toBeDisabled();
        fireEvent.click(wipe);
        expect(wipeWalletStorage).not.toHaveBeenCalled();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: ' wipe ' } });
        expect(wipe).toBeEnabled();
        expect(wipe.className).toMatch(/danger/);
    });

    it('cancels without wiping and resets the typed confirmation', () => {
        mount();
        openForgotDialog();
        chooseRestorePath('Use backup file');
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(wipeWalletStorage).not.toHaveBeenCalled();
        expect(screen.queryByRole('alertdialog', { name: 'Restore wallet access' })).not.toBeInTheDocument();
        const dialog = openForgotDialog();
        expect(dialog).toHaveTextContent(/password cannot be recovered or reset/i);
        expect(screen.queryByLabelText('Type WIPE to confirm')).not.toBeInTheDocument();
    });

    it.each([
        ['Use recovery phrase', 'mnemonic', 'Recovery phrase'],
        ['Use backup file', 'backup', 'Encrypted backup'],
    ])('carries %s to its restore form only after a confirmed wipe', async (choice, lane, selectedTab) => {
        let resolveWipe;
        wipeWalletStorage.mockReturnValue(new Promise((resolve) => { resolveWipe = resolve; }));
        mount();
        openForgotDialog();
        chooseRestorePath(choice);
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        const wipe = screen.getByRole('button', { name: 'Erase vault and restore' });
        fireEvent.click(wipe);

        expect(wipe).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        resolveWipe();
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(wipeWalletStorage).toHaveBeenCalledTimes(1);
        expect(globalThis.localStorage.getItem(FORGOT_PASSWORD_RESTORE_LANE_KEY)).toBe(lane);
        expect(takePostDemoIntent()).toBe('import');

        cleanup();
        render(
            <MessagingProvider shell="web" messaging={{}}>
                <ImportWallet onBack={() => {}} onImported={() => {}} />
            </MessagingProvider>,
        );
        expect(screen.getByRole('tab', { name: selectedTab })).toHaveAttribute('aria-selected', 'true');
        expect(globalThis.localStorage.getItem(FORGOT_PASSWORD_RESTORE_LANE_KEY)).toBeNull();
    });

    it('reports a failed wipe and re-enables both actions for retry or cancel', async () => {
        wipeWalletStorage.mockRejectedValueOnce(new Error('host storage is busy'));
        mount();
        openForgotDialog();
        chooseRestorePath('Use backup file');
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        fireEvent.click(screen.getByRole('button', { name: 'Erase vault and restore' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'Could not erase wallet data. Close and reopen the app, then try again.',
        );
        expect(alert).not.toHaveTextContent('host storage is busy');
        expect(screen.getByRole('button', { name: 'Erase vault and restore' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
        expect(globalThis.localStorage.getItem(FORGOT_PASSWORD_RESTORE_LANE_KEY)).toBeNull();
        expect(globalThis.localStorage.getItem(POST_DEMO_INTENT_KEY)).toBeNull();
        expect(reload).not.toHaveBeenCalled();
    });
});

describe('Locked demo exit', () => {
    it('requires an explicit danger confirmation that names everything destroyed', () => {
        markDemoWallet('demo-1');
        mount();

        const trigger = screen.getByRole('button', { name: 'Exit demo & wipe' });
        expect(trigger.className).toMatch(/danger/);
        fireEvent.click(trigger);

        const dialog = screen.getByRole('dialog', { name: /exit demo and delete its data/i });
        expect(dialog).toHaveTextContent(/every wallet saved in this app on this device/i);
        expect(dialog).toHaveTextContent(/recovery information, accounts, addresses, and queued transactions/i);
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('cancels without wiping', () => {
        markDemoWallet('demo-1');
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Exit demo & wipe' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(wipeWalletStorage).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps the demo escape retryable when the host wipe fails', async () => {
        markDemoWallet('demo-1');
        wipeWalletStorage.mockRejectedValueOnce(new Error('desktop files are busy'));
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Exit demo & wipe' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Exit demo & wipe' })[1]);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'Could not exit demo mode. Close and reopen the app, then try again.',
        );
        expect(alert).not.toHaveTextContent('desktop files are busy');
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'false');
        expect(screen.getAllByRole('button', { name: 'Exit demo & wipe' })[1]).toBeEnabled();
        expect(getDemoWalletId()).toBe('demo-1');
        expect(reload).not.toHaveBeenCalled();
    });

    it('shows a busy state, clears the demo marker, and reloads into onboarding on success', async () => {
        markDemoWallet('demo-1');
        let resolveWipe;
        wipeWalletStorage.mockReturnValue(new Promise((resolve) => { resolveWipe = resolve; }));
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Exit demo & wipe' }));
        const dialog = screen.getByRole('dialog');
        fireEvent.click(screen.getAllByRole('button', { name: 'Exit demo & wipe' })[1]);

        expect(dialog).toHaveAttribute('aria-busy', 'true');
        resolveWipe();
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(getDemoWalletId()).toBe(null);
    });
});
