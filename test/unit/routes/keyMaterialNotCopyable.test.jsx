// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const clipboard = vi.hoisted(() => ({
    copyText: vi.fn(async () => ({ ok: true, native: true, marked: true })),
    clearClipboard: vi.fn(async () => true),
}));

vi.mock('../../../packages/core/src/shared/clipboard.js', async (importOriginal) => ({
    ...await importOriginal(),
    copyText: clipboard.copyText,
    clearClipboard: clipboard.clearClipboard,
}));

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    __resetScreenGuardForTests,
    installScreenGuard,
} from '../../../packages/core/src/shared/utils/screenGuard.js';
import { ViewPrivateKey } from '../../../packages/core/src/shared/routes/ViewPrivateKey.jsx';
import {
    dismissAllOverlays,
    resetBackStackForTests,
} from '../../../packages/core/src/ui/backStack.js';

const PRIVATE_KEY = 'test-private-key-material';
const PASSWORD = 'correct horse battery staple';
const ADDRESS = {
    id: 'a1',
    address: 'bcrt1qexampleexampleexampleexampleexampleex',
    source: 'hd',
    chain: 'bitcoin',
    network: 'regtest',
    derivationPath: "m/84'/1'/0'/0/0",
    label: 'Main',
};

function makeMessaging(overrides = {}) {
    return {
        exportPrivateKey: vi.fn(async () => ({ wif: PRIVATE_KEY })),
        getSettings: vi.fn(async () => ({
            privacy: { clipboardAutoClearSeconds: 17 },
        })),
        ...overrides,
    };
}

function draw(messaging = makeMessaging(), props = {}) {
    const result = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ViewPrivateKey walletId="w1" address={ADDRESS} onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
    return { ...result, messaging };
}

// The warning and the wallet password share one form, and I understand
// submits it; the key shows at once on success (no tap to reveal).
async function confirmPassword() {
    fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'I Understand' }));
    await act(async () => { await Promise.resolve(); });
}

// The key sits in a read-only field, so it is read by display value.
const shownKey = () => screen.queryByDisplayValue(PRIVATE_KEY);
// Back on the "Before you continue" form: its wallet password field is there
// again and empty.
const atWarningForm = () => {
    const field = screen.getByLabelText('Wallet password');
    expect(field).toHaveValue('');
    return field;
};

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    __resetScreenGuardForTests();
    clipboard.copyText.mockClear();
    clipboard.clearClipboard.mockClear();
    vi.useRealTimers();
});

describe('private-key reveal security', () => {
    it('clears an exported private key when the native app pauses', async () => {
        const onBack = vi.fn();
        draw(makeMessaging(), { onBack });
        await confirmPassword();
        expect(shownKey()).toBeTruthy();

        act(() => dismissAllOverlays());

        expect(shownKey()).toBeNull();
        expect(atWarningForm()).toBeTruthy();
        // The key page's back handler runs for the native pause: it wipes the
        // key and leaves the screen.
        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it('warns and asks for the password on one form and does not export early', () => {
        const { messaging } = draw();

        expect(screen.getByText(/Never share this private key/)).toHaveTextContent(
            'Never share this private key. Anyone with it can spend funds from this address.',
        );
        expect(screen.queryByText(/screen-sharing or recording/i)).toBeNull();
        // The password field sits under the warning, masked, with no key shown.
        expect(screen.getByLabelText('Wallet password')).toHaveAttribute('type', 'password');
        expect(shownKey()).toBeNull();
        expect(messaging.exportPrivateKey).not.toHaveBeenCalled();
    });

    it('does not export on an empty password and marks the field', async () => {
        const { messaging } = draw();

        fireEvent.click(screen.getByRole('button', { name: 'I Understand' }));
        await act(async () => { await Promise.resolve(); });

        expect(messaging.exportPrivateKey).not.toHaveBeenCalled();
        expect(shownKey()).toBeNull();
        expect(screen.getByRole('alert', { name: 'Form errors' }))
            .toHaveTextContent('Enter your wallet password.');
    });

    it('requires password confirmation before the exported key shows', async () => {
        const { messaging } = draw();
        expect(shownKey()).toBeNull();

        await confirmPassword();

        expect(messaging.exportPrivateKey).toHaveBeenCalledWith({
            walletId: 'w1',
            addressId: ADDRESS.id,
            password: PASSWORD,
        });
        expect(shownKey()).toBeTruthy();
    });

    it('shows a fixed password error without exposing the host error', async () => {
        const err = new Error('internal decrypt detail');
        err.name = 'WrongPasswordError';
        draw(makeMessaging({ exportPrivateKey: vi.fn(async () => { throw err; }) }));

        await confirmPassword();

        expect(screen.getByRole('alert', { name: 'Form errors' }))
            .toHaveTextContent('The wallet password is not right.');
        expect(screen.queryByText(/internal decrypt detail/i)).toBeNull();
        expect(screen.getByLabelText('Wallet password')).toBeTruthy();
        expect(shownKey()).toBeNull();
    });

    // The key page has no Hide: the timeout wipes the key and returns to the form.
    it('shows the key at once and wipes it after 30 seconds', async () => {
        vi.useFakeTimers();
        draw();
        await confirmPassword();

        expect(shownKey()).toBeTruthy();

        act(() => vi.advanceTimersByTime(29_999));
        expect(shownKey()).toBeTruthy();
        act(() => vi.advanceTimersByTime(1));
        expect(shownKey()).toBeNull();
        expect(atWarningForm()).toBeTruthy();
    });

    it('wipes a revealed key when the desktop window is minimized or hidden', async () => {
        draw();
        await confirmPassword();
        expect(shownKey()).toBeTruthy();

        act(() => window.dispatchEvent(new CustomEvent('xc:window-hidden')));

        expect(shownKey()).toBeNull();
        expect(atWarningForm()).toBeTruthy();
    });

    it('does not carry a revealed key into another address screen', async () => {
        const { messaging, rerender } = draw();
        await confirmPassword();
        expect(shownKey()).toBeTruthy();

        rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <ViewPrivateKey
                    walletId="w1"
                    address={{ ...ADDRESS, id: 'a2', address: 'bcrt1qsecondaddress' }}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(shownKey()).toBeNull();
        await waitFor(() => expect(atWarningForm()).toBeTruthy());
    });

    // The key page has no Done button: the title bar's Back leaves and wipes the key.
    it('clears the exported key before leaving the screen', async () => {
        const onBack = vi.fn();
        draw(makeMessaging(), { onBack });
        await confirmPassword();
        expect(shownKey()).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(onBack).toHaveBeenCalledTimes(1);
        expect(shownKey()).toBeNull();
        expect(atWarningForm()).toBeTruthy();
    });

    it('clears the reveal when a new unlocked session replaces a locked one', async () => {
        draw();
        await confirmPassword();
        expect(shownKey()).toBeTruthy();

        act(() => window.dispatchEvent(new CustomEvent('xc:session-changed')));

        expect(shownKey()).toBeNull();
        expect(atWarningForm()).toBeTruthy();
    });

    it('routes copy through the sensitive clipboard with the selected expiry', async () => {
        draw();
        await confirmPassword();
        await waitFor(() => expect(
            screen.getByText('Sensitive clipboard copies expire after 17 seconds.'),
        ).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Copy Private Key' }));
        await act(async () => { await Promise.resolve(); });
        expect(clipboard.copyText).toHaveBeenCalledWith(expect.any(String), { sensitive: true });
        expect(clipboard.clearClipboard).not.toHaveBeenCalled();
    });

    it('enables the screen guard only while the route is mounted', async () => {
        const guard = vi.fn();
        installScreenGuard(guard);
        const view = draw();

        await waitFor(() => expect(guard).toHaveBeenCalledWith(true));
        view.unmount();
        expect(guard).toHaveBeenLastCalledWith(false);
    });
});
