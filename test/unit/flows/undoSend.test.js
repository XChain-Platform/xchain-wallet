// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { Send } from '../../../packages/core/src/shared/routes/Send.jsx';
import {
    createUndoSendController,
    createUndoSendRequest,
    isUndoSendCancellation,
} from '../../../packages/core/src/flows/undoSend.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

describe('createUndoSendRequest', () => {
    it('returns no host hold when undo send is not opted in', () => {
        const createId = vi.fn(() => 'id-1');
        expect(createUndoSendRequest(createDefaultSettings(), createId)).toBeNull();
        expect(createId).not.toHaveBeenCalled();
    });

    it('creates a unique host hold request using the resolved window', () => {
        const settings = createDefaultSettings();
        settings.grace.undoSendEnabled = true;
        settings.grace.undoSendSeconds = 12;

        expect(createUndoSendRequest(settings, () => 'id-1')).toEqual({
            holdId: 'undo-send:id-1',
            undoSeconds: 12,
        });
    });

    it('caps hand-edited windows before they cross the host boundary', () => {
        const settings = createDefaultSettings();
        settings.grace.undoSendEnabled = true;
        settings.grace.undoSendSeconds = 600;

        expect(createUndoSendRequest(settings, () => 'id-1').undoSeconds).toBe(30);
    });
});

describe('createUndoSendController', () => {
    it('counts down and elapses without calling the cancel route', () => {
        let now = 10_000;
        let tick;
        const onTick = vi.fn();
        const onElapsed = vi.fn();
        const holdCancel = vi.fn();
        const controller = createUndoSendController({
            now: () => now,
            setTick: (fn) => {
                tick = fn;
                return 7;
            },
            clearTick: vi.fn(),
            onTick,
            onElapsed,
            onCancel: holdCancel,
        });

        controller.start(2);
        expect(onTick).toHaveBeenLastCalledWith(2);
        now += 1_000;
        tick();
        expect(onTick).toHaveBeenLastCalledWith(1);
        now += 1_000;
        tick();
        expect(controller.state()).toBe('elapsed');
        expect(onElapsed).toHaveBeenCalledOnce();
        expect(holdCancel).not.toHaveBeenCalled();
    });

    it('Cancel calls holdCancel once and prevents the held send from elapsing', () => {
        const holdCancel = vi.fn();
        const onElapsed = vi.fn();
        const clearTick = vi.fn();
        const controller = createUndoSendController({
            now: () => 10_000,
            setTick: vi.fn(() => 7),
            clearTick,
            onElapsed,
            onCancel: holdCancel,
        });

        controller.start(5);
        expect(controller.cancel()).toBe(true);
        expect(controller.cancel()).toBe(false);
        expect(controller.state()).toBe('cancelled');
        expect(holdCancel).toHaveBeenCalledOnce();
        expect(onElapsed).not.toHaveBeenCalled();
        expect(clearTick).toHaveBeenCalledWith(7);
    });
});

describe('isUndoSendCancellation', () => {
    it('recognizes only the host cancellation error', () => {
        expect(isUndoSendCancellation({ name: 'SendHoldCancelledError' })).toBe(true);
        expect(isUndoSendCancellation(new Error('send hold cancelled'))).toBe(false);
        expect(isUndoSendCancellation(null)).toBe(false);
    });
});

// Drives the real Send route: Approve must show the countdown toast, and its
// Cancel button must reach the host through messaging.sendHoldCancel with the
// same hold id that was sent to sendToken. The controller tests above cannot
// see that wiring.
describe('Send route undo-send countdown toast', () => {
    const CHAIN = 'bitcoin-mainnet';
    const FROM = 'bc1qsendersendersendersendersendersendersa';
    const TO = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';

    afterEach(() => cleanup());

    async function mountAndApprove() {
        const settings = createDefaultSettings();
        settings.grace.undoSendEnabled = true;
        settings.grace.undoSendSeconds = 10;
        settings.grace.testSendThresholdSats = '100000000000';
        // A seeded wallet has a fee record for each active chain; an empty
        // record would show the no-networks screen instead of the form.
        settings.fees = { [CHAIN]: { strategy: null, customSatsPerKb: null, rbfByDefault: null } };
        let rejectSend;
        const base = {
            getAddressesByChain: vi.fn().mockResolvedValue({
                [CHAIN]: [{
                    id: 'addr-1', address: FROM, publicKey: '02ab',
                    derivationPath: "m/84'/0'/0'/0/0", source: 'hd',
                }],
            }),
            getAddressBalances: vi.fn().mockResolvedValue({
                native: { tick: 'BTC', quantity: '100000000', divisibility: 8 },
                tokens: [],
            }),
            getSettings: vi.fn().mockResolvedValue(settings),
            getSignerStatus: vi.fn().mockResolvedValue({ unlocked: true }),
            listContacts: vi.fn().mockResolvedValue([]),
            getRecentDestinations: vi.fn().mockResolvedValue([]),
            gatedSendReadiness: vi.fn().mockResolvedValue({ state: 'ungated' }),
            composeForConfirm: vi.fn().mockResolvedValue({
                psbt: '70736274ff', encoding: 'P2SH', actionString: 'SEND|1|x', version: 1,
            }),
            preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
            checkInputLiveness: vi.fn().mockResolvedValue({ verdict: 'live', spent: [] }),
            reserve: vi.fn().mockResolvedValue({}),
            releaseReservation: vi.fn().mockResolvedValue({}),
            getAddressHistory: vi.fn().mockResolvedValue([{ action: 'SEND', destination: TO }]),
            sendToken: vi.fn(() => new Promise((_resolve, reject) => { rejectSend = reject; })),
            sendHoldCancel: vi.fn().mockResolvedValue(undefined),
        };
        const messaging = new Proxy(base, {
            get(target, prop) {
                if (prop in target) return target[prop];
                if (typeof prop !== 'string') return undefined;
                target[prop] = vi.fn().mockResolvedValue(null);
                return target[prop];
            },
        });
        render(
            React.createElement(
                MessagingProvider,
                { shell: 'web', messaging },
                React.createElement(Send, { walletId: 'w', onBack() {} }),
            ),
        );
        fireEvent.change(await screen.findByLabelText(/^To$/), { target: { value: TO } });
        fireEvent.change(await screen.findByLabelText(/^Amount \(/), { target: { value: '0.001' } });
        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        const approve = await screen.findByRole('button', { name: /^(Approve|Confirm|Sign)/i });
        fireEvent.change(await screen.findByLabelText(/^Password/), { target: { value: 'pw' } });
        await waitFor(() => expect(approve.disabled).toBe(false));
        fireEvent.click(approve);
        return { messaging, rejectSend: (e) => rejectSend(e) };
    }

    it('shows the countdown from Approve and Cancel calls sendHoldCancel', async () => {
        const { messaging, rejectSend } = await mountAndApprove();
        await waitFor(() => expect(messaging.sendToken).toHaveBeenCalledOnce());
        const { holdId, undoSeconds } = messaging.sendToken.mock.calls[0][0];
        expect(holdId).toMatch(/^undo-send:/);
        expect(undoSeconds).toBe(10);

        const countdown = await screen.findByText('Sending in 10 s');
        expect(countdown).toBeInTheDocument();
        expect(countdown).toHaveAttribute('role', 'status');
        expect(countdown).toHaveAttribute('aria-live', 'polite');
        expect(countdown).toHaveAttribute('aria-atomic', 'true');
        expect(messaging.sendHoldCancel).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));

        expect(messaging.sendHoldCancel).toHaveBeenCalledOnce();
        expect(messaging.sendHoldCancel).toHaveBeenCalledWith(holdId);
        const err = new Error('send hold cancelled');
        err.name = 'SendHoldCancelledError';
        rejectSend(err);
        await waitFor(() => expect(screen.queryByText(/Sending in \d+ s|Send cancelled/)).toBeNull());
        expect(await screen.findByLabelText(/^To$/)).toBeInTheDocument();
    });

    it('uses a fresh hold and one send dispatch when resending after undo', async () => {
        const { messaging, rejectSend } = await mountAndApprove();
        await waitFor(() => expect(messaging.sendToken).toHaveBeenCalledOnce());
        const firstHoldId = messaging.sendToken.mock.calls[0][0].holdId;

        fireEvent.click(await screen.findByRole('button', { name: /^Cancel$/ }));
        const firstCancelled = new Error('send hold cancelled');
        firstCancelled.name = 'SendHoldCancelledError';
        rejectSend(firstCancelled);
        await screen.findByLabelText(/^To$/);

        fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
        const approve = await screen.findByRole('button', { name: /^(Approve|Confirm|Sign)/i });
        fireEvent.change(await screen.findByLabelText(/^Password/), { target: { value: 'pw' } });
        await waitFor(() => expect(approve.disabled).toBe(false));
        fireEvent.click(approve);
        await waitFor(() => expect(messaging.sendToken).toHaveBeenCalledTimes(2));

        const secondHoldId = messaging.sendToken.mock.calls[1][0].holdId;
        expect(secondHoldId).toMatch(/^undo-send:/);
        expect(secondHoldId).not.toBe(firstHoldId);
        expect(messaging.sendHoldCancel).toHaveBeenCalledTimes(1);
        expect(messaging.sendHoldCancel).toHaveBeenCalledWith(firstHoldId);

        fireEvent.click(await screen.findByRole('button', { name: /^Cancel$/ }));
        const secondCancelled = new Error('send hold cancelled');
        secondCancelled.name = 'SendHoldCancelledError';
        rejectSend(secondCancelled);
        await waitFor(() => expect(screen.queryByText(/Sending in \d+ s|Send cancelled/)).toBeNull());
        expect(messaging.sendToken).toHaveBeenCalledTimes(2);
    });
});
