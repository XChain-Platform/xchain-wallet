// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import { sendRbfRequest } from '../../../packages/core/src/flows/rbfReplace.js';

const { popupSend } = vi.hoisted(() => ({ popupSend: vi.fn() }));

vi.mock('../../../packages/extension/src/shared/chromeMessaging.js', () => ({
    sendMessage: popupSend,
}));

const popup = await import('../../../packages/extension/src/popup/messaging.js');

describe('extension popup replace transaction messaging', () => {
    it('connects the shared RBF flow to the tx.replace host route', async () => {
        const request = {
            chainId: 'bitcoin-mainnet',
            originalTxHash: 'original-tx',
            strategy: 'cancel',
            walletId: 'wallet-1',
            feeRate: '12',
        };
        const reply = {
            replacementTxHash: 'replacement-tx',
            broadcastedAt: '2026-10-09T12:00:00.000Z',
            feeIncrease: '0.00001',
        };
        popupSend.mockResolvedValue(reply);

        expect(popup.replaceTx).toBeTypeOf('function');
        await expect(sendRbfRequest({ messaging: popup, request })).resolves.toBe(reply);
        expect(popupSend).toHaveBeenCalledOnce();
        expect(popupSend).toHaveBeenCalledWith('tx.replace', request);
    });
});
