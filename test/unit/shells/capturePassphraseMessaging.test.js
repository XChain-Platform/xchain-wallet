// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// §3.4: the `capturePassphrase` helper exists, under the same name and
// the same message type, in all three messaging modules. Shared routes under
// `@xchain-wallet/core/shared/routes/*` are compiled against these names, so a
// module that spells the type differently (or lacks the helper) is a shell
// where the capture step is simply missing, with nothing else to notice it.
//
// Each shell's transport is mocked, since what is under test is the message
// name and that the options object crosses verbatim.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { webSend, desktopSend, popupSend } = vi.hoisted(() => ({
    webSend: vi.fn(),
    desktopSend: vi.fn(),
    popupSend: vi.fn(),
}));

vi.mock('../../../packages/web/src/hostBridge.js', () => ({
    sendMessage: webSend,
    getSessionStatus: vi.fn(),
    unlockWalletLocal: vi.fn(),
    lockWalletLocal: vi.fn(),
    createWalletLocal: vi.fn(),
    importMnemonicLocal: vi.fn(),
    importBackupLocal: vi.fn(),
}));

vi.mock('../../../packages/desktop/renderer/bridgeMessaging.js', () => ({
    sendMessage: desktopSend,
}));

vi.mock('../../../packages/extension/src/shared/chromeMessaging.js', () => ({
    sendMessage: popupSend,
}));

const web = await import('../../../packages/web/src/messaging.js');
const desktop = await import('../../../packages/desktop/renderer/messaging.js');
const popup = await import('../../../packages/extension/src/popup/messaging.js');

const SHELLS = [
    ['web', () => web, () => webSend],
    ['desktop', () => desktop, () => desktopSend],
    ['extension popup', () => popup, () => popupSend],
];

const OPTS = { walletId: 'w-legacy', password: 'pw', bip39Passphrase: 'the-25th-word' };

beforeEach(() => {
    webSend.mockReset();
    desktopSend.mockReset();
    popupSend.mockReset();
});

describe('capturePassphrase messaging twins (§3.4)', () => {
    for (const [shell, mod, send] of SHELLS) {
        it(`${shell} dispatches wallet.passphrase.capture with the options verbatim`, async () => {
            expect(typeof mod().capturePassphrase).toBe('function');
            send().mockResolvedValue({ wallet: { id: 'w-legacy', passphraseStored: true } });

            const result = await mod().capturePassphrase(OPTS);

            expect(send()).toHaveBeenCalledWith('wallet.passphrase.capture', OPTS);
            // The reply crosses back untouched, as every other helper here does.
            expect(result).toEqual({ wallet: { id: 'w-legacy', passphraseStored: true } });
        });

        it(`${shell} lets a PassphraseMismatchError reject through`, async () => {
            const err = Object.assign(new Error('That passphrase does not open Cold.'), {
                name: 'PassphraseMismatchError', code: 'PASSPHRASE_MISMATCH',
            });
            send().mockRejectedValue(err);
            await expect(mod().capturePassphrase(OPTS)).rejects.toMatchObject({
                name: 'PassphraseMismatchError', code: 'PASSPHRASE_MISMATCH',
            });
        });
    }
});
