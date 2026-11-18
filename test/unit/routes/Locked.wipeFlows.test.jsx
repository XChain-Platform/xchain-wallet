// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const wipeWalletStorage = vi.hoisted(() => vi.fn());

vi.mock('../../../packages/core/src/shared/utils/wipeWalletStorage.js', () => ({
    wipeWalletStorage,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { userEvent } from '../../helpers/userEvent.js';
import { FORGOT_PASSWORD_RESTORE_LANE_KEY } from '../../../packages/core/src/shared/utils/forgotPasswordRecovery.js';
import { POST_DEMO_INTENT_KEY } from '../../../packages/core/src/shared/utils/demoGraduation.js';
import {
    clearDemoWalletId,
    clearLockoutState,
    getDemoWalletId,
    markDemoWallet,
} from '../../../packages/core/src/flows/index.js';
import {
    resetBackStackForTests,
} from '../../../packages/core/src/ui/backStack.js';

let reload;

function mount({ messaging = { unlockWallet: vi.fn() }, onUnlocked = vi.fn() } = {}) {
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Locked onUnlocked={onUnlocked} />
        </MessagingProvider>,
    );
    return { messaging, onUnlocked };
}

function pressBack() {
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }));
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
    resetBackStackForTests();
    clearLockoutState();
    globalThis.localStorage?.removeItem(FORGOT_PASSWORD_RESTORE_LANE_KEY);
    globalThis.localStorage?.removeItem(POST_DEMO_INTENT_KEY);
    delete globalThis.location;
});

// The retired immediate-wipe cases moved to ForgotPassword.test.jsx with the 2026-11-16 ruling.
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

    it('opens the page from the keyboard, returns with Back to the button, and continues to unlock', async () => {
        const user = userEvent.setup();
        const messaging = { unlockWallet: vi.fn().mockResolvedValue({}) };
        const onUnlocked = vi.fn();
        mount({ messaging, onUnlocked });

        const password = screen.getByLabelText('Password');
        fireEvent.change(password, { target: { value: 'secret' } });
        password.focus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Show password' })).toHaveFocus();
        await user.tab();
        expect(screen.getByRole('button', { name: 'Unlock Wallet' })).toHaveFocus();
        await user.tab();
        const trigger = screen.getByRole('button', { name: 'Forgot Password?' });
        expect(trigger).toHaveFocus();
        await user.keyboard('{Enter}');

        expect(await screen.findByRole('heading', { level: 1, name: 'Forgot Password?' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        pressBack();
        expect(screen.queryByRole('heading', { level: 1, name: 'Forgot Password?' })).toBeNull();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Forgot Password?' })).toHaveFocus());
        expect(wipeWalletStorage).not.toHaveBeenCalled();

        await user.tab({ shift: true });
        expect(screen.getByRole('button', { name: 'Unlock Wallet' })).toHaveFocus();
        await user.keyboard('{Enter}');
        await waitFor(() => expect(messaging.unlockWallet).toHaveBeenCalledWith('secret'));
        expect(onUnlocked).toHaveBeenCalledOnce();
    });

});

describe('Locked demo exit', () => {
    it('requires an explicit danger confirmation that names everything destroyed', async () => {
        markDemoWallet('demo-1');
        mount();

        const trigger = screen.getByRole('button', { name: 'Exit Demo & Wipe' });
        expect(trigger.className).toMatch(/danger/);
        fireEvent.click(trigger);

        const dialog = await screen.findByRole('dialog', { name: /exit demo and delete its data/i });
        expect(dialog).toHaveTextContent(/every wallet saved in this app on this device/i);
        expect(dialog).toHaveTextContent(/recovery information, accounts, addresses, and queued transactions/i);
        expect(wipeWalletStorage).not.toHaveBeenCalled();
    });

    it('cancels without wiping', async () => {
        markDemoWallet('demo-1');
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Exit Demo & Wipe' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

        expect(wipeWalletStorage).not.toHaveBeenCalled();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('keeps the demo escape retryable when the host wipe fails', async () => {
        markDemoWallet('demo-1');
        wipeWalletStorage.mockRejectedValueOnce(new Error('desktop files are busy'));
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Exit Demo & Wipe' }));
        const confirm = await screen.findByRole('dialog');
        fireEvent.click(within(confirm).getByRole('button', { name: 'Exit Demo & Wipe' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(
            'Could not exit demo mode. Close and reopen the app, then try again.',
        );
        expect(alert).not.toHaveTextContent('desktop files are busy');
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'false');
        expect(screen.getAllByRole('button', { name: 'Exit Demo & Wipe' })[1]).toBeEnabled();
        expect(getDemoWalletId()).toBe('demo-1');
        expect(reload).not.toHaveBeenCalled();
    });

    it('shows a busy state, clears the demo marker, and reloads into onboarding on success', async () => {
        markDemoWallet('demo-1');
        let resolveWipe;
        wipeWalletStorage.mockReturnValue(new Promise((resolve) => { resolveWipe = resolve; }));
        mount();
        fireEvent.click(screen.getByRole('button', { name: 'Exit Demo & Wipe' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Exit Demo & Wipe' }));

        expect(dialog).toHaveAttribute('aria-busy', 'true');
        resolveWipe();
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
        expect(getDemoWalletId()).toBe(null);
    });
});
