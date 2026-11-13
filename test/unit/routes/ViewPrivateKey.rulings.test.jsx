// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// View private key against the app-wide rulings: each step's forward action is
// green with an icon (U63), every button carries an icon, and the password
// step keeps its explanation in the field's tip instead of a static intro (U57).
// The key used here is a placeholder string, never real key material.

import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ViewPrivateKey } from '../../../packages/core/src/shared/routes/ViewPrivateKey.jsx';
import { __resetScreenGuardForTests } from '../../../packages/core/src/shared/utils/screenGuard.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const PLACEHOLDER = 'placeholder-not-a-key';
const ADDRESS = {
    id: 'a1',
    address: 'bcrt1qexampleexampleexampleexampleexampleex',
    source: 'hd',
    chain: 'bitcoin',
    network: 'regtest',
    derivationPath: "m/84'/1'/0'/0/0",
};

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    __resetScreenGuardForTests();
});

function mount(address = ADDRESS, exportPrivateKey = vi.fn(async () => ({ wif: PLACEHOLDER }))) {
    const messaging = {
        exportPrivateKey,
        getSettings: vi.fn(async () => ({ privacy: { clipboardAutoClearSeconds: 17 } })),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ViewPrivateKey walletId="w1" address={address} onBack={() => {}} />
        </MessagingProvider>,
    );
    return messaging;
}

// What the web shell fires on every unlocked status refresh: a bare event
// with no detail, while the session stays the same.
function plainStatusRefresh() {
    act(() => { window.dispatchEvent(new CustomEvent('xc:session-changed')); });
}

async function confirmPassword() {
    fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw-for-test' } });
    fireEvent.click(screen.getByRole('button', { name: 'I Understand' }));
    await act(async () => { await Promise.resolve(); });
}

const greenWithIcon = (button) => {
    expect(button).toHaveClass(buttonStyles.success);
    expect(button.querySelector('svg')).not.toBeNull();
};

describe('ViewPrivateKey rulings', () => {
    it('walks warning, password and reveal with green iconned forward actions', async () => {
        mount();
        // One form holds the warning, the wallet password and the green
        // I understand action; there is no separate password page.
        expect(screen.queryByText('Confirm your wallet password. The key stays hidden until you tap to reveal it.')).toBeNull();
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw-for-test' } });
        greenWithIcon(screen.getByRole('button', { name: 'I Understand' }));
        fireEvent.click(screen.getByRole('button', { name: 'I Understand' }));
        await act(async () => { await Promise.resolve(); });

        // The key shows at once, laid out like Receive; the back arrow leaves
        // and wipes it, so there is no tap-to-reveal, Hide or Done.
        expect(await screen.findByRole('textbox', { name: 'Private key' })).toHaveValue(PLACEHOLDER);
        expect(screen.getByRole('button', { name: 'Copy Private Key' }).querySelector('svg')).not.toBeNull();
        expect(screen.queryByRole('button', { name: 'Tap to reveal private key' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    });

    it('wipes the shown key on a plain status refresh of the same unlocked session', async () => {
        const messaging = mount();
        await confirmPassword();
        expect(await screen.findByRole('textbox', { name: 'Private key' })).toHaveValue(PLACEHOLDER);

        plainStatusRefresh();

        // Back on the warning form: no key field, no key text, no key QR, and
        // the password field starts empty.
        expect(screen.queryByRole('textbox', { name: 'Private key' })).toBeNull();
        expect(screen.queryByDisplayValue(PLACEHOLDER)).toBeNull();
        expect(screen.queryByText(PLACEHOLDER)).toBeNull();
        expect(screen.queryByAltText('Private key QR code')).toBeNull();
        expect(screen.getByLabelText('Wallet password')).toHaveValue('');

        // Showing it again takes the password and a fresh export.
        expect(messaging.exportPrivateKey).toHaveBeenCalledTimes(1);
        await confirmPassword();
        expect(await screen.findByRole('textbox', { name: 'Private key' })).toHaveValue(PLACEHOLDER);
        expect(messaging.exportPrivateKey).toHaveBeenCalledTimes(2);
    });

    it('drops an export still in flight when a status refresh lands', async () => {
        let finishExport;
        const exportPrivateKey = vi.fn(() => new Promise((resolve) => { finishExport = resolve; }));
        mount(ADDRESS, exportPrivateKey);
        await confirmPassword();
        expect(exportPrivateKey).toHaveBeenCalledTimes(1);

        plainStatusRefresh();
        await act(async () => { finishExport({ wif: PLACEHOLDER }); await Promise.resolve(); });

        expect(screen.queryByRole('textbox', { name: 'Private key' })).toBeNull();
        expect(screen.queryByDisplayValue(PLACEHOLDER)).toBeNull();
        expect(screen.getByRole('button', { name: 'I Understand' })).toBeEnabled();
    });

    it('a watch-only address closes with a green iconned Close', () => {
        mount({ ...ADDRESS, source: 'watch-only' });
        greenWithIcon(screen.getByRole('button', { name: 'Close' }));
    });
});
