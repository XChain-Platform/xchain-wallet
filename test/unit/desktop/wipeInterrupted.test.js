/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// A desktop reset unlinks the vault blob and the kdfParams meta one after
// the other. If the app quits (or the machine loses power) between the two,
// the next launch reads whatever is left. Meta with no blob is the bad half:
// session.status reads only the blob and answers no-wallet, so the app opens
// onboarding, and every create, import and restore there refuses with "A
// wallet already exists" because the meta is still on disk. No screen on
// that path offers a reset, so the user cannot get a wallet onto the device.
// A blob with no meta answers locked instead, and the lock screen's Forgot
// password reset finishes the job. So the meta goes first.

import { describe, expect, it, vi } from 'vitest';

import { createRuntime, wipeRuntimeStores } from '../../../packages/desktop/main/runtime.js';
import { handleSessionStatus } from '../../../packages/extension/src/background/sessionMeta.js';
import { applyExternalPanicModeState, isSigningFrozen } from '../../../packages/core/src/flows/panicMode.js';
import { assertFreshVault } from '../../../packages/extension/src/background/walletCreate.js';

/**
 * Two backends whose first clear lands and whose second never returns,
 * the shape of a quit between the two unlinks.
 */
function interruptedPair() {
    let clears = 0;
    /** @type {() => void} */
    let firstLanded = () => {};
    const landed = new Promise((resolve) => { firstLanded = resolve; });
    const make = (initial) => {
        let value = initial;
        return {
            load: vi.fn(async () => value),
            save: vi.fn(async (next) => { value = next; }),
            clear: vi.fn(() => {
                clears += 1;
                if (clears > 1) return new Promise(() => {});
                value = null;
                firstLanded();
                return Promise.resolve();
            }),
        };
    };
    return {
        storageBackend: make(new Uint8Array([1, 2, 3])),
        metaBackend: make({ kdfParams: { algo: 'argon2id', salt: 'AA' } }),
        landed,
    };
}

function sessionBackend() {
    return {
        load: vi.fn(async () => null),
        save: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
    };
}

describe('desktop reset interrupted between the vault and meta unlinks', () => {
    it('leaves an install that opens on a screen offering the reset again', async () => {
        const { storageBackend, metaBackend, landed } = interruptedPair();
        const session = sessionBackend();
        const runtime = createRuntime({
            storageBackend,
            metaBackend,
            sessionBackend: session,
            chainRegistry: {},
            sdkRegistry: {},
        });

        void wipeRuntimeStores(runtime);
        await landed;

        const status = await handleSessionStatus({ storageBackend, sessionBackend: session });
        if (status.state === 'no-wallet') {
            // Onboarding must then be able to create a wallet.
            await expect(assertFreshVault({ metaBackend, storageBackend })).resolves.toBeUndefined();
        } else {
            // The lock screen carries Forgot password, which runs the reset again.
            expect(status.state).toBe('locked');
        }
    });
});

describe('desktop reset whose meta file refuses to unlink', () => {
    function store(initial) {
        let value = initial;
        return {
            load: vi.fn(async () => value),
            save: vi.fn(async (next) => { value = next; }),
            clear: vi.fn(async () => { value = null; }),
        };
    }

    it('keeps the vault with its meta so the install still opens on the lock screen', async () => {
        const storageBackend = store(new Uint8Array([1, 2, 3]));
        const metaBackend = store({ kdfParams: { algo: 'argon2id', salt: 'AA' } });
        const refuse = metaBackend.clear;
        metaBackend.clear = vi.fn(async () => { throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); });
        const session = sessionBackend();
        const runtime = createRuntime({
            storageBackend,
            metaBackend,
            sessionBackend: session,
            chainRegistry: {},
            sdkRegistry: {},
        });

        const result = await wipeRuntimeStores(runtime);

        expect(result.ok).toBe(false);
        expect(result.errors.map((e) => e.store)).toEqual(['meta']);
        expect(await storageBackend.load()).not.toBe(null);
        const status = await handleSessionStatus({ storageBackend, sessionBackend: session });
        expect(status.state).toBe('locked');

        // Once the file answers, the retry from the lock screen completes the reset.
        metaBackend.clear = refuse;
        const retry = await wipeRuntimeStores(runtime);
        expect(retry.ok).toBe(true);
        expect(await storageBackend.load()).toBe(null);
        expect(await metaBackend.load()).toBe(null);
        await expect(assertFreshVault({ metaBackend, storageBackend })).resolves.toBeUndefined();
    });

    it('keeps the surviving wallet frozen in memory while its panic file stays armed', async () => {
        const armed = { activatedAt: Date.now(), expiresAt: Date.now() + 600_000, durationMs: 600_000, armedBy: 'user' };
        applyExternalPanicModeState(armed);
        const panicModeStore = store(armed);
        const metaBackend = store({ kdfParams: { algo: 'argon2id', salt: 'AA' } });
        metaBackend.clear = vi.fn(async () => { throw new Error('operation not permitted'); });
        const runtime = createRuntime({
            storageBackend: store(new Uint8Array([1, 2, 3])),
            metaBackend,
            sessionBackend: sessionBackend(),
            panicModeStore,
            chainRegistry: {},
            sdkRegistry: {},
        });
        try {
            const result = await wipeRuntimeStores(runtime);

            expect(result.ok).toBe(false);
            expect(await panicModeStore.load()).toEqual(armed);
            expect(isSigningFrozen()).toBe(true);

            // A completed retry lifts the freeze along with its file.
            metaBackend.clear = vi.fn(async () => {});
            expect((await wipeRuntimeStores(runtime)).ok).toBe(true);
            expect(isSigningFrozen()).toBe(false);
        } finally {
            applyExternalPanicModeState(null);
        }
    });
});
