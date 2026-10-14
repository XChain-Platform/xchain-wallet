// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
    settings: { preflightPrivacy: 'local' },
    confirmAction: null,
}));

vi.mock('../../../packages/core/src/shared/hooks/useSettings.js', () => ({
    useSettings: () => ({ settings: mocked.settings }),
}));

vi.mock('../../../packages/core/src/shared/hooks/useConfirmAction.js', () => ({
    useConfirmAction: () => mocked.confirmAction,
    isConfirmOpenPhase: (phase) => phase !== 'idle',
}));

import {
    isUserRejection,
    useActionConfirmFlow,
    useConfirmSubmit,
} from '../../../packages/core/src/shared/hooks/useActionConfirmFlow.js';

beforeEach(() => {
    mocked.settings = { preflightPrivacy: 'local' };
    mocked.confirmAction = {
        phase: 'ready',
        composing: true,
        confirm: vi.fn(async (options) => options),
    };
});

describe('useActionConfirmFlow helpers', () => {
    it('recognizes only the documented user rejection shapes', () => {
        expect(isUserRejection({ reason: 'user-rejected' })).toBe(true);
        expect(isUserRejection({ name: 'UserRejectedError' })).toBe(true);
        expect(isUserRejection(new Error('cancelled'))).toBe(false);
        expect(isUserRejection(null)).toBe(false);
    });

    it('keeps software passwords and hardware signer ids in their own lanes', async () => {
        const messaging = {
            submitSoftware: vi.fn(async (request) => request),
            submitHardware: vi.fn(async (request) => request),
        };
        const passwordRef = { current: 'latest password' };
        const initialProps = {
            messaging,
            isHw: false,
            signerId: 'signer-1',
            passwordRef,
            software: 'submitSoftware',
            hardware: 'submitHardware',
        };
        const { result, rerender } = renderHook((props) => useConfirmSubmit(props), {
            initialProps,
        });

        await expect(result.current({ tx: 'software' })).resolves.toEqual({
            tx: 'software', password: 'latest password',
        });
        expect(messaging.submitHardware).not.toHaveBeenCalled();

        rerender({ ...initialProps, isHw: true });
        await expect(result.current({ tx: 'hardware' })).resolves.toEqual({
            tx: 'hardware', signerId: 'signer-1',
        });
        expect(messaging.submitHardware).toHaveBeenCalledWith({
            tx: 'hardware', signerId: 'signer-1',
        });
    });
});

describe('useActionConfirmFlow orchestration', () => {
    it('wires compose, safety checks, reservation, and the previewed PSBT', async () => {
        const messaging = {
            checkInputLiveness: vi.fn(async () => 'live'),
            releaseEncoderInputs: vi.fn(async () => 'released'),
            requoteNativeFee: vi.fn(async () => 'quoted'),
            composeForConfirm: vi.fn(async () => 'composed'),
            preflight: vi.fn(async () => 'report'),
            reserve: vi.fn(async () => 'reserved'),
            releaseReservation: vi.fn(async () => 'unreserved'),
        };
        const onApprove = vi.fn(async () => 'submitted');
        const from = { address: 'source-address', addressId: 'address-1' };
        const actionData = { action: 'SEND', params: { quantity: '2' } };
        const { result } = renderHook(() => useActionConfirmFlow({
            messaging, walletId: 'wallet-1',
        }));

        let options;
        await act(async () => {
            options = await result.current.run({
                chainId: 'bitcoin-regtest',
                from,
                actionData,
                encoderOpts: { feePerKb: 1200 },
                onApprove,
            });
        });

        expect(result.current).toMatchObject({ open: true, composing: true });
        expect(options).toMatchObject({
            chainId: 'bitcoin-regtest',
            source: 'source-address',
            preflightOpts: { mode: 'local' },
        });

        await expect(options.compose()).resolves.toBe('composed');
        expect(messaging.composeForConfirm).toHaveBeenCalledWith({
            walletId: 'wallet-1',
            chainId: 'bitcoin-regtest',
            from,
            actionData,
            encoderOpts: { feePerKb: 1200 },
        });
        await options.preflight({ actionString: 'SEND|0' });
        expect(messaging.preflight).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest', actionString: 'SEND|0',
        });
        await options.checkInputs('psbt-hex');
        expect(messaging.checkInputLiveness).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest', psbtHex: 'psbt-hex',
        });
        await options.releaseEncoderInputs('token-1');
        expect(messaging.releaseEncoderInputs).toHaveBeenCalledWith({ token: 'token-1' });
        await options.requoteNativeFee({ actionString: 'SEND|0', source: 'source-address' });
        expect(messaging.requoteNativeFee).toHaveBeenCalledWith({
            chainId: 'bitcoin-regtest', actionString: 'SEND|0', source: 'source-address',
        });
        await options.reservationLedger.reserve({ id: 'reservation-1' });
        await options.reservationLedger.release('reservation-1');
        expect(messaging.reserve).toHaveBeenCalledWith({ id: 'reservation-1' });
        expect(messaging.releaseReservation).toHaveBeenCalledWith({ id: 'reservation-1' });

        const composed = {
            psbt: 'previewed-psbt',
            encoding: 'OP_RETURN',
            actionString: 'SEND|0',
            version: 0,
            deferredOutputs: [{ value: 1 }],
            adsPlan: { canSubmit: true },
        };
        await expect(options.onApprove({}, composed)).resolves.toBe('submitted');
        expect(onApprove).toHaveBeenCalledWith(expect.objectContaining({
            psbtHex: 'previewed-psbt',
            deferredOutputs: [{ value: 1 }],
            adsDonation: { included: true },
        }), composed);
    });

    it('uses a compose override and adds session persistence only for resumable flows', async () => {
        const messaging = {
            putConfirmSession: vi.fn(async () => {}),
            clearConfirmSession: vi.fn(async () => {}),
            reserve: vi.fn(),
            releaseReservation: vi.fn(),
        };
        const compose = vi.fn(async () => ({ psbt: 'custom' }));
        const resume = { software: 'submit', base: { amount: '1' } };
        const from = { address: 'source-address' };
        const { result } = renderHook(() => useActionConfirmFlow({
            messaging, walletId: 'wallet-1',
        }));

        let plain;
        let resumable;
        await act(async () => {
            plain = await result.current.run({
                chainId: 'litecoin', from, compose, onApprove: vi.fn(),
            });
            resumable = await result.current.run({
                chainId: 'litecoin', from, compose, onApprove: vi.fn(), resume,
            });
        });

        expect(plain).not.toHaveProperty('session');
        expect(plain).not.toHaveProperty('resumeRequest');
        await expect(resumable.compose()).resolves.toEqual({ psbt: 'custom' });
        expect(compose).toHaveBeenCalledTimes(1);
        expect(resumable.resume).toBe(resume);
        expect(resumable.resumeRequest).toEqual({
            chainId: 'litecoin', from, actionData: undefined, encoderOpts: undefined,
        });
        await resumable.session.put({ id: 'session-1' });
        await resumable.session.clear('session-1');
        expect(messaging.putConfirmSession).toHaveBeenCalledWith({ id: 'session-1' });
        expect(messaging.clearConfirmSession).toHaveBeenCalledWith({ id: 'session-1' });
    });
});
