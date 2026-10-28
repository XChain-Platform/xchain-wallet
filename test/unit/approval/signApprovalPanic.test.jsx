// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// @vitest-environment jsdom

// A dApp sign request that reaches the approval window while panic mode has
// signing frozen. A freeze the user armed is stated first and no password is
// asked for, whether the store saved it or not; a duress-armed freeze leaves
// the window as it always looks, so an observer reads nothing off it.

import React from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import {
    PANIC_ARMED_DURESS,
    __resetPanicModePersistenceForTests,
    activatePanicMode,
    clearPanicModeState,
    configurePanicModePersistence,
    holdPanicModeFreeze,
} from '../../../packages/core/src/flows/panicMode.js';

vi.mock('../../../packages/extension/src/approval/messaging.js', () => ({
    listWallets: vi.fn(async () => [{ id: 'wallet-1', name: 'Wallet 1' }]),
    getSettings: vi.fn(async () => ({ walletMode: 'full' })),
    getAddressesByChain: vi.fn(async () => ({ 'bitcoin-regtest': [] })),
    parsePsbt: vi.fn(async () => ({
        decomposed: { inputs: [], outputs: [] },
        action: null,
        actionDecodeReason: 'NO_OP_RETURN',
    })),
    resolveApproval: vi.fn(),
    getAddressBalances: vi.fn(async () => ({})),
    getTokenInfo: vi.fn(async () => null),
    requoteNativeFee: vi.fn(async () => null),
    preflight: vi.fn(async () => ({ verdict: 'pass', findings: [], unverified: [] })),
    describeAction: vi.fn(async () => ({ summary: 'Action', details: [], warnings: [] })),
    parseCoSign: vi.fn(async () => ({
        account: { id: 'account-1', name: 'Account', chainId: 'bitcoin-regtest' },
        decodeOk: true,
        policyOk: true,
        action: null,
        destinations: [],
    })),
}));

vi.stubGlobal('React', React);

const { SignApproval } = await import(
    '../../../packages/extension/src/approval/kinds/SignApproval.jsx'
);
const messaging = await import('../../../packages/extension/src/approval/messaging.js');

afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
    cleanup();
    clearPanicModeState();
    __resetPanicModePersistenceForTests();
    vi.clearAllMocks();
});

const KINDS = [
    ['signMessage', { chainId: 'bitcoin-regtest', payload: { message: 'hello' } }],
    ['signPsbt', { chainId: 'bitcoin-regtest', payload: { psbtHex: '70736274ff' } }],
    ['signAction', { chainId: 'bitcoin-regtest', action: 'SEND', payload: {} }],
    ['coSign', { chainId: 'bitcoin-regtest', payload: { accountId: 'account-1', psbtHex: '70736274ff' } }],
    ['signIn', {
        chainId: 'bitcoin-regtest',
        payload: { addresses: [{ chainId: 'bitcoin-regtest', address: 'bcrt1qsignin' }] },
    }],
];

const FREEZE = /Panic mode is on\. Signing is frozen\./;
const APPROVE = /^(Approve|Sign in)$/i;

function renderApproval(kind, payload) {
    return render(
        <SignApproval
            id={`panic-${kind}`}
            kind={kind}
            payload={{ origin: 'https://app.example', ...payload }}
            onReject={() => {}}
        />,
    );
}

/** The freeze notice comes before every other block of the window's content. */
function expectFreezeFirst() {
    const notice = screen.getByTestId('approval-panic-freeze');
    expect(notice.textContent).toMatch(FREEZE);
    expect(notice.textContent).toMatch(/Settings > Safety/);
    const content = notice.parentElement;
    expect(content.firstElementChild).toBe(notice);
}

describe('SignApproval under a panic freeze', () => {
    it.each(KINDS)('%s states a saved freeze first and asks for no password', async (kind, payload) => {
        activatePanicMode();
        renderApproval(kind, payload);

        await screen.findByTestId('approval-panic-freeze');
        // The wallet mode read settles; the window still never offers the field.
        await vi.waitFor(() => expect(messaging.getSettings).toHaveBeenCalled());
        await act(async () => {});
        expectFreezeFirst();
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(screen.queryByRole('button', { name: APPROVE })).toBeNull();
        expect(screen.getByRole('button', { name: 'Reject' })).toBeTruthy();
        expect(messaging.resolveApproval).not.toHaveBeenCalled();
    });

    it.each(KINDS)('%s states a freeze the store refused to save', async (kind, payload) => {
        holdPanicModeFreeze({
            activatedAt: Date.now(),
            expiresAt: Date.now() + 60 * 60 * 1000,
            durationMs: 60 * 60 * 1000,
            armedBy: 'self',
        }, { unsaved: true });
        renderApproval(kind, payload);

        await screen.findByTestId('approval-panic-freeze');
        await act(async () => {});
        expectFreezeFirst();
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(screen.queryByRole('button', { name: APPROVE })).toBeNull();
    });

    it.each(KINDS)('%s keeps its usual look for a duress-armed freeze', async (kind, payload) => {
        activatePanicMode({ armedBy: PANIC_ARMED_DURESS });
        renderApproval(kind, payload);

        expect(await screen.findByLabelText('Password')).toBeTruthy();
        expect(screen.queryByTestId('approval-panic-freeze')).toBeNull();
        expect(document.body.textContent).not.toMatch(/panic/i);
    });

    it('drops the password field when the freeze loads after the window opens', async () => {
        let finishLoad;
        const stored = new Promise((resolve) => { finishLoad = resolve; });
        void configurePanicModePersistence({
            load: () => stored,
            save: async () => {},
            clear: async () => {},
        });
        renderApproval('signMessage', { chainId: 'bitcoin-regtest', payload: { message: 'hello' } });
        expect(await screen.findByLabelText('Password')).toBeTruthy();

        await act(async () => {
            finishLoad({
                activatedAt: Date.now(),
                expiresAt: Date.now() + 60 * 60 * 1000,
                durationMs: 60 * 60 * 1000,
                armedBy: 'self',
            });
            await stored;
        });

        expectFreezeFirst();
        expect(screen.queryByLabelText('Password')).toBeNull();
        expect(screen.queryByRole('button', { name: APPROVE })).toBeNull();
    });
});
