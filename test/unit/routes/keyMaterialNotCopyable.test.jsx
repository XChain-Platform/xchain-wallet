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

function continueToPassword() {
    fireEvent.click(screen.getByRole('button', { name: /I understand, continue/i }));
}

async function confirmPassword() {
    continueToPassword();
    fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm password' }));
    await act(async () => { await Promise.resolve(); });
}

afterEach(() => {
    cleanup();
    __resetScreenGuardForTests();
    clipboard.copyText.mockClear();
    clipboard.clearClipboard.mockClear();
    vi.useRealTimers();
});

describe('private-key reveal security', () => {
    it('warns before requesting a password and does not export early', () => {
        const { messaging } = draw();

        expect(screen.getByText(/Never share this private key/)).toHaveTextContent(
            'Never share this private key. Anyone with it can spend funds from this address.',
        );
        expect(screen.getByText(/screen-sharing or recording/i)).toBeTruthy();
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        expect(messaging.exportPrivateKey).not.toHaveBeenCalled();

        continueToPassword();
        expect(screen.getByLabelText('Wallet password')).toHaveAttribute('type', 'password');
        expect(messaging.exportPrivateKey).not.toHaveBeenCalled();
    });

    it('requires password confirmation and keeps the exported key masked', async () => {
        const { messaging } = draw();

        await confirmPassword();

        expect(messaging.exportPrivateKey).toHaveBeenCalledWith({
            walletId: 'w1',
            addressId: ADDRESS.id,
            password: PASSWORD,
        });
        expect(screen.getByRole('button', { name: /Tap to reveal private key/i })).toBeTruthy();
        expect(screen.queryByText(PRIVATE_KEY)).toBeNull();
    });

    it('shows a fixed password error without exposing the host error', async () => {
        const err = new Error('internal decrypt detail');
        err.name = 'WrongPasswordError';
        draw(makeMessaging({ exportPrivateKey: vi.fn(async () => { throw err; }) }));

        await confirmPassword();

        expect(screen.getByText('Incorrect password. Try again.')).toBeTruthy();
        expect(screen.queryByText(/internal decrypt detail/i)).toBeNull();
        expect(screen.getByLabelText('Wallet password')).toBeTruthy();
    });

    it('reveals only after a tap and automatically hides after 30 seconds', async () => {
        vi.useFakeTimers();
        draw();
        await confirmPassword();

        fireEvent.click(screen.getByRole('button', { name: /Tap to reveal private key/i }));
        expect(screen.getByText(PRIVATE_KEY)).toBeTruthy();

        act(() => vi.advanceTimersByTime(29_999));
        expect(screen.getByText(PRIVATE_KEY)).toBeTruthy();
        act(() => vi.advanceTimersByTime(1));
        expect(screen.queryByText(PRIVATE_KEY)).toBeNull();
        expect(screen.getByRole('button', { name: /Tap to reveal private key/i })).toBeTruthy();
    });

    it('does not carry a revealed key into another wallet screen', async () => {
        const { messaging, rerender } = draw();
        await confirmPassword();
        fireEvent.click(screen.getByRole('button', { name: /Tap to reveal private key/i }));
        expect(screen.getByText(PRIVATE_KEY)).toBeTruthy();

        rerender(
            <MessagingProvider shell="web" messaging={messaging}>
                <ViewPrivateKey
                    walletId="w2"
                    address={ADDRESS}
                    onBack={() => {}}
                />
            </MessagingProvider>,
        );

        expect(screen.queryByText(PRIVATE_KEY)).toBeNull();
        await waitFor(() => expect(screen.getByText('Before you continue')).toBeTruthy());
    });

    it('clears a revealed key when Done requests navigation', async () => {
        const onBack = vi.fn();
        draw(makeMessaging(), { onBack });
        await confirmPassword();
        fireEvent.click(screen.getByRole('button', { name: /Tap to reveal private key/i }));
        expect(screen.getByText(PRIVATE_KEY)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Done' }));

        expect(onBack).toHaveBeenCalledOnce();
        expect(screen.queryByText(PRIVATE_KEY)).toBeNull();
        expect(screen.getByText('Before you continue')).toBeTruthy();
    });

    it('ignores a private-key response that arrives after navigation', async () => {
        let finishExport;
        const exportPrivateKey = vi.fn(() => new Promise((resolve) => { finishExport = resolve; }));
        const onBack = vi.fn();
        draw(makeMessaging({ exportPrivateKey }), { onBack });

        continueToPassword();
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: PASSWORD } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirm password' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        await act(async () => { finishExport({ wif: PRIVATE_KEY }); });

        expect(onBack).toHaveBeenCalledOnce();
        expect(screen.queryByText(PRIVATE_KEY)).toBeNull();
        expect(screen.getByText('Before you continue')).toBeTruthy();
    });

    it('routes copy through the sensitive clipboard with the selected expiry', async () => {
        draw();
        await confirmPassword();
        fireEvent.click(screen.getByRole('button', { name: /Tap to reveal private key/i }));
        await waitFor(() => expect(
            screen.getByText('Sensitive clipboard copies expire after 17 seconds.'),
        ).toBeTruthy());

        fireEvent.click(screen.getByRole('button', { name: 'Copy private key' }));
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
