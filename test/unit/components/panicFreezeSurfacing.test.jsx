// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  regression guard, rendered.
//
// The defect: with signing frozen by panic mode, the confirm screen still
// said "Wallet unlocked. No password needed." -- the opposite of what was
// true -- and the refusal only arrived on Approve & Sign. These tests hold
// the two halves of the fix in place:
//
//   1. the sign surface stops claiming the wallet can sign, for BOTH
//      self-armed and duress-armed freezes;
//   2. it explains why only when the user armed the freeze themselves, so
//      the duress flow keeps giving an observer no cue.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
    PANIC_ARMED_DURESS,
    activatePanicMode,
    clearPanicModeState,
} from '../../../packages/core/src/flows/panicMode.js';
import {
    PanicFreezeNotice,
    SigningReadyNote,
} from '../../../packages/core/src/shared/safety/PanicFreezeNotice.jsx';
import { SignCredentials } from '../../../packages/core/src/shared/components/SignCredentials.jsx';

afterEach(() => { cleanup(); clearPanicModeState(); });

const softwareAddress = { address: 'bc1qexample', source: 'hd' };

const UNLOCKED_NOTE = /no password needed/i;

describe('SigningReadyNote', () => {
    it('keeps the wallet-unlocked note when signing is allowed', () => {
        render(<SigningReadyNote><p>Wallet unlocked. No password needed.</p></SigningReadyNote>);
        expect(screen.getByText(UNLOCKED_NOTE)).toBeTruthy();
    });

    it('replaces the note with the freeze when the user armed it themselves', () => {
        activatePanicMode();
        render(<SigningReadyNote><p>Wallet unlocked. No password needed.</p></SigningReadyNote>);
        expect(screen.queryByText(UNLOCKED_NOTE)).toBeNull();
        expect(screen.getByText(/panic mode is on/i)).toBeTruthy();
    });

    it('withdraws the note WITHOUT a cue when the freeze was duress-armed', () => {
        activatePanicMode({ armedBy: PANIC_ARMED_DURESS });
        const { container } = render(
            <SigningReadyNote><p>Wallet unlocked. No password needed.</p></SigningReadyNote>,
        );
        // The false claim is gone...
        expect(screen.queryByText(UNLOCKED_NOTE)).toBeNull();
        // ...and nothing at all took its place: an observer standing over the
        // user must not be able to read the freeze off this screen.
        expect(container.textContent).toBe('');
    });
});

describe('SignCredentials under a signing freeze', () => {
    it('claims the wallet can sign only when it actually can', () => {
        render(<SignCredentials unlocked fromAddress={softwareAddress} chainId="bitcoin-mainnet" />);
        expect(screen.getByText(UNLOCKED_NOTE)).toBeTruthy();

        cleanup();
        activatePanicMode();
        render(<SignCredentials unlocked fromAddress={softwareAddress} chainId="bitcoin-mainnet" />);
        expect(screen.queryByText(UNLOCKED_NOTE)).toBeNull();
        expect(screen.getByText(/panic mode is on/i)).toBeTruthy();
    });

    it('still surfaces submitError while frozen ( must not regress)', () => {
        activatePanicMode({ armedBy: PANIC_ARMED_DURESS });
        render(
            <SignCredentials
                unlocked
                fromAddress={softwareAddress}
                chainId="bitcoin-mainnet"
                submitError="Couldn't send. Signing is frozen by panic mode (1436 min remaining)"
            />,
        );
        expect(screen.getByText(/signing is frozen by panic mode/i)).toBeTruthy();
    });

    it('leaves the locked password field alone', () => {
        activatePanicMode();
        render(<SignCredentials fromAddress={softwareAddress} chainId="bitcoin-mainnet" />);
        expect(screen.getByLabelText(/password/i)).toBeTruthy();
    });
});

describe('PanicFreezeNotice (Home / Send)', () => {
    it('renders nothing when signing is allowed', () => {
        const { container } = render(<PanicFreezeNotice surface="home" />);
        expect(container.textContent).toBe('');
    });

    it('states the freeze on Home before the user reaches Send', () => {
        activatePanicMode();
        render(<PanicFreezeNotice surface="home" />);
        expect(screen.getByText(/panic mode is on/i)).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toMatch(/settings > safety/i);
    });

    it('warns on the Send form that the send will be refused', () => {
        activatePanicMode();
        render(<PanicFreezeNotice surface="send" />);
        expect(screen.getByText(/this send cannot be signed/i)).toBeTruthy();
    });

    it('shows nothing on Home or Send for a duress-armed freeze', () => {
        activatePanicMode({ armedBy: PANIC_ARMED_DURESS });
        const home = render(<PanicFreezeNotice surface="home" />);
        expect(home.container.textContent).toBe('');
        cleanup();
        const send = render(<PanicFreezeNotice surface="send" />);
        expect(send.container.textContent).toBe('');
    });
});
