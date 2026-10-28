// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Where the freeze replaces the password field, the sentence names the control
// the user can actually press. A confirm page names the label on its reject
// button; a form whose only exit is Back says to go back instead of naming a
// button it does not have.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { activatePanicMode, clearPanicModeState } from '../../../packages/core/src/flows/panicMode.js';
import { ActionConfirmScreen } from '../../../packages/core/src/shared/components/ActionConfirmScreen.jsx';
import { MessageConfirmScreen } from '../../../packages/core/src/shared/components/MessageConfirmScreen.jsx';
import { PsbtConfirmScreen } from '../../../packages/core/src/shared/components/PsbtConfirmScreen.jsx';
import { SignCredentials } from '../../../packages/core/src/shared/components/SignCredentials.jsx';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PanicPasswordGate } from '../../../packages/core/src/shared/safety/PanicFreezeNotice.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';

afterEach(() => { cleanup(); clearPanicModeState(); });

const BACK_SENTENCE = /Go back to leave this screen\./;
const NAMED_SENTENCE = /Nothing can be signed or sent here until panic mode is turned off in the wallet\. (.+?) closes this request\./;

function confirmState() {
    return {
        phase: 'ready',
        composed: {},
        report: null,
        acknowledged: new Set(),
        acknowledge() {},
        canApprove: true,
        approve: vi.fn(),
        reject: vi.fn(),
        error: null,
    };
}

/** The label the sentence names equals the text on the screen's reject button. */
function expectSentenceNamesRejectButton(container) {
    const named = container.textContent.match(NAMED_SENTENCE);
    expect(named, 'the sentence names a reject control').not.toBeNull();
    const button = screen.getByTestId('confirm-reject');
    expect(button.textContent.trim()).toBe(named[1]);
}

describe('confirm pages name their reject button', () => {
    const common = { chainLabel: 'Bitcoin', signerReady: false, password: '', onPasswordChange: () => {} };

    it('ActionConfirmScreen (the Send review)', () => {
        activatePanicMode();
        const { container } = render(
            <ActionConfirmScreen
                {...common}
                confirmAction={{ ...confirmState(), composed: { decoded: { summary: 'Send 1 TOKEN', details: [], warnings: [] } } }}
            />,
        );
        expectSentenceNamesRejectButton(container);
        expect(screen.queryByLabelText(/password/i)).toBeNull();
    });

    it('MessageConfirmScreen', () => {
        activatePanicMode();
        const { container } = render(
            <MessageConfirmScreen {...common} confirmAction={confirmState()} message="hello" />,
        );
        expectSentenceNamesRejectButton(container);
    });

    it('PsbtConfirmScreen', () => {
        activatePanicMode();
        const { container } = render(
            <PsbtConfirmScreen {...common} confirmAction={confirmState()} decomposed={{ inputs: [], outputs: [] }} />,
        );
        expectSentenceNamesRejectButton(container);
    });
});

describe('PanicPasswordGate', () => {
    const field = <label>Password<input type="password" /></label>;

    it('names the label it is given', () => {
        activatePanicMode();
        const { container } = render(<PanicPasswordGate rejectLabel="Cancel">{field}</PanicPasswordGate>);
        expect(container.textContent).toMatch(/turned off in the wallet\. Cancel closes this request\./);
        expect(container.textContent).not.toMatch(/Reject/);
    });

    it('says to go back, and names no button, when there is no reject control', () => {
        activatePanicMode();
        const { container } = render(<PanicPasswordGate>{field}</PanicPasswordGate>);
        expect(container.textContent).toMatch(BACK_SENTENCE);
        expect(container.textContent).not.toMatch(/Reject|closes this request/);
    });

    it('follows a changed label', () => {
        activatePanicMode();
        const { container, rerender } = render(<PanicPasswordGate rejectLabel="Cancel">{field}</PanicPasswordGate>);
        rerender(<PanicPasswordGate rejectLabel="Back">{field}</PanicPasswordGate>);
        expect(container.textContent).toMatch(/Back closes this request\./);
    });
});

describe('forms without a reject button', () => {
    it('SignCredentials says to go back', () => {
        activatePanicMode();
        const { container } = render(
            <SignCredentials fromAddress={{ address: 'bc1qexample', source: 'hd' }} chainId="bitcoin-mainnet" />,
        );
        expect(container.textContent).toMatch(BACK_SENTENCE);
        expect(container.textContent).not.toMatch(/Reject/);
    });

    it('PsbtSignForm says to go back and offers no Reject button', async () => {
        activatePanicMode();
        const messaging = new Proxy({
            getAddressesByChain: vi.fn().mockResolvedValue({}),
            getActiveAddresses: vi.fn().mockResolvedValue({}),
            getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
            signerReady: vi.fn().mockResolvedValue({ ready: false }),
        }, {
            get(target, prop) {
                if (prop in target) return target[prop];
                return vi.fn().mockResolvedValue({});
            },
        });
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <PsbtSignForm walletId="wallet" onBack={() => {}} />
            </MessagingProvider>,
        );
        await waitFor(() => expect(container.textContent).toMatch(BACK_SENTENCE));
        expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    });
});
