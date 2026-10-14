// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage, getRecentShellErrors } = vi.hoisted(() => ({
    sendMessage: vi.fn(),
    getRecentShellErrors: vi.fn(),
}));

vi.mock('../../../packages/desktop/renderer/bridgeMessaging.js', () => ({ sendMessage }));
vi.mock('../../../packages/desktop/renderer/errorCapture.js', () => ({ getRecentShellErrors }));

const messaging = await import('../../../packages/desktop/renderer/messaging.js');

beforeEach(() => {
    sendMessage.mockReset();
    getRecentShellErrors.mockReset();
});

describe('desktop renderer messaging', () => {
    it('re-exports the desktop transport', () => {
        expect(messaging.sendMessage).toBe(sendMessage);
    });

    it('includes a non-empty BIP39 passphrase only when one is supplied', () => {
        messaging.unlockWallet('secret');
        messaging.unlockWallet('secret', { bip39Passphrase: '' });
        messaging.unlockWallet('secret', { bip39Passphrase: 'word 25' });

        expect(sendMessage.mock.calls).toEqual([
            ['wallet.unlock', { password: 'secret' }],
            ['wallet.unlock', { password: 'secret' }],
            ['wallet.unlock', { password: 'secret', bip39Passphrase: 'word 25' }],
        ]);
    });

    it('attaches captured renderer errors to a diagnostic dump request', () => {
        const recentErrors = [{ type: 'error', message: 'renderer failed' }];
        const reply = Promise.resolve({ text: 'diagnostic' });
        getRecentShellErrors.mockReturnValue(recentErrors);
        sendMessage.mockReturnValue(reply);

        expect(messaging.getDiagnosticDump()).toBe(reply);
        expect(sendMessage).toHaveBeenCalledWith('diagnostic.dump', { recentErrors });
    });

    it('builds identifier payloads for scalar arguments', () => {
        messaging.listAccounts('wallet-1');
        messaging.setActiveWallet('wallet-2');
        messaging.unregisterSigner('signer-1');

        expect(sendMessage.mock.calls).toEqual([
            ['account.list', { walletId: 'wallet-1' }],
            ['wallet.setActive', { walletId: 'wallet-2' }],
            ['signer.unregister', { signerId: 'signer-1' }],
        ]);
    });
});
