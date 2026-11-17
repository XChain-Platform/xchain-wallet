// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The hardware signing session store: subscribers see every phase of an op,
// unsubscribe stops delivery, cancel rejects the op with HW_SIGN_BACK, and
// runSignOp holds a failed op on the sign page until Try again or Back.

import { describe, expect, it, vi } from 'vitest';
import {
    begin, step, fail, end, subscribe, cancel, retry, current,
    runSignOp, isHwSignBack, hwSignBackError, failureKind, ensureLive,
} from '../../../packages/core/src/signers/hardwareSession.js';
import { RemoteSigner } from '../../../packages/core/src/signers/RemoteSigner.js';

const info = { signerId: 's1', vendor: 'ledger', model: 'nanoX', op: 'signPsbt' };

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('hardwareSession', () => {
    it('delivers begin, step, fail and end to subscribers', () => {
        const seen = [];
        const off = subscribe((e) => seen.push(e.type));
        const id = begin(info);
        step(id, 'connected');
        fail(id, { kind: 'timeout' });
        end(id);
        off();
        expect(seen).toEqual(['begin', 'step', 'fail', 'end']);
    });

    it('stops delivering after unsubscribe', () => {
        const seen = [];
        const off = subscribe((e) => seen.push(e.type));
        off();
        end(begin(info));
        expect(seen).toEqual([]);
    });

    it('cancel rejects with HW_SIGN_BACK and ends the op', () => {
        let rejected;
        const seen = [];
        const off = subscribe((e) => seen.push(e.type));
        const id = begin({ ...info, reject: (err) => { rejected = err; } });
        cancel(id);
        off();
        expect(rejected).toBeInstanceOf(Error);
        expect(rejected.code).toBe('HW_SIGN_BACK');
        expect(seen).toEqual(['begin', 'end']);
    });

    it('records each step once, in order, and current() shows the open op', () => {
        const id = begin(info);
        step(id, 'connected');
        step(id, 'connected');
        step(id, 'unlocked');
        expect(current()).toMatchObject({ opId: id, steps: ['connected', 'unlocked'], failure: null });
        end(id);
        expect(current()).toBeNull();
    });

    it('retry clears the failure and the steps and calls the retry hook', () => {
        const onRetry = vi.fn();
        const id = begin({ ...info, retry: onRetry });
        step(id, 'connected');
        fail(id, { kind: 'unplugged' });
        retry(id);
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(current()).toMatchObject({ steps: [], failure: null });
        end(id);
    });
});

describe('runSignOp', () => {
    it('runs a sign op through begin, its steps, signed and end', async () => {
        const seen = [];
        const off = subscribe((e) => seen.push([e.type, [...e.op.steps]]));
        const result = await runSignOp(info, async ({ step: mark }) => {
            mark('connected');
            mark('unlocked');
            mark('confirm');
            return 'signed-psbt';
        });
        off();
        expect(result).toBe('signed-psbt');
        expect(seen.map(([type]) => type)).toEqual(['begin', 'step', 'step', 'step', 'step', 'end']);
        expect(seen.at(-1)[1]).toEqual(['connected', 'unlocked', 'confirm', 'signed']);
    });

    it('never opens the sign page for a status poll', async () => {
        const seen = [];
        const off = subscribe((e) => seen.push(e.type));
        const result = await runSignOp({ ...info, op: 'status' }, async () => 'available');
        off();
        expect(result).toBe('available');
        expect(seen).toEqual([]);
    });

    it('holds a failure until Try again, then reconnects and signs', async () => {
        const events = [];
        const off = subscribe((e) => events.push(e));
        const ensure = vi.fn(async () => {});
        const attempt = vi.fn()
            .mockRejectedValueOnce(new Error('Device disconnected'))
            .mockResolvedValueOnce('ok');
        const pending = runSignOp(info, attempt, { ensure });
        await tick();
        const failed = events.find((e) => e.type === 'fail');
        expect(failed.op.failure).toEqual({ kind: 'unplugged' });
        expect(attempt).toHaveBeenCalledTimes(1);
        expect(ensure).not.toHaveBeenCalled();
        retry(failed.op.opId);
        await expect(pending).resolves.toBe('ok');
        off();
        expect(ensure).toHaveBeenCalledTimes(1);
        expect(attempt).toHaveBeenCalledTimes(2);
    });

    it('Back on a failed op rejects with HW_SIGN_BACK and never re-runs', async () => {
        const events = [];
        const off = subscribe((e) => events.push(e));
        const attempt = vi.fn().mockRejectedValue(new Error('Action cancelled by user'));
        const pending = runSignOp(info, attempt);
        await tick();
        const failed = events.find((e) => e.type === 'fail');
        expect(failed.op.failure).toEqual({ kind: 'rejected' });
        cancel(failed.op.opId);
        await expect(pending).rejects.toMatchObject({ code: 'HW_SIGN_BACK' });
        off();
        expect(attempt).toHaveBeenCalledTimes(1);
        expect(events.at(-1).type).toBe('end');
    });

    it('Back while the device is still prompting rejects at once', async () => {
        const events = [];
        const off = subscribe((e) => events.push(e));
        let finish;
        const pending = runSignOp(info, () => new Promise((r) => { finish = r; }));
        await tick();
        cancel(events[0].op.opId);
        await expect(pending).rejects.toMatchObject({ code: 'HW_SIGN_BACK' });
        finish('late');
        off();
    });

    it('rejects at once when no sign page is listening, so nothing hangs', async () => {
        const err = new Error('Device disconnected');
        await expect(runSignOp(info, async () => { throw err; })).rejects.toBe(err);
        expect(current()).toBeNull();
    });
});

describe('isHwSignBack', () => {
    it('matches the code, the name, and the message after the signer port wraps it', () => {
        const back = hwSignBackError();
        expect(isHwSignBack(back)).toBe(true);
        // RemoteSigner rewraps renderer errors as "<op> failed: <message>" with no code.
        expect(isHwSignBack(new Error(`signPsbt failed: ${back.message}`))).toBe(true);
        expect(isHwSignBack({ message: 'x', cause: back })).toBe(true);
        expect(isHwSignBack(new Error('Signing was cancelled on the device'))).toBe(false);
        expect(isHwSignBack(null)).toBe(false);
    });
});

describe('HW_SIGN_BACK through the real RemoteSigner', () => {
    it('still reads as Back after the signer port rewraps the error', async () => {
        const remote = new RemoteSigner({
            id: 's1',
            displayName: 'Trezor',
            kind: 'trezor',
            transport: async () => { throw hwSignBackError(); },
        });
        const err = await remote.signPsbt({ psbtHex: '00' }).catch((e) => e);
        expect(err).toBeInstanceOf(Error);
        expect(err.code).not.toBe('HW_SIGN_BACK');
        expect(isHwSignBack(err)).toBe(true);
    });
});

describe('failureKind', () => {
    it('sorts device errors into the four kinds', () => {
        expect(failureKind(new Error('Request timed out'))).toBe('timeout');
        expect(failureKind({ code: 'HW_NOT_CONNECTED', message: 'x' })).toBe('unplugged');
        expect(failureKind(new Error('Failure_ActionCancelled'))).toBe('rejected');
        expect(failureKind(new Error('0x6985 denied by user'))).toBe('rejected');
        expect(failureKind(new Error('Something odd'))).toBe('other');
    });
});

describe('ensureLive', () => {
    const record = { vendor: 'trezor', deviceIdentifier: 'dev-1' };

    it('runs the vendor factory and returns the live signer for the same device', async () => {
        const signer = { signPsbt: vi.fn() };
        const trezor = vi.fn(async () => ({ signer, pairingInfo: { deviceIdentifier: 'dev-1' } }));
        await expect(ensureLive(record, { trezor })).resolves.toMatchObject({ signer });
        expect(trezor).toHaveBeenCalledTimes(1);
    });

    it('refuses a different device', async () => {
        const trezor = async () => ({ signer: {}, pairingInfo: { deviceIdentifier: 'dev-2' } });
        await expect(ensureLive(record, { trezor })).rejects.toMatchObject({ code: 'HW_WRONG_DEVICE' });
    });

    it('refuses a vendor the shell has no factory for', async () => {
        await expect(ensureLive(record, { ledger: async () => ({}) })).rejects.toMatchObject({ code: 'HW_NOT_CONNECTED' });
    });
});
