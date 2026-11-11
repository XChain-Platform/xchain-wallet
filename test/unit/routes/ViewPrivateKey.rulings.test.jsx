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

function mount(address = ADDRESS) {
    const messaging = {
        exportPrivateKey: vi.fn(async () => ({ wif: PLACEHOLDER })),
        getSettings: vi.fn(async () => ({ privacy: { clipboardAutoClearSeconds: 17 } })),
    };
    render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ViewPrivateKey walletId="w1" address={address} onBack={() => {}} />
        </MessagingProvider>,
    );
}

const greenWithIcon = (button) => {
    expect(button).toHaveClass(buttonStyles.success);
    expect(button.querySelector('svg')).not.toBeNull();
};

describe('ViewPrivateKey rulings', () => {
    it('walks warning, password and reveal with green iconned forward actions', async () => {
        mount();
        greenWithIcon(screen.getByRole('button', { name: 'I understand, continue' }));
        fireEvent.click(screen.getByRole('button', { name: 'I understand, continue' }));

        expect(screen.queryByText('Confirm your wallet password. The key stays hidden until you tap to reveal it.')).toBeNull();
        expect(screen.getByRole('button', { name: 'About Wallet password' })).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw-for-test' } });
        greenWithIcon(screen.getByRole('button', { name: 'Confirm password' }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm password' }));
        await act(async () => { await Promise.resolve(); });

        const reveal = screen.getByRole('button', { name: 'Tap to reveal private key' });
        expect(reveal).not.toHaveClass(buttonStyles.success);
        expect(reveal.querySelector('svg')).not.toBeNull();
        expect(screen.getByRole('button', { name: 'Hide' }).querySelector('svg')).not.toBeNull();
        greenWithIcon(screen.getByRole('button', { name: 'Done' }));
    });

    it('a watch-only address closes with a green iconned Close', () => {
        mount({ ...ADDRESS, source: 'watch-only' });
        greenWithIcon(screen.getByRole('button', { name: 'Close' }));
    });
});
