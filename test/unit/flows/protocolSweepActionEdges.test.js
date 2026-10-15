// Copyright (c) 2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    assertValidDestination: vi.fn(),
    disableAutopayForAddress: vi.fn(),
    submitAction: vi.fn(),
}));
vi.mock('../../../packages/core/src/flows/submitAction.js', () => ({
    submitAction: mocks.submitAction,
}));
vi.mock('../../../packages/core/src/flows/sendToken.js', () => ({
    assertValidDestination: mocks.assertValidDestination,
    normalizeSource: vi.fn((from) => ({
        address: from.address,
        publicKey: from.publicKey,
        derivationPath: from.derivationPath || null,
        addressId: from.addressId || from.id || null,
    })),
}));
vi.mock('../../../packages/core/src/flows/autopayConsent.js', () => ({
    disableAutopayForAddress: mocks.disableAutopayForAddress,
}));

import { sweepToken } from '../../../packages/core/src/flows/sweepToken.js';

const FROM = {
    address: 'bcrt1qsource',
    publicKey: `02${'ab'.repeat(32)}`,
    derivationPath: "m/84'/1'/0'/0/0",
};

function opts(extra = {}) {
    return {
        vault: {},
        walletId: 'wallet-1',
        password: 'secret',
        chainRegistry: {},
        sdkRegistry: {},
        chainId: 'bitcoin-regtest',
        from: FROM,
        to: 'bcrt1qdestination',
        ...extra,
    };
}

beforeEach(() => {
    mocks.assertValidDestination.mockReset();
    mocks.disableAutopayForAddress.mockReset();
    mocks.disableAutopayForAddress.mockResolvedValue([]);
    mocks.submitAction.mockReset();
    mocks.submitAction.mockResolvedValue({ txid: 'sweep-tx' });
});

describe('SWEEP request edges', () => {
    it('requires options before destination validation', async () => {
        await expect(sweepToken()).rejects.toThrow('sweepToken: opts is required');
        expect(mocks.assertValidDestination).not.toHaveBeenCalled();
    });

    it('requires a destination before destination validation', async () => {
        await expect(sweepToken(opts({ to: '' }))).rejects.toThrow('sweepToken: to is required');
        expect(mocks.assertValidDestination).not.toHaveBeenCalled();
    });

    it('encodes an empty memo while omitting it from the human summary', async () => {
        await sweepToken(opts({
            from: { address: FROM.address, publicKey: FROM.publicKey, id: 'imported-1' },
            balances: false,
            ownerships: false,
            dispensers: true,
            memo: '',
        }));
        const call = mocks.submitAction.mock.calls[0][0];
        expect(call.actionData).toEqual({
            action: 'SWEEP',
            params: {
                DESTINATION: 'bcrt1qdestination',
                BALANCES: '0',
                OWNERSHIPS: '0',
                ORDERS: '0',
                SWAPS: '0',
                DISPENSERS: '1',
                MEMO: '',
            },
        });
        expect(call.pendingTxMeta.actionSummary)
            .toBe('Sweep dispensers to bcrt1qdestination');
        expect(call.signingPaths).toEqual([{ inputIndex: 0, addressId: 'imported-1' }]);
    });

    it('suppresses pending metadata without changing the signed flags', async () => {
        await sweepToken(opts({ swaps: true, trackPendingTx: false }));
        const call = mocks.submitAction.mock.calls[0][0];
        expect(call.pendingTxMeta).toBeUndefined();
        expect(call.actionData.params).toMatchObject({
            BALANCES: '1', OWNERSHIPS: '1', SWAPS: '1',
        });
    });
});

describe('SWEEP force-close result edges', () => {
    it('uses a nested broadcast txid and treats an undefined hold count as zero', async () => {
        const releaseByAddress = vi.fn(async () => undefined);
        mocks.disableAutopayForAddress.mockResolvedValue([{}, {}]);
        mocks.submitAction.mockResolvedValue({ broadcast: { txid: 'nested-tx' } });

        await expect(sweepToken(opts({
            orders: true,
            reservationLedger: { releaseByAddress },
        }))).resolves.toMatchObject({
            forceClose: { autopayDisabled: 2, holdsReleased: 0, error: null },
        });
        expect(releaseByAddress).toHaveBeenCalledWith('bitcoin-regtest', FROM.address);
    });

    it('skips hold release when the ledger has no release method', async () => {
        await expect(sweepToken(opts({
            orders: true,
            reservationLedger: {},
        }))).resolves.toMatchObject({
            forceClose: { autopayDisabled: 0, holdsReleased: 0, error: null },
        });
    });

    it('stringifies a non-Error cleanup rejection without failing the broadcast', async () => {
        mocks.disableAutopayForAddress.mockRejectedValue('vault offline');
        await expect(sweepToken(opts({ orders: true }))).resolves.toMatchObject({
            txid: 'sweep-tx',
            forceClose: { autopayDisabled: 0, holdsReleased: 0, error: 'vault offline' },
        });
    });
});
