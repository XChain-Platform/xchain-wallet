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
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import {
    clearDemoWalletId,
    clearLockoutState,
    getDemoWalletId,
    markDemoWallet,
} from '../../../packages/core/src/flows/index.js';

let reload;

function mount() {
    render(
        <MessagingProvider shell="web" messaging={{ unlockWallet: vi.fn() }}>
            <Locked onUnlocked={() => {}} />
        </MessagingProvider>,
    );
}

function openForgotDialog() {
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    return screen.getByRole('alertdialog', { name: 'Wipe wallet data' });
}

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
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
    delete globalThis.location;
});

describe('Locked forgot-password wipe', () => {
    it('names the local data being destroyed and requires the typed confirmation', () => {
        mount();
        const dialog = openForgotDialog();
        const title = screen.getByText('Wipe wallet data', { selector: 'strong' });
        const warning = dialog.querySelector('#locked-wipe-warning');
        const note = dialog.querySelector('#locked-wipe-note');
        expect(dialog).toHaveAttribute('aria-modal', 'false');
        expect(dialog).toHaveAttribute('aria-labelledby', title.id);
        expect(dialog).toHaveAttribute('aria-describedby', `${warning.id} ${note.id}`);
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
        expect(dialog).toHaveTextContent(/every wallet saved in this app on this device/i);
        expect(dialog).toHaveTextContent(/recovery information, accounts, addresses, and queued transactions/i);

        const wipe = screen.getByRole('button', { name: 'Wipe wallet data' });
        expect(wipe).toBeDisabled();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: ' wipe ' } });
        expect(wipe).toBeEnabled();
        expect(wipe.className).toMatch(/danger/);
    });

    it('cancels without wiping and resets the typed confirmation', () => {
        mount();
        openForgotDialog();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(wipeWalletStorage).not.toHaveBeenCalled();
        expect(screen.queryByRole('alertdialog', { name: 'Wipe wallet data' })).not.toBeInTheDocument();
        openForgotDialog();
        expect(screen.getByLabelText('Type WIPE to confirm')).toHaveValue('');
    });

    it('shows a busy state and reloads into onboarding after a successful wipe', async () => {
        let resolveWipe;
        wipeWalletStorage.mockReturnValue(new Promise((resolve) => { resolveWipe = resolve; }));
        mount();
        openForgotDialog();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        const wipe = screen.getByRole('button', { name: 'Wipe wallet data' });
        fireEvent.click(wipe);

        expect(wipe).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        resolveWipe();
        await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    });

    it('reports a failed wipe and re-enables both actions for retry or cancel', async () => {
        wipeWalletStorage.mockRejectedValueOnce(new Error('host storage is busy'));
        mount();
        openForgotDialog();
        fireEvent.change(screen.getByLabelText('Type WIPE to confirm'), { target: { value: 'WIPE' } });
        fireEvent.click(screen.getByRole('button', { name: 'Wipe wallet data' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('host storage is busy');
        expect(screen.getByRole('button', { name: 'Wipe wallet data' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
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

        expect(await screen.findByRole('alert')).toHaveTextContent('desktop files are busy');
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
