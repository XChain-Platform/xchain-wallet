// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(),
}));
vi.mock('../../../packages/core/src/flows/composeActionForConfirm.js', () => ({
    composeActionForConfirm: vi.fn(),
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    normalizeSource: vi.fn((from) => from),
}));

import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { composeActionForConfirm } from '../../../packages/core/src/flows/composeActionForConfirm.js';
import { deployChunkedRun } from '../../../packages/core/src/flows/deployChunked.js';
import { TamperDetectedError } from '../../../packages/core/src/flows/confirmChecks.js';

const FROM = {
    address: 'address-1',
    publicKey: '02ab',
    derivationPath: "m/84'/1'/0'/0/0",
    addressId: 'address-id-1',
};

function fakeVault() {
    const rows = new Map();
    return {
        pendingDeploys: {
            put: vi.fn(async (row) => { rows.set(row.id, row); return row; }),
            get: vi.fn(async (id) => rows.get(id) ?? null),
            delete: vi.fn(async (id) => { rows.delete(id); }),
            findBy: vi.fn(async () => [...rows.values()]),
        },
    };
}

function run() {
    const sdk = {
        planDeploy: vi.fn(() => ({
            codeHash: 'a'.repeat(64),
            single: false,
            parts: ['part'],
            totalChunks: 1,
        })),
        waitForAction: vi.fn(async () => ({ action_index: 5 })),
        getAction: vi.fn(async () => ({ status: 'valid', deployed_contract_index: 5 })),
    };
    return deployChunkedRun({
        vault: fakeVault(),
        walletId: 'wallet-1',
        password: 'password',
        chainRegistry: {},
        sdkRegistry: { get: () => sdk },
        chainId: 'chain-1',
        from: FROM,
        code: 'contract source',
        gasLimit: '100000',
    });
}

describe('chunked deploy compose reservations', () => {
    let releaseEncoderInputs;

    beforeEach(() => {
        releaseEncoderInputs = vi.fn(async () => {});
        composeActionForConfirm.mockReset();
        composeActionForConfirm.mockResolvedValue({
            psbt: 'psbt',
            tamperVerified: true,
            releaseEncoderInputs,
        });
        submitAction.mockReset();
    });

    it('releases when submit refuses before signing', async () => {
        const failure = Object.assign(new Error('refused'), { refusedBeforeSigning: true });
        submitAction.mockRejectedValue(failure);

        await expect(run()).rejects.toBe(failure);
        expect(releaseEncoderInputs).toHaveBeenCalledOnce();
    });

    it('releases an unlock failure that has no refusal marker', async () => {
        const failure = new Error('unlock failed');
        submitAction.mockRejectedValue(failure);

        await expect(run()).rejects.toBe(failure);
        expect(releaseEncoderInputs).toHaveBeenCalledOnce();
    });

    it('keeps the reservation after signing starts', async () => {
        const failure = new Error('device disconnected');
        submitAction.mockImplementation(async (opts) => {
            opts.onProgress('signing', {});
            throw failure;
        });

        await expect(run()).rejects.toBe(failure);
        expect(releaseEncoderInputs).not.toHaveBeenCalled();
    });

    it('keeps the original failure when releasing also fails', async () => {
        const failure = new Error('unlock failed');
        releaseEncoderInputs.mockRejectedValue(new Error('release failed'));
        submitAction.mockRejectedValue(failure);

        await expect(run()).rejects.toBe(failure);
        expect(releaseEncoderInputs).toHaveBeenCalledOnce();
    });

    it('refuses to sign a leg whose compose did not tamper-check it, and releases it', async () => {
        composeActionForConfirm.mockResolvedValue({ psbt: 'psbt', releaseEncoderInputs });

        await expect(run()).rejects.toBeInstanceOf(TamperDetectedError);
        expect(submitAction).not.toHaveBeenCalled();
        expect(releaseEncoderInputs).toHaveBeenCalledOnce();
    });
});
