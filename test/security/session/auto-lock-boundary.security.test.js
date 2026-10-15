/**
 * @vitest-environment node
 */

// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { describe, expect, it, vi } from 'vitest';
import {
    createRuntime,
    enforceIdleAutoLock,
    handleIpcMessage,
} from '../../../packages/desktop/main/runtime.js';

function memoryBackend(initial = null) {
    let value = initial;
    return {
        async load() {
            return value instanceof Uint8Array ? value.slice() : value;
        },
        async save(next) {
            value = next instanceof Uint8Array ? next.slice() : next;
        },
        async clear() { value = null; },
    };
}

describe('security/session/auto-lock-boundary', () => {
    it('closes the vault and refuses balance reads after auto-lock', async () => {
        const now = 2_000_000;
        const sessionBackend = memoryBackend(new Uint8Array([1, 2, 3, 4]));
        const autoLockStore = memoryBackend({
            armed: true,
            idleMs: 60_000,
            lastActivity: now - 60_001,
        });
        const runtime = createRuntime({
            storageBackend: memoryBackend(),
            sessionBackend,
            metaBackend: memoryBackend(),
            autoLockStore,
            chainRegistry: {},
            sdkRegistry: {},
        });
        const vault = { close: vi.fn() };
        const signerPool = { lockAll: vi.fn() };
        const balanceHandler = vi.fn(async () => ({
            ok: true,
            result: [{ tick: 'XCP', balance: '100000000' }],
        }));
        runtime.vault = vault;
        runtime.signerPool = signerPool;
        runtime.host = { handle: balanceHandler };

        expect(await enforceIdleAutoLock(runtime, now)).toEqual({
            locked: true,
            reason: 'idle-window-elapsed',
        });
        expect(vault.close).toHaveBeenCalledOnce();
        expect(signerPool.lockAll).toHaveBeenCalledOnce();
        expect(runtime.vault).toBe(null);
        expect(runtime.host).toBe(null);
        expect(await sessionBackend.load()).toBe(null);

        const reply = await handleIpcMessage(runtime, {
            type: 'balances.wallet',
            request: { walletId: 'wallet-1' },
        });
        expect(reply).toMatchObject({ ok: false, error: { name: 'WalletLockedError' } });
        expect(balanceHandler).not.toHaveBeenCalled();
    });
});
