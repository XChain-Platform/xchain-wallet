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
