// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// View private key against the app-wide rulings: each step's forward action is
// green with an icon (U63), every button carries an icon, and the password
// step keeps its explanation in the field's tip instead of a static intro (U57).
// The key used here is a placeholder string, never real key material.

import React from 'react';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ViewPrivateKey } from '../../../packages/core/src/shared/routes/ViewPrivateKey.jsx';
import { __resetScreenGuardForTests } from '../../../packages/core/src/shared/utils/screenGuard.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';
import routeStyles from '../../../packages/core/src/shared/routes/ViewPrivateKey.module.css';

const routeCss = readFileSync('packages/core/src/shared/routes/ViewPrivateKey.module.css', 'utf8');
const formPageCss = readFileSync('packages/core/src/ui/FormPage.module.css', 'utf8');

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

const expectBefore = (first, second) => {
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
};

describe('ViewPrivateKey rulings', () => {
    it('keeps exactly 8px from the password field or its error to I Understand', () => {
        mount();
        expect(screen.getByLabelText('Wallet password').closest(`.${routeStyles.keyStack}`)).not.toBeNull();
        expect(routeCss).toMatch(/\.keyStack\.keyStack\s*{[^}]*margin-block-end:\s*0\s*;/s);
        expect(formPageCss).toMatch(/\.body \+ \.actions\s*{[^}]*margin-block-start:\s*calc\(var\(--xc-space-2\) - var\(--xc-form-gap,[^;]+;/s);
    });

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

    it('keeps one page and reveals the QR and key in place in the required order', async () => {
        const messaging = mount();
        const notice = screen.getByText(/Never share this private key/).closest('[role="note"]');
        const addressField = screen.getByRole('textbox', { name: 'Address' });
        const passwordField = screen.getByLabelText('Wallet password');
        const button = screen.getByRole('button', { name: 'I Understand' });
        expect(notice).not.toBeNull();
        expect(addressField).toHaveValue(ADDRESS.address);
        expect(addressField).toHaveAttribute('readonly');
        expect(screen.getByRole('button', { name: 'About Address' })).toBeInTheDocument();
        expectBefore(notice, addressField);
        expectBefore(addressField, passwordField);
        expectBefore(passwordField, button);
        expect(document.querySelectorAll('[data-warning-line]').length).toBe(1);
        expect(document.querySelectorAll('[role="note"], [role="alert"]').length).toBe(1);
        expect(screen.queryByRole('textbox', { name: 'Private key' })).toBeNull();
        expect(screen.queryByAltText('Private key QR code')).toBeNull();
        expect(screen.queryByDisplayValue(PLACEHOLDER)).toBeNull();

        fireEvent.click(button);
        const emptySummary = await screen.findByRole('alert', { name: 'Form errors' });
        expect(emptySummary).toHaveTextContent('Enter your wallet password.');
        expect(passwordField).toHaveAttribute('aria-invalid', 'true');
        expect(messaging.exportPrivateKey).not.toHaveBeenCalled();

        await confirmPassword();

        const qr = await screen.findByAltText('Private key QR code');
        const revealedAddress = screen.getByRole('textbox', { name: 'Address' });
        const privateKey = screen.getByRole('textbox', { name: 'Private key' });
        const clipboardNotice = screen.getByText(/Sensitive clipboard copies/);
        expect(revealedAddress).toBe(addressField);
        expectBefore(notice, qr);
        expectBefore(qr, revealedAddress);
        expectBefore(revealedAddress, privateKey);
        expectBefore(privateKey, clipboardNotice);
        expect(screen.queryByRole('button', { name: 'About Private key' })).toBeNull();
        expect(screen.queryByLabelText('Wallet password')).toBeNull();
        expect(screen.queryByRole('button', { name: 'I Understand' })).toBeNull();
        expect(messaging.exportPrivateKey).toHaveBeenCalledTimes(1);
    });

    it('keeps a wrong password unrevealed and reports it at the top and field', async () => {
        const error = new Error('host detail must stay hidden');
        error.name = 'WrongPasswordError';
        const exportPrivateKey = vi.fn(async () => { throw error; });
        mount(ADDRESS, exportPrivateKey);

        await confirmPassword();

        const summary = await screen.findByRole('alert', { name: 'Form errors' });
        const passwordField = screen.getByLabelText('Wallet password');
        expect(summary).toHaveTextContent('The wallet password is not right.');
        expect(passwordField).toHaveAttribute('aria-invalid', 'true');
        expect(screen.queryByRole('textbox', { name: 'Private key' })).toBeNull();
        expect(screen.queryByAltText('Private key QR code')).toBeNull();
        expect(screen.queryByDisplayValue(PLACEHOLDER)).toBeNull();
        expect(screen.getByRole('button', { name: 'I Understand' })).toBeEnabled();
        expect(screen.queryByText(/host detail must stay hidden/i)).toBeNull();
    });

    it('a watch-only address closes with a green iconned Close', () => {
        mount({ ...ADDRESS, source: 'watch-only' });
        greenWithIcon(screen.getByRole('button', { name: 'Close' }));
    });
});
