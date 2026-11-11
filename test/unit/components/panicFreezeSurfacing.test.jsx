// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// regression guard, rendered.
//
// Keep sign surfaces quiet when signing is available and surface a self-armed
// freeze before the user reaches Approve & Sign. These tests hold both parts
// of the disclosure policy in place:
//
//   1. the sign surface omits an unlocked-wallet readiness note;
//   2. it explains why only when the user armed the freeze themselves, so
//      the duress flow keeps giving an observer no cue.

import { describe, it, expect, afterEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import {
    PANIC_ARMED_DURESS,
    activatePanicMode,
    clearPanicModeState,
} from '../../../packages/core/src/flows/panicMode.js';
import {
    PanicFreezeNotice,
    PanicPasswordGate,
    SigningReadyNote,
} from '../../../packages/core/src/shared/safety/PanicFreezeNotice.jsx';
import { SignCredentials } from '../../../packages/core/src/shared/components/SignCredentials.jsx';

afterEach(() => { cleanup(); clearPanicModeState(); });

const softwareAddress = { address: 'bc1qexample', source: 'hd' };

const UNLOCKED_NOTE = /no password needed/i;

describe('SigningReadyNote', () => {
    it('renders nothing when signing is allowed', () => {
        const { container } = render(<SigningReadyNote />);
        expect(screen.queryByText(UNLOCKED_NOTE)).toBeNull();
        expect(container.textContent).toBe('');
    });

    it('shows the freeze when the user armed it themselves', () => {
        activatePanicMode();
        render(<SigningReadyNote />);
        expect(screen.queryByText(UNLOCKED_NOTE)).toBeNull();
        expect(screen.getByText(/panic mode is on/i)).toBeTruthy();
    });

    it('keeps the sentence about Approving where Approve is still shown', () => {
        activatePanicMode();
        const { container } = render(<SigningReadyNote />);
        expect(container.textContent).toMatch(/Approving will be refused/);
    });

    it('renders nothing when the freeze is duress-armed', () => {
        activatePanicMode({ armedBy: PANIC_ARMED_DURESS });
        const { container } = render(<SigningReadyNote />);
        expect(screen.queryByText(UNLOCKED_NOTE)).toBeNull();
        // Keep the duress freeze invisible to an observer on this screen.
        expect(container.textContent).toBe('');
    });
});

describe('SignCredentials under a signing freeze', () => {
    it('shows no unlocked note and keeps the self-armed freeze statement', () => {
        render(<SignCredentials unlocked fromAddress={softwareAddress} chainId="bitcoin-mainnet" />);
        expect(screen.queryByText(UNLOCKED_NOTE)).toBeNull();

        cleanup();
        activatePanicMode();
        render(<SignCredentials unlocked fromAddress={softwareAddress} chainId="bitcoin-mainnet" />);
        expect(screen.queryByText(UNLOCKED_NOTE)).toBeNull();
        expect(screen.getByText(/panic mode is on/i)).toBeTruthy();
    });

    it('still surfaces submitError while frozen (must not regress)', () => {
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

    it('asks for no password and states the freeze when the user armed it', () => {
        activatePanicMode();
        render(<SignCredentials fromAddress={softwareAddress} chainId="bitcoin-mainnet" />);
        expect(screen.queryByLabelText(/password/i, { selector: 'input' })).toBeNull();
        expect(screen.getByText(/panic mode is on/i)).toBeTruthy();
    });

    it('keeps the locked password field for a duress-armed freeze', () => {
        activatePanicMode({ armedBy: PANIC_ARMED_DURESS });
        const { container } = render(<SignCredentials fromAddress={softwareAddress} chainId="bitcoin-mainnet" />);
        expect(screen.getByLabelText(/password/i, { selector: 'input' })).toBeTruthy();
        expect(container.textContent).not.toMatch(/panic/i);
    });

    it('keeps the locked password field when signing is allowed', () => {
        render(<SignCredentials fromAddress={softwareAddress} chainId="bitcoin-mainnet" />);
        expect(screen.getByLabelText(/password/i, { selector: 'input' })).toBeTruthy();
    });
});

describe('PanicPasswordGate', () => {
    const field = <label>Password<input type="password" /></label>;

    it('shows the field when signing is allowed', () => {
        render(<PanicPasswordGate>{field}</PanicPasswordGate>);
        expect(screen.getByLabelText('Password')).toBeTruthy();
    });

    it('states a self-armed freeze in place of the field', () => {
        activatePanicMode();
        render(<PanicPasswordGate>{field}</PanicPasswordGate>);
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(screen.getByText(/panic mode is on/i)).toBeTruthy();
    });

    it('tells the reader that Reject closes the request, and never says Approving is refused', () => {
        activatePanicMode();
        const { container } = render(<PanicPasswordGate rejectLabel="Reject">{field}</PanicPasswordGate>);
        expect(container.textContent).toMatch(/Nothing can be signed or sent here until panic mode is turned off in the wallet\. Reject closes this request\./);
        expect(container.textContent).not.toMatch(/approving will be refused/i);
    });

    it('keeps the field and says nothing for a duress-armed freeze', () => {
        activatePanicMode({ armedBy: PANIC_ARMED_DURESS });
        const { container } = render(<PanicPasswordGate>{field}</PanicPasswordGate>);
        expect(screen.getByLabelText('Password')).toBeTruthy();
        expect(container.textContent).toBe('Password');
    });

    it('follows a freeze armed while the screen is open', () => {
        render(<PanicPasswordGate>{field}</PanicPasswordGate>);
        expect(screen.getByLabelText('Password')).toBeTruthy();
        act(() => { activatePanicMode(); });
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(screen.getByText(/panic mode is on/i)).toBeTruthy();
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
        expect(screen.getByText(/this send can\u0027t be signed/i)).toBeTruthy();
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
