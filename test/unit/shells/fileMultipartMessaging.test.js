// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    { name: 'web', mod: web, send: webSend },
    { name: 'desktop', mod: desktop, send: desktopSend },
    { name: 'extension popup', mod: popup, send: popupSend },
];
const WRAPPERS = [
    ['fileMultipart', 'action.fileMultipart'],
    ['listPendingFileUploads', 'pendingFileUploads.listForWallet'],
    ['discardPendingFileUpload', 'pendingFileUploads.discard'],
];

beforeEach(() => {
    for (const { send } of SHELLS) send.mockReset();
});

describe('multi-part file messaging wrappers', () => {
    for (const { name, mod, send } of SHELLS) {
        for (const [wrapper, type] of WRAPPERS) {
            it(`${name} ${wrapper} preserves its transport contract`, async () => {
                const request = { walletId: `${name}-wallet`, uploadId: 'upload-1' };
                const response = { accepted: true, wrapper };
                send.mockResolvedValue(response);

                const result = await mod[wrapper](request);

                expect(send).toHaveBeenCalledOnce();
                expect(send).toHaveBeenCalledWith(type, request);
                expect(send.mock.calls[0][1]).toBe(request);
                expect(result).toBe(response);
            });
        }
    }
});
