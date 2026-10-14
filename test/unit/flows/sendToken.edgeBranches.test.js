// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../packages/core/src/flows/gatedSendGuard.js', () => ({
    prepareGatedSend: vi.fn(async () => null),
    getGatedGroupsForSend: vi.fn(async () => []),
}));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: vi.fn(async () => ({ txid: 'tx-1' })),
}));

import { prepareGatedSend, getGatedGroupsForSend } from '../../../packages/core/src/flows/gatedSendGuard.js';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import {
    assertValidDestination,
    normalizeSource,
    sendToken,
} from '../../../packages/core/src/flows/sendToken.js';

const FROM = {
    address: 'source-address',
    publicKey: '02abcdef',
    derivationPath: "m/84'/1'/0'/0/0",
};

function opts(extra = {}) {
    return {
        vault: {},
        walletId: 'wallet-1',
        chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
        sdkRegistry: { get: () => ({}) },
        chainId: 'bitcoin-regtest',
        from: FROM,
        to: 'destination-address',
        tick: 'TOKEN',
        amount: '1',
        ...extra,
    };
}

describe('sendToken edge branches', () => {
    beforeEach(() => {
        vi.mocked(submitAction).mockClear();
        vi.mocked(prepareGatedSend).mockReset().mockResolvedValue(null);
        vi.mocked(getGatedGroupsForSend).mockReset().mockResolvedValue([]);
    });

    it('rejects a missing options object before reading send fields', async () => {
        await expect(sendToken()).rejects.toThrow('sendToken: opts is required');
        expect(submitAction).not.toHaveBeenCalled();
    });

    it('uses the gated action and labels its pending record', async () => {
        vi.mocked(prepareGatedSend).mockResolvedValueOnce({
            actionData: { action: 'BATCH', params: { ACTIONS: ['SEND', 'MESSAGE'] } },
        });

        await sendToken(opts());

        expect(vi.mocked(submitAction).mock.calls[0][0]).toMatchObject({
            actionData: { action: 'BATCH' },
            pendingTxMeta: {
                actionSummary: expect.stringContaining('gated unlock key handoff'),
            },
        });
    });

    it('does not re-run gated discovery for a prebuilt multi-recipient send', async () => {
        const prebuiltPsbt = { psbtHex: '70736274ff', actionString: 'SEND|1' };
        await sendToken(opts({
            prebuiltPsbt,
            fee: 0,
            feePerKb: 0,
            rbf: false,
            utxos: [],
            trackPendingTx: false,
            from: {
                address: 'imported-address', publicKey: '03abcdef', derivationPath: null, id: 'addr-7',
            },
            legs: [
                { to: 'destination-a', amount: '1' },
                { to: 'destination-b', amount: '2' },
            ],
        }));

        expect(prepareGatedSend).not.toHaveBeenCalled();
        expect(getGatedGroupsForSend).not.toHaveBeenCalled();
        const call = vi.mocked(submitAction).mock.calls[0][0];
        expect(call.prebuiltPsbt).toBe(prebuiltPsbt);
        expect(call.pendingTxMeta).toBeUndefined();
        expect(call.encoderOpts).toMatchObject({ fee: 0, feePerKb: 0, rbf: false });
        expect(call.encoderOpts).not.toHaveProperty('utxos');
        expect(call.signingPaths).toEqual([{ inputIndex: 0, addressId: 'addr-7' }]);
    });
});

describe('normalizeSource edge branches', () => {
    it.each([
        [null, /from is required/],
        ['source', /from is required/],
        [{ publicKey: '02aa' }, /from.address must be a non-empty string/],
        [{ address: 'addr' }, /from.publicKey must be a non-empty string/],
        [{ address: 'addr', publicKey: '02aa', source: 'watch-only' }, /has no signer/],
        [{ address: 'addr', publicKey: '02aa', derivationPath: null }, /must include an addressId/],
    ])('rejects an unusable source %#', (source, message) => {
        expect(() => normalizeSource(source, 'edgeFlow')).toThrow(message);
    });

    it('prefers an explicit imported address id and otherwise accepts the schema id', () => {
        expect(normalizeSource({
            address: 'addr', publicKey: '02aa', addressId: 'explicit', id: 'schema-id',
        })).toEqual({
            address: 'addr', publicKey: '02aa', derivationPath: null, addressId: 'explicit',
        });
        expect(normalizeSource({ address: 'addr', publicKey: '02aa', id: 'schema-id' }).addressId)
            .toBe('schema-id');
    });
});

describe('assertValidDestination descriptor fallback', () => {
    it('defers validation when the descriptor lacks a coin or network', () => {
        expect(() => assertValidDestination('sendToken', 'anything', { get: () => null }, 'missing'))
            .not.toThrow();
        expect(() => assertValidDestination(
            'sendToken', 'anything', { get: () => ({ coin: 'bitcoin' }) }, 'partial',
        )).not.toThrow();
    });
});
