// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// An unlock that finds the encrypted vault gone (its meta still on the device)
// lands on "Your wallet couldn't be opened", the screen the shell's start-up
// read shows for the same state. "Close and reopen the app" sent the user
// round a reload to find out what had happened. A wrong password over a vault
// that is present keeps its own message and never leaves the Locked screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Locked } from '../../../packages/core/src/shared/routes/Locked.jsx';
import { VaultUnavailable } from '../../../packages/core/src/shared/routes/VaultUnavailable.jsx';
import {
    VaultCorruptError,
    VaultEvictedError,
    VaultIncompleteError,
} from '../../../packages/core/src/storage/backend.js';
import { hydrateEnvelopeError, serializeError } from '../../../packages/extension/src/background/MessageHost.js';
import { clearDemoWalletId, clearLockoutState } from '../../../packages/core/src/flows/index.js';

const GENERIC = 'Could not unlock the wallet. Close and reopen the app, then try again.';

beforeEach(() => {
    clearDemoWalletId();
    clearLockoutState();
});

afterEach(() => {
    cleanup();
    clearLockoutState();
});

// What the extension and desktop renderers receive: the background's error
// flattened into the wire envelope and rebuilt on the other side.
function overTheWire(err) {
    return hydrateEnvelopeError(serializeError(err).error);
}

// The shells' wiring: Locked hands the refusal up, and the shell renders the
// screen its own start-up read renders for an error with a vault kind.
function Shell({ shell, unlockWallet, onRouted }) {
    const [status, setStatus] = useState({ state: 'locked' });
    return (
        <MessagingProvider shell={shell} messaging={{ unlockWallet }}>
            {status.state === 'error'
                ? <VaultUnavailable kind={status.errorKind} detail={status.error} />
                : (
                    <Locked
                        onUnlocked={() => {}}
                        onVaultUnavailable={(next) => {
                            onRouted(next);
                            setStatus({ state: 'error', ...next });
                        }}
                    />
                )}
        </MessagingProvider>
    );
}

function unlockWith({ shell = 'web', rejection }) {
    const unlockWallet = vi.fn().mockRejectedValue(rejection);
    const onRouted = vi.fn();
    render(<Shell shell={shell} unlockWallet={unlockWallet} onRouted={onRouted} />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-my-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));
    return { unlockWallet, onRouted };
}

describe('Locked screen when the unlock finds the vault gone', () => {
    it('web: an evicted vault opens the vault-unavailable screen with Try again and Restore', async () => {
        const { onRouted } = unlockWith({ rejection: new VaultEvictedError() });

        expect(await screen.findByRole('heading', { name: "Your wallet couldn't be opened" })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Restore from recovery phrase or backup/ })).toBeTruthy();
        expect(screen.queryByText(GENERIC)).toBeNull();
        expect(screen.queryByRole('button', { name: 'Unlock Wallet' })).toBeNull();
        expect(onRouted).toHaveBeenCalledWith(expect.objectContaining({ errorKind: 'evicted' }));
    });

    it('extension and desktop: the refusal keeps its kind across the wire envelope', async () => {
        const { onRouted } = unlockWith({ shell: 'popup', rejection: overTheWire(new VaultIncompleteError()) });

        expect(await screen.findByRole('heading', { name: "Your wallet couldn't be opened" })).toBeTruthy();
        expect(screen.queryByText(GENERIC)).toBeNull();
        expect(onRouted).toHaveBeenCalledWith(expect.objectContaining({ errorKind: 'incomplete' }));
    });

    it('a wrong password over a vault that is present keeps the wrong-password message', async () => {
        const rejection = overTheWire(Object.assign(new Error('invalid password'), { name: 'InvalidPasswordError' }));
        const { onRouted } = unlockWith({ rejection });

        expect(await screen.findByText('Incorrect password.')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Unlock Wallet' })).toBeTruthy();
        expect(screen.queryByRole('heading', { name: "Your wallet couldn't be opened" })).toBeNull();
        expect(onRouted).not.toHaveBeenCalled();
    });

    it('a password attempt never routes to the corrupt-vault screen', async () => {
        const { onRouted } = unlockWith({ rejection: new VaultCorruptError() });

        expect(await screen.findByText(GENERIC)).toBeTruthy();
        expect(onRouted).not.toHaveBeenCalled();
    });

    it('a shell that does not wire the route keeps the generic sentence', async () => {
        const unlockWallet = vi.fn().mockRejectedValue(new VaultEvictedError());
        render(
            <MessagingProvider shell="web" messaging={{ unlockWallet }}>
                <Locked onUnlocked={() => {}} />
            </MessagingProvider>,
        );
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'not-my-password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Unlock Wallet' }));

        expect(await screen.findByText(GENERIC)).toBeTruthy();
    });
});

describe('every shell wires the route', () => {
    for (const file of ['web/src/App.jsx', 'extension/src/popup/App.jsx', 'desktop/renderer/App.jsx']) {
        it(`${file} hands Locked the vault-unavailable route`, () => {
            const src = readFileSync(`packages/${file}`, 'utf8');
            expect(src).toMatch(/<Locked\b[\s\S]{0,300}?onVaultUnavailable=\{showVaultUnavailable\}/);
            expect(src).toMatch(/setStatus\(\{ state: 'error', \.\.\.next \}\)/);
        });
    }
});
