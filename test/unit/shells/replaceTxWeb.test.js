// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendRbfRequest } from '../../../packages/core/src/flows/rbfReplace.js';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));

vi.mock('../../../packages/web/src/hostBridge.js', () => ({
    sendMessage,
    getSessionStatus: vi.fn(),
    unlockWalletLocal: vi.fn(),
    lockWalletLocal: vi.fn(),
    createWalletLocal: vi.fn(),
    importMnemonicLocal: vi.fn(),
    importBackupLocal: vi.fn(),
}));

const webMessaging = await import('../../../packages/web/src/messaging.js');

const mobilePackage = JSON.parse(readFileSync(
    resolve('packages/mobile/package.json'),
    'utf8',
));
const mobileBuildSource = readFileSync(
    resolve('packages/mobile/scripts/build.js'),
    'utf8',
);

const request = {
    chainId: 'btc',
    originalTxHash: 'original-hash',
    strategy: 'restore',
    restoreTxHash: 'restored-hash',
    feeRate: '12.5',
    walletId: 'wallet-1',
};

beforeEach(() => {
    sendMessage.mockReset();
});

describe('web and mobile SPA replacement messaging', () => {
    it('exports replaceTx from the web SPA and forwards the request to tx.replace unchanged', async () => {
        const result = {
            replacementTxHash: 'replacement-hash',
            broadcastedAt: '2026-10-09T12:00:00.000Z',
            feeIncrease: '0.00001',
        };
        sendMessage.mockResolvedValue(result);

        expect(webMessaging.replaceTx).toBeTypeOf('function');
        await expect(sendRbfRequest({ messaging: webMessaging, request })).resolves.toBe(result);

        expect(sendMessage).toHaveBeenCalledOnce();
        expect(sendMessage).toHaveBeenCalledWith('tx.replace', request);
    });

    it('preserves a rejection from the in-page host', async () => {
        const error = Object.assign(new Error('Replacement transaction rejected.'), {
            name: 'ReplacementRejectedError',
            code: 'REPLACEMENT_REJECTED',
        });
        sendMessage.mockRejectedValue(error);

        await expect(webMessaging.replaceTx(request)).rejects.toBe(error);
    });

    it('ships the same messaging export in mobile by staging the web SPA verbatim', () => {
        expect(mobilePackage.dependencies['@xchain-wallet/web']).toBe('workspace:*');
        expect(mobileBuildSource).toMatch(
            /const webDist = join\(pkgRoot, '\.\.', 'web', 'dist'\);/,
        );
        expect(mobileBuildSource).toContain('cpSync(webDist, www, { recursive: true });');
        expect(webMessaging.replaceTx).toBeTypeOf('function');
    });
});
