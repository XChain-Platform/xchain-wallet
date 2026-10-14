// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendTokenMock } = vi.hoisted(() => ({ sendTokenMock: vi.fn() }));

vi.mock('@xchain-wallet/core', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        flows: { ...actual.flows, sendToken: sendTokenMock },
    };
});

import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import {
    createHoldBeforeBroadcast,
    createSendHoldRegistry,
    SendHoldCancelledError,
} from '../../../packages/extension/src/background/sendHold.js';

function fakeTimers() {
    const timers = new Map();
    let next = 1;
    return {
        timers,
        setTimer(fn, ms) {
            const id = next;
            next += 1;
            timers.set(id, { fn, ms });
            return id;
        },
        clearTimer(id) {
            timers.delete(id);
        },
        fire(id) {
            const timer = timers.get(id);
            timers.delete(id);
            timer.fn();
        },
    };
}

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

function makeHost(sendHold) {
    return createBackgroundHost({
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        vault: {
            settings: { get: async () => ({}) },
            wallets: { list: async () => [] },
        },
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { for: () => ({}) },
        sendHold,
    });
}

// The broadcast hold counts signing time against the undo window from
// Date.now(), so a frozen clock keeps exact hold lengths deterministic when
// a loaded runner lets a millisecond pass between request and broadcast.
let frozenNow;
beforeEach(() => {
    frozenNow = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
});

afterEach(() => {
    frozenNow.mockRestore();
});

describe('send hold registry', () => {
    it('releases only after the configured timer elapses', async () => {
        const clock = fakeTimers();
        const hold = createSendHoldRegistry(clock);
        const pending = hold.hold('send-1', 5);

        expect(hold.isHeld('send-1')).toBe(true);
        expect(clock.timers.get(1).ms).toBe(5000);
        clock.fire(1);

        await expect(pending).resolves.toBeUndefined();
        expect(hold.isHeld('send-1')).toBe(false);
    });

    it('rejects a held send when it is cancelled', async () => {
        const clock = fakeTimers();
        const hold = createSendHoldRegistry(clock);
        const pending = hold.hold('send-1', 5);

        expect(hold.cancel('send-1')).toBe(true);
        await expect(pending).rejects.toBeInstanceOf(SendHoldCancelledError);
        expect(clock.timers.size).toBe(0);
    });

    it('remembers a cancel that races ahead of signing', async () => {
        const clock = fakeTimers();
        const hold = createSendHoldRegistry(clock);

        expect(hold.cancel('send-1')).toBe(false);
        await expect(hold.hold('send-1', 5)).rejects.toBeInstanceOf(
            SendHoldCancelledError,
        );
        expect(clock.timers.size).toBe(0);
    });
});

describe('hold-before-broadcast adapter', () => {
    it('does not install a hook without a hold id', () => {
        const hold = createSendHoldRegistry();
        expect(createHoldBeforeBroadcast({ sendHold: hold })).toBeUndefined();
    });

    it('clamps the requested window to 30 seconds', async () => {
        const clock = fakeTimers();
        const hold = createSendHoldRegistry(clock);
        const beforeBroadcast = createHoldBeforeBroadcast({
            sendHold: hold,
            holdId: 'send-1',
            undoSeconds: 600,
        });
        const pending = beforeBroadcast();

        expect(clock.timers.get(1).ms).toBe(30000);
        clock.fire(1);
        await pending;
    });

    it('rejects malformed hold requests before signing can start', () => {
        const hold = createSendHoldRegistry();
        expect(() => createHoldBeforeBroadcast({
            sendHold: hold,
            holdId: '',
            undoSeconds: 5,
        })).toThrow(TypeError);
        expect(() => createHoldBeforeBroadcast({
            sendHold: hold,
            holdId: 'send-1',
            undoSeconds: 1.5,
        })).toThrow(TypeError);
    });
});

describe('background send hold wiring', () => {
    beforeEach(() => {
        sendTokenMock.mockReset();
        sendTokenMock.mockResolvedValue({ txid: 'tx-1' });
    });

    it('passes a host-owned hold hook into the signed send flow', async () => {
        const sendHold = {
            hold: vi.fn(async () => undefined),
            cancel: vi.fn(() => false),
            isHeld: vi.fn(() => false),
        };
        sendTokenMock.mockImplementation(async (opts) => {
            await opts.beforeBroadcast({ signed: { txHex: '00' }, revealSigned: null });
            return { txid: 'tx-1' };
        });

        const response = await makeHost(sendHold).handle({
            type: 'action.send',
            request: { holdId: 'send-1', undoSeconds: 5 },
        });

        expect(response).toEqual({ ok: true, result: { txid: 'tx-1' } });
        expect(sendHold.hold).toHaveBeenCalledWith('send-1', 5);
    });

    it('leaves sends immediate when no opt-in hold is requested', async () => {
        const sendHold = {
            hold: vi.fn(async () => undefined),
            cancel: vi.fn(() => false),
            isHeld: vi.fn(() => false),
        };

        const response = await makeHost(sendHold).handle({
            type: 'action.send',
            request: {},
        });

        expect(response.ok).toBe(true);
        expect(sendTokenMock.mock.calls[0][0].beforeBroadcast).toBeUndefined();
        expect(sendHold.hold).not.toHaveBeenCalled();
    });

    it('routes cancellation to the same host-owned registry', async () => {
        const sendHold = {
            hold: vi.fn(async () => undefined),
            cancel: vi.fn(() => true),
            isHeld: vi.fn(() => true),
        };

        const response = await makeHost(sendHold).handle({
            type: 'send.holdCancel',
            request: { holdId: 'send-1' },
        });

        expect(response).toEqual({ ok: true, result: { cancelled: true } });
        expect(sendHold.cancel).toHaveBeenCalledWith('send-1');
    });

    it('rejects the same send started by popup and side panel', async () => {
        const pending = deferred();
        sendTokenMock.mockReturnValue(pending.promise);
        const host = makeHost();
        const request = {
            walletId: 'wallet-one',
            chainId: 'bitcoin-mainnet',
            from: { address: 'source-one' },
            to: 'recipient-one',
            tick: 'BTC',
            amount: '0.25',
        };

        const popupSend = host.handle({ type: 'action.send', request });
        await vi.waitFor(() => expect(sendTokenMock).toHaveBeenCalledTimes(1));
        const sidePanelSend = host.handle({
            type: 'action.send',
            request: { ...request },
        });
        for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();

        expect(sendTokenMock).toHaveBeenCalledTimes(1);
        await expect(sidePanelSend).resolves.toEqual({
            ok: false,
            error: {
                name: 'SendAlreadyInProgressError',
                message: 'A matching send is already in progress in another wallet window.',
            },
        });
        pending.resolve({ txid: 'tx-shared' });
        await expect(popupSend).resolves.toEqual({ ok: true, result: { txid: 'tx-shared' } });

        sendTokenMock.mockResolvedValueOnce({ txid: 'tx-retry' });
        await expect(host.handle({ type: 'action.send', request })).resolves.toEqual({
            ok: true,
            result: { txid: 'tx-retry' },
        });
        expect(sendTokenMock).toHaveBeenCalledTimes(2);
    });

    it('does not coalesce different concurrent sends', async () => {
        const first = deferred();
        sendTokenMock
            .mockReturnValueOnce(first.promise)
            .mockResolvedValueOnce({ txid: 'tx-two' });
        const host = makeHost();
        const base = {
            walletId: 'wallet-one',
            chainId: 'bitcoin-mainnet',
            from: { address: 'source-one' },
            tick: 'BTC',
            amount: '0.25',
        };

        const popupSend = host.handle({
            type: 'action.send',
            request: { ...base, to: 'recipient-one' },
        });
        const sidePanelSend = host.handle({
            type: 'action.send',
            request: { ...base, to: 'recipient-two' },
        });

        await vi.waitFor(() => expect(sendTokenMock).toHaveBeenCalledTimes(2));
        await expect(sidePanelSend).resolves.toEqual({ ok: true, result: { txid: 'tx-two' } });
        first.resolve({ txid: 'tx-one' });
        await expect(popupSend).resolves.toEqual({ ok: true, result: { txid: 'tx-one' } });
    });
});
