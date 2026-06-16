// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: core/signerFactories/trezor — makeTrezorFactory DI builder.
// No real Trezor hardware — mocked entirely.

import { describe, it, expect, vi } from 'vitest';
import { makeTrezorFactory } from '../../../packages/core/src/signerFactories/trezor.js';
import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';

function makeConnect(overrides = {}) {
    return {
        getFeatures: vi.fn().mockResolvedValue({
            success: true,
            payload: {
                device_id: 'MOCK_DEVICE_ID',
                internal_model: 'T2T1',
                major_version: 2,
                minor_version: 6,
                patch_version: 0,
                label: 'My Trezor',
            },
        }),
        ...overrides,
    };
}

describe('makeTrezorFactory', () => {
    it('throws when getConnect is not a function', () => {
        expect(() => makeTrezorFactory({ getConnect: null })).toThrow('getConnect must be a function');
    });

    it('returns a callable pair function', () => {
        const pair = makeTrezorFactory({ getConnect: vi.fn() });
        expect(typeof pair).toBe('function');
    });

    describe('pairTrezorSigner (happy path)', () => {
        it('returns a TrezorSigner + pairingInfo on success', async () => {
            const connect = makeConnect();
            const pair = makeTrezorFactory({ getConnect: vi.fn().mockResolvedValue(connect) });
            const result = await pair();
            expect(result.signer).toBeInstanceOf(TrezorSigner);
            expect(result.pairingInfo.vendor).toBe('trezor');
            expect(result.pairingInfo.model).toBe('T2T1');
            expect(result.pairingInfo.deviceIdentifier).toBe('MOCK_DEVICE_ID');
            expect(result.pairingInfo.firmwareVersion).toBe('2.6.0');
        });

        it('uses label in signer displayName', async () => {
            const connect = makeConnect();
            const pair = makeTrezorFactory({ getConnect: vi.fn().mockResolvedValue(connect) });
            const result = await pair();
            expect(result.signer.displayName).toContain('My Trezor');
        });

        it('falls back to fw_fingerprint for device identifier', async () => {
            const connect = makeConnect();
            connect.getFeatures = vi.fn().mockResolvedValue({
                success: true,
                payload: {
                    fw_fingerprint: 'FW_FINGERPRINT',
                    internal_model: 'T2T1',
                    major_version: 2,
                    minor_version: 5,
                    patch_version: 0,
                    label: 'My Trezor',
                },
            });
            const pair = makeTrezorFactory({ getConnect: vi.fn().mockResolvedValue(connect) });
            const result = await pair();
            expect(result.pairingInfo.deviceIdentifier).toBe('FW_FINGERPRINT');
        });

        it('maps legacy model "T" to T2T1', async () => {
            const connect = makeConnect();
            connect.getFeatures = vi.fn().mockResolvedValue({
                success: true,
                payload: {
                    device_id: 'ID',
                    model: 'T',
                    major_version: 2,
                    minor_version: 5,
                    patch_version: 0,
                    label: 'Trezor',
                },
            });
            const pair = makeTrezorFactory({ getConnect: vi.fn().mockResolvedValue(connect) });
            const result = await pair();
            expect(result.pairingInfo.model).toBe('T2T1');
        });

        it('returns null firmwareVersion when version fields missing', async () => {
            const connect = makeConnect();
            connect.getFeatures = vi.fn().mockResolvedValue({
                success: true,
                payload: {
                    device_id: 'ID',
                    internal_model: 'T2T1',
                    label: 'Trezor',
                },
            });
            const pair = makeTrezorFactory({ getConnect: vi.fn().mockResolvedValue(connect) });
            const result = await pair();
            expect(result.pairingInfo.firmwareVersion).toBeNull();
        });
    });

    describe('pairTrezorSigner (error paths)', () => {
        it('throws when getConnect does not return a usable connect object', async () => {
            const pair = makeTrezorFactory({ getConnect: vi.fn().mockResolvedValue(null) });
            await expect(pair()).rejects.toThrow('usable TrezorConnect');
        });

        it('throws when getConnect returns object without getFeatures', async () => {
            const pair = makeTrezorFactory({ getConnect: vi.fn().mockResolvedValue({ notGetFeatures: () => {} }) });
            await expect(pair()).rejects.toThrow('usable TrezorConnect');
        });

        it('throws when getFeatures returns failure', async () => {
            const connect = makeConnect();
            connect.getFeatures = vi.fn().mockResolvedValue({
                success: false,
                payload: { error: 'User cancelled' },
            });
            const pair = makeTrezorFactory({ getConnect: vi.fn().mockResolvedValue(connect) });
            await expect(pair()).rejects.toThrow('User cancelled');
        });

        it('throws when device has no identifier', async () => {
            const connect = makeConnect();
            connect.getFeatures = vi.fn().mockResolvedValue({
                success: true,
                payload: {
                    internal_model: 'T2T1',
                    major_version: 2,
                    minor_version: 6,
                    patch_version: 0,
                    label: 'Trezor',
                },
            });
            const pair = makeTrezorFactory({ getConnect: vi.fn().mockResolvedValue(connect) });
            await expect(pair()).rejects.toThrow('device_id or fw_fingerprint');
        });

        it('throws when device has no model', async () => {
            const connect = makeConnect();
            connect.getFeatures = vi.fn().mockResolvedValue({
                success: true,
                payload: {
                    device_id: 'ID',
                    major_version: 2,
                    minor_version: 6,
                    patch_version: 0,
                    label: 'Trezor',
                },
            });
            const pair = makeTrezorFactory({ getConnect: vi.fn().mockResolvedValue(connect) });
            await expect(pair()).rejects.toThrow('model');
        });

        it('propagates getConnect rejection', async () => {
            const pair = makeTrezorFactory({
                getConnect: vi.fn().mockRejectedValue(new Error('connection failed')),
            });
            await expect(pair()).rejects.toThrow('connection failed');
        });
    });
});
