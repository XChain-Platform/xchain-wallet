// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sendRbfRequest } from '../../../packages/core/src/flows/rbfReplace.js';
import { attachChromeRuntime } from '../../../packages/extension/src/background/ChromeRuntimeAdapter.js';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import * as popup from '../../../packages/extension/src/popup/messaging.js';

const request = {
    chainId: 'missing-chain',
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

let previousChrome;

beforeEach(() => {
    previousChrome = globalThis.chrome;
});

afterEach(() => {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
});

function createRuntime() {
    let listener;
    const runtime = {
        id: 'replace-tx-extension-test',
        lastError: null,
        onMessage: {
            addListener(next) { listener = next; },
            removeListener(next) { if (listener === next) listener = undefined; },
        },
        sendMessage(message, sendResponse) {
            if (!listener) throw new Error('runtime listener is not attached');
            return listener(message, {
                origin: `chrome-extension://${runtime.id}`,
            }, sendResponse);
        },
    };
    return runtime;
}

function createHost() {
    return createBackgroundHost({
        vault: { settings: { get: async () => ({}) } },
        chainRegistry: { get: () => null, list: () => [] },
        sdkRegistry: { get: () => null, for: () => null },
        approvals: { request: async () => ({ approved: true }) },
        bridgeEvents: { emit() {} },
        getDiagnosticContext: () => ({}),
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
    });
}

describe('extension popup replace transaction messaging', () => {
    it('exports replaceTx and sends the tx.replace envelope unchanged', async () => {
        const runtime = createRuntime();
        runtime.onMessage.addListener((message, _sender, sendResponse) => {
            expect(message).toEqual({ type: 'tx.replace', request });
            sendResponse({ ok: true, result: reply });
            return true;
        });
        globalThis.chrome = { runtime };

        expect(popup.replaceTx).toBeTypeOf('function');
        await expect(sendRbfRequest({ messaging: popup, request })).resolves.toBe(reply);
    });

    it('reaches the registered tx.replace background route', async () => {
        const runtime = createRuntime();
        const host = createHost();
        const detach = attachChromeRuntime(host, runtime);
        globalThis.chrome = { runtime };

        try {
            expect(host.types()).toContain('tx.replace');
            await expect(sendRbfRequest({ messaging: popup, request }))
                .rejects.toThrow('tx.replace: unknown chain "missing-chain"');
        } finally {
            detach();
        }
    });
});
