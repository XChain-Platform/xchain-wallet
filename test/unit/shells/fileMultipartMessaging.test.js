// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sends = vi.hoisted(() => ({
    desktop: vi.fn(),
    popup: vi.fn(),
    web: vi.fn(),
}));

vi.mock('../../../packages/web/src/hostBridge.js', () => ({
    createWalletLocal: vi.fn(),
    getSessionStatus: vi.fn(),
    importBackupLocal: vi.fn(),
    importMnemonicLocal: vi.fn(),
    lockWalletLocal: vi.fn(),
    sendMessage: sends.web,
    unlockWalletLocal: vi.fn(),
}));

vi.mock('../../../packages/desktop/renderer/bridgeMessaging.js', () => ({
    sendMessage: sends.desktop,
}));

vi.mock('../../../packages/extension/src/shared/chromeMessaging.js', () => ({
    sendMessage: sends.popup,
}));

const web = await import('../../../packages/web/src/messaging.js');
const desktop = await import('../../../packages/desktop/renderer/messaging.js');
const popup = await import('../../../packages/extension/src/popup/messaging.js');

const SHELLS = [
    ['web', web, sends.web],
    ['desktop', desktop, sends.desktop],
    ['extension popup', popup, sends.popup],
];

const WRAPPERS = [
    ['fileMultipart', 'action.fileMultipart'],
    ['listPendingFileUploads', 'pendingFileUploads.listForWallet'],
    ['discardPendingFileUpload', 'pendingFileUploads.discard'],
];

beforeEach(() => {
    vi.clearAllMocks();
});

describe('multi-part file messaging wrappers', () => {
    for (const [shellName, shell, send] of SHELLS) {
        for (const [functionName, messageType] of WRAPPERS) {
            it(`${shellName} ${functionName} passes through its request and result`, async () => {
                const request = { walletId: 'w1', marker: `${shellName}-${functionName}` };
                const result = { accepted: messageType };
                send.mockResolvedValue(result);

                const received = await shell[functionName](request);

                expect(send).toHaveBeenCalledOnce();
                expect(send.mock.calls[0][0]).toBe(messageType);
                expect(send.mock.calls[0][1]).toBe(request);
                expect(received).toBe(result);
            });
        }
    }
});
