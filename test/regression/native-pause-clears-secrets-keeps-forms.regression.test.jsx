// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression suite: a native pause clears secret screens and keeps ordinary
// forms. The app shell covers the page with the lifecycle hook and runs
// dismissAllOverlays on pause; the screen below it stays mounted, so a typed
// form value survives while an exported key or recovery phrase is gone from
// the DOM before the page is hidden.

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessagingProvider } from '../../packages/core/src/shared/MessagingProvider.jsx';
import { BackupSection } from '../../packages/core/src/shared/components/settings/BackupSection.jsx';
import { ViewPrivateKey } from '../../packages/core/src/shared/routes/ViewPrivateKey.jsx';
import { __resetScreenGuardForTests } from '../../packages/core/src/shared/utils/screenGuard.js';
import { dismissAllOverlays, resetBackStackForTests } from '../../packages/core/src/ui/backStack.js';
import { useNativeAppLifecycle } from '../../packages/web/src/platform/nativeAppLifecycle.js';

const PRIVATE_KEY = 'test-private-key-material';
const PHRASE_WORD = 'abandon abandon';
const ADDRESS = {
    id: 'a1',
    address: 'bcrt1qexampleexampleexampleexampleexampleex',
    source: 'hd',
    chain: 'bitcoin',
    network: 'regtest',
    derivationPath: "m/84'/1'/0'/0/0",
    label: 'Main',
};

function Shell({ children }) {
    useNativeAppLifecycle({
        checkAutoLock: () => false,
        onBackground: () => dismissAllOverlays(),
        onUnlockedResume: () => {},
        sessionState: 'unlocked',
    });
    return <div>{children}</div>;
}

function Form() {
    const [text, setText] = React.useState('');
    return <input aria-label="Note" value={text} onChange={(e) => setText(e.target.value)} />;
}

function mount(messaging, secret) {
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <Shell><Form />{secret}</Shell>
        </MessagingProvider>,
    );
}

async function typeNote() {
    const input = screen.getByLabelText('Note');
    act(() => { fireEvent.change(input, { target: { value: 'kept text' } }); });
    return input;
}

beforeEach(() => {
    globalThis.Capacitor = { isNativePlatform: () => true, Plugins: {} };
});

afterEach(() => {
    cleanup();
    resetBackStackForTests();
    __resetScreenGuardForTests();
    delete globalThis.Capacitor;
});

describe('native pause with a secret screen and an ordinary form', () => {
    it('clears an exported private key and keeps the typed form value', async () => {
        const messaging = {
            exportPrivateKey: vi.fn(async () => ({ wif: PRIVATE_KEY })),
            getSettings: vi.fn(async () => ({ privacy: { clipboardAutoClearSeconds: 17 } })),
        };
        mount(messaging, <ViewPrivateKey walletId="w1" address={ADDRESS} onBack={() => {}} />);
        const input = await typeNote();
        fireEvent.click(screen.getByRole('button', { name: /I understand, continue/i }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw-for-test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirm password' }));
        await act(async () => { await Promise.resolve(); });
        fireEvent.click(screen.getByRole('button', { name: /Tap to reveal private key/i }));
        expect(screen.getByText(PRIVATE_KEY)).toBeTruthy();

        act(() => document.dispatchEvent(new Event('pause')));

        expect(document.body.textContent).not.toContain(PRIVATE_KEY);
        expect(document.body.style.visibility).toBe('hidden');
        expect(screen.getByLabelText('Note')).toBe(input);
        expect(input).toHaveValue('kept text');
    });

    it('clears a revealed recovery phrase and keeps the typed form value', async () => {
        const messaging = {
            revealMnemonicRequest: vi.fn(async () => ({
                mnemonic: `${PHRASE_WORD} abandon abandon abandon abandon abandon abandon abandon abandon about`,
                format: 'bip39',
                passphraseEnabled: false,
                bip39Passphrase: null,
            })),
        };
        mount(messaging, <BackupSection activeWallet={{ id: 'w1', name: 'Cold' }} />);
        const input = await typeNote();
        fireEvent.click(screen.getByRole('button', { name: 'Show…' }));
        fireEvent.change(screen.getByLabelText('Wallet password'), { target: { value: 'pw-for-test' } });
        fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
        await waitFor(() => expect(screen.getByText('Your recovery phrase')).toBeTruthy());

        act(() => document.dispatchEvent(new Event('pause')));

        expect(document.body.textContent).not.toContain(PHRASE_WORD);
        expect(document.body.style.visibility).toBe('hidden');
        expect(input).toHaveValue('kept text');
        act(() => document.dispatchEvent(new Event('resume')));
        expect(document.body.style.visibility).toBe('');
        expect(document.body.textContent).not.toContain(PHRASE_WORD);
    });
});
