// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({
    sendMessage: vi.fn(),
}));

vi.mock('../../../packages/desktop/renderer/bridgeMessaging.js', () => ({
    sendMessage,
}));

const { replaceTx } = await import('../../../packages/desktop/renderer/messaging.js');

const request = Object.freeze({
    chainId: 'bitcoin',
    originalTxHash: 'original-tx',
    strategy: 'restore',
    restoreTxHash: 'replacement-tx',
    feeRate: '12',
    walletId: 'wallet-1',
});

beforeEach(() => {
    sendMessage.mockReset();
});

describe('desktop replaceTx messaging', () => {
    it('dispatches tx.replace with the request unchanged', async () => {
        const response = Object.freeze({
            replacementTxHash: 'new-tx',
            broadcastedAt: '2026-10-09T00:00:00.000Z',
            feeIncrease: '0.00001',
        });
        sendMessage.mockResolvedValue(response);

        await expect(replaceTx(request)).resolves.toBe(response);
        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith('tx.replace', request);
    });

    it('preserves host rejections', async () => {
        const error = new Error('replacement refused');
        sendMessage.mockRejectedValue(error);

        await expect(replaceTx(request)).rejects.toBe(error);
        expect(sendMessage).toHaveBeenCalledWith('tx.replace', request);
    });
});
