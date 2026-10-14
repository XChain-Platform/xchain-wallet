// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import {
    attachSessionMetaListener,
    dispatchPreHost,
    handleSessionStatus,
    hasSessionKey,
} from '../../../packages/extension/src/background/sessionMeta.js';

const backends = () => ({
    storageBackend: { load: vi.fn(async () => null) },
    sessionBackend: { load: vi.fn(async () => null) },
    metaBackend: { load: vi.fn(async () => null) },
});

function runtimeBus() {
    let listener;
    return {
        id: 'ext-id',
        onMessage: {
            addListener: vi.fn((next) => { listener = next; }),
            removeListener: vi.fn(),
        },
        emit(message) {
            return listener(message, {}, vi.fn());
        },
    };
}

describe('session metadata edge branches', () => {
    it('returns a safe no-op when runtime messaging is unavailable', () => {
        expect(attachSessionMetaListener({}, {}).call()).toBeUndefined();
    });

    it('declines malformed and unowned messages', () => {
        const runtime = runtimeBus();
        const detach = attachSessionMetaListener({}, runtime);
        expect(runtime.emit(null)).toBe(false);
        expect(runtime.emit({})).toBe(false);
        expect(runtime.emit({ type: 'wallet.list' })).toBe(false);
        detach();
        expect(runtime.onMessage.removeListener).toHaveBeenCalledOnce();
    });

    it.each([
        [{}, 'storageBackend is required'],
        [{ storageBackend: {} }, 'sessionBackend is required'],
        [{ storageBackend: {}, sessionBackend: {} }, 'metaBackend is required'],
    ])('requires every pre-host backend', async (deps, message) => {
        await expect(dispatchPreHost('session.status', null, deps)).rejects.toThrow(message);
    });

    it('rejects a type with no pre-host dispatcher', async () => {
        await expect(dispatchPreHost('wallet.unknown', null, backends())).rejects.toThrow(
            'no dispatcher for "wallet.unknown"',
        );
    });

    it('zeros the loaded session-key copy before returning', async () => {
        const bytes = new Uint8Array([7, 8, 9]);
        await expect(hasSessionKey({ load: async () => bytes })).resolves.toBe(true);
        expect([...bytes]).toEqual([0, 0, 0]);
    });

    it('propagates a session read failure', async () => {
        await expect(hasSessionKey({
            load: async () => { throw new Error('session read refused'); },
        })).rejects.toThrow('session read refused');
    });

    it.each([
        [null, null, 'no-wallet'],
        [new Uint8Array([1]), null, 'locked'],
        [new Uint8Array([1]), new Uint8Array([2]), 'unlocked'],
    ])('reports the %s/%s session state', async (vaultBlob, sessionKey, state) => {
        const result = await handleSessionStatus({
            storageBackend: { load: async () => vaultBlob },
            sessionBackend: { load: async () => sessionKey },
        });
        expect(result).toEqual({
            hasWallet: vaultBlob !== null,
            hasSession: sessionKey !== null,
            state,
        });
    });
});
