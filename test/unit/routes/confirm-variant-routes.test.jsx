// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

//  §5.6 slice 3: the two surfaces that adopt a NON-action confirm
// variant. Neither composes anything (the PSBT and the message already
// exist), so what this pins is that they route through the shared confirm
// page rather than signing straight from the form, and that the page's
// contract still holds: the password is collected THERE, Approve dispatches
// the host call, Reject signs nothing and loses nothing.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { PsbtSignForm } from '../../../packages/core/src/shared/routes/PsbtSignForm.jsx';
import { SignMessageForm } from '../../../packages/core/src/shared/routes/SignMessageForm.jsx';

const CHAIN = 'bitcoin-mainnet';
const OWN = 'bc1qexampleexampleexampleexampleexampleex';
const OTHER = 'bc1qotherotherotherotherotherotherotherx';

const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: OWN,
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

// Any even-length hex normalizes; the host mock decides what it "contains".
const PSBT_HEX = '70736274ff01000000';

const DECOMPOSED = Object.freeze({
    inputs: [{ address: OWN, value: 100000 }],
    outputs: [
        { address: OTHER, value: 90000 },
        { address: OWN, value: 5000 },
    ],
});

beforeEach(() => {
    vi.useFakeTimers({
        toFake: [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
            'setImmediate', 'clearImmediate', 'requestAnimationFrame',
            'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        ],
    });
});

function recordingMessaging(overrides = {}) {
    const calls = [];
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        signerReady: () => Promise.resolve({ ready: false }),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        preflight: (args) => {
            calls.push({ method: 'preflight', args });
            return Promise.resolve({ verdict: 'pass', findings: [], unverified: [] });
        },
    };
    Object.assign(target, overrides);
    const messaging = new Proxy(target, {
        get(t, prop) {
            if (prop in t) return t[prop];
            return (args) => {
                calls.push({ method: String(prop), args });
                return Promise.resolve({});
            };
        },
    });
    return { messaging, calls };
}

async function drainMicrotasks(rounds = 12) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function mount(Form, messaging, props = {}) {
    return render(
        React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(Form, { walletId: 'w', onBack() {}, ...props }),
        ),
    );
}

const typeIn = (utils, label, value) => {
    fireEvent.change(utils.getByLabelText(label), { target: { value } });
};

function findButton(utils, re) {
    return Array.from(utils.container.querySelectorAll('button'))
        .find((b) => re.test(b.textContent || ''));
}

describe('§5.5 PsbtSignForm routes through the PSBT confirm variant', () => {
    async function drive(parseResult) {
        const { messaging, calls } = recordingMessaging({
            parsePsbtRequest: (args) => {
                calls.push({ method: 'parsePsbtRequest', args });
                return Promise.resolve(parseResult);
            },
            signPsbtUserInitiated: (args) => {
                calls.push({ method: 'signPsbtUserInitiated', args });
                return Promise.resolve({ signedPsbtHex: 'bb11', txHex: 'cc22' });
            },
        });
        let utils;
        await domAct(async () => {
            utils = mount(PsbtSignForm, messaging);
            await drainMicrotasks();
        });
        await domAct(async () => {
            typeIn(utils, /Unsigned transaction/i, PSBT_HEX);
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.click(findButton(utils, /Sign transaction/i));
            await drainMicrotasks();
        });
        return { utils, calls };
    }

    it('opens the confirm page with the input/output enumeration instead of signing inline', async () => {
        const { utils, calls } = await drive({
            decomposed: DECOMPOSED,
            action: { actionString: 'SEND|0|JDOG|1|bc1q', action: 'SEND', version: 0 },
            actionDecodeReason: null,
        });

        expect(utils.getByTestId('confirm-modal')).toBeTruthy();
        expect(utils.getByTestId('psbt-intent-panel')).toBeTruthy();
        expect(utils.container.textContent).toContain('Signs with your key');
        // Nothing signed yet: opening the page is not authorizing.
        expect(calls.some((c) => c.method === 'signPsbtUserInitiated')).toBe(false);
    });

    it('runs pre-flight only when the PSBT carries a readable action', async () => {
        const { calls } = await drive({
            decomposed: DECOMPOSED,
            action: { actionString: 'SEND|0|JDOG|1|bc1q', action: 'SEND', version: 0 },
            actionDecodeReason: null,
        });
        expect(calls.some((c) => c.method === 'preflight')).toBe(true);
    });

    it('signs with the password typed ON the confirm page', async () => {
        const { utils, calls } = await drive({
            decomposed: DECOMPOSED,
            action: { actionString: 'SEND|0|JDOG|1|bc1q', action: 'SEND', version: 0 },
            actionDecodeReason: null,
        });
        await domAct(async () => {
            typeIn(utils, 'Password', 'hunter2');
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drainMicrotasks();
        });
        const submit = calls.find((c) => c.method === 'signPsbtUserInitiated');
        expect(submit).toBeTruthy();
        expect(submit.args).toMatchObject({ psbtHex: PSBT_HEX, password: 'hunter2' });
    });

    it('signs an ORDINARY PAYMENT that spends our own inputs (no false block)', async () => {
        // The regression this pins: NO_OP_RETURN means there is no XChain
        // action at all, which decodeActionFromPsbt reports the same way it
        // reports an unreadable one. Refusing here would block the commonest
        // use of this screen outright.
        const { utils, calls } = await drive({
            decomposed: DECOMPOSED,
            action: null,
            actionDecodeReason: 'NO_OP_RETURN',
        });
        expect(utils.queryByTestId('confirm-refusal')).toBe(null);
        expect(utils.getByTestId('psbt-action-none').textContent).toMatch(/ordinary payment/i);
        await domAct(async () => {
            typeIn(utils, 'Password', 'hunter2');
            await drainMicrotasks();
        });
        expect(utils.getByTestId('confirm-approve').disabled).toBe(false);
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drainMicrotasks();
        });
        expect(calls.find((c) => c.method === 'signPsbtUserInitiated')).toBeTruthy();
    });

    it('REFUSES a wallet-spending PSBT whose action is present but unreadable', async () => {
        const { utils, calls } = await drive({
            decomposed: DECOMPOSED,
            action: null,
            actionDecodeReason: 'P2SH_P2WSH_UNSUPPORTED',
        });
        expect(utils.getByTestId('confirm-refusal')).toBeTruthy();
        expect(utils.getByTestId('confirm-approve').disabled).toBe(true);
        // No password field is even offered on a refusal.
        expect(utils.queryByLabelText('Password')).toBe(null);
        // A refusal must not be a dead end: Reject still works.
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-reject'));
            await drainMicrotasks();
        });
        expect(utils.queryByTestId('confirm-modal')).toBe(null);
        expect(calls.some((c) => c.method === 'signPsbtUserInitiated')).toBe(false);
    });
});

describe('§5.5 SignMessageForm routes through the message confirm variant', () => {
    async function drive(message) {
        const { messaging, calls } = recordingMessaging({
            signMessageRequest: (args) => {
                calls.push({ method: 'signMessageRequest', args });
                return Promise.resolve({ signature: 'sig-abc' });
            },
        });
        let utils;
        await domAct(async () => {
            utils = mount(SignMessageForm, messaging);
            await drainMicrotasks();
        });
        await domAct(async () => {
            typeIn(utils, 'Message', message);
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.click(findButton(utils, /Sign message/i));
            await drainMicrotasks();
        });
        return { utils, calls };
    }

    it('shows the exact text on the confirm page before anything is signed', async () => {
        const MESSAGE = 'proof of control\n  indented line';
        const { utils, calls } = await drive(MESSAGE);
        expect(utils.getByTestId('confirm-message-text').textContent).toBe(MESSAGE);
        expect(calls.some((c) => c.method === 'signMessageRequest')).toBe(false);
    });

    it('signs the message with the password typed on the confirm page', async () => {
        const { utils, calls } = await drive('proof of control');
        await domAct(async () => {
            typeIn(utils, 'Password', 'hunter2');
            await drainMicrotasks();
        });
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-approve'));
            await drainMicrotasks();
        });
        const submit = calls.find((c) => c.method === 'signMessageRequest');
        expect(submit).toBeTruthy();
        expect(submit.args).toMatchObject({ message: 'proof of control', password: 'hunter2' });
        // Terminal: the signature is rendered back on the form surface.
        expect(utils.container.textContent).toContain('sig-abc');
    });

    it('Reject signs nothing and returns to the form with the draft intact', async () => {
        const { utils, calls } = await drive('keep me');
        await domAct(async () => {
            fireEvent.click(utils.getByTestId('confirm-reject'));
            await drainMicrotasks();
        });
        expect(utils.queryByTestId('confirm-modal')).toBe(null);
        expect(calls.some((c) => c.method === 'signMessageRequest')).toBe(false);
        expect(utils.getByLabelText('Message').value).toBe('keep me');
    });
});
