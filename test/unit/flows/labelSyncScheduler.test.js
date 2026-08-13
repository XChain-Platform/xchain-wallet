// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// §19.5.2 label auto-sync scheduler.
//
// The decided shape is "keep prompting for the seed, batch the edits":
// the scheduler debounces label/contact vault writes and raises AT MOST
// one publish per unlock window, so a rename storm costs one password
// prompt and one on-chain FILE write instead of one per edit. These
// tests drive a fake clock + fake timer so the cadence is asserted
// exactly rather than slept through.

import { describe, it, expect, vi } from 'vitest';
import {
    createLabelSyncScheduler,
    LABEL_SYNC_AUTO_DEBOUNCE_MS,
    LABEL_SYNC_AUTO_MAX_WAIT_MS,
} from '../../../packages/core/src/flows/labelSync.js';

/**
 * Deterministic clock + single-slot timer. `advance(ms)` moves the
 * clock and fires the armed callback when its deadline passes.
 */
function fakeEnv() {
    let clock = 1_000_000;
    /** @type {{ fn: () => void, at: number } | null} */
    let armed = null;
    let nextHandle = 1;
    return {
        now: () => clock,
        setTimer: (fn, ms) => {
            armed = { fn, at: clock + ms };
            nextHandle += 1;
            return nextHandle;
        },
        clearTimer: () => { armed = null; },
        armedAt: () => (armed ? armed.at : null),
        async advance(ms) {
            const target = clock + ms;
            // Loop: a fired callback may arm a new timer inside the window.
            for (;;) {
                if (armed && armed.at <= target) {
                    clock = armed.at;
                    const { fn } = armed;
                    armed = null;
                    fn();
                    // Let the async fire() body settle.
                    await Promise.resolve();
                    await Promise.resolve();
                    await Promise.resolve();
                    continue;
                }
                clock = target;
                return;
            }
        },
    };
}

function makeScheduler(overrides = {}) {
    const env = fakeEnv();
    const requestPublish = vi.fn();
    const scheduler = createLabelSyncScheduler({
        requestPublish,
        isEnabled: () => true,
        now: env.now,
        setTimer: env.setTimer,
        clearTimer: env.clearTimer,
        ...overrides,
    });
    return { env, requestPublish, scheduler };
}

describe('createLabelSyncScheduler cadence', () => {
    it('does not publish while edits keep arriving inside the quiet period', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        // Five edits 44s apart: each re-arms the 45s debounce and the
        // whole run (220s) stays inside the 300s ceiling.
        for (let i = 0; i < 5; i += 1) {
            scheduler.noteLabelChange({ walletId: 'w1' });
            await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS - 1_000);
        }
        expect(requestPublish).not.toHaveBeenCalled();
        expect(scheduler.status().pending).toBe(true);
        expect(scheduler.status().changeCount).toBe(5);
    });

    it('collapses a rename storm into ONE publish once the edits stop', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        for (let i = 0; i < 8; i += 1) {
            scheduler.noteLabelChange({ walletId: 'w1' });
            await env.advance(500);
        }
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        expect(requestPublish).toHaveBeenCalledTimes(1);
        const batch = requestPublish.mock.calls[0][0];
        expect(batch.changeCount).toBe(8);
        expect(batch.walletIds).toEqual(['w1']);
        expect(batch.reason).toBe('debounce');
    });

    it('fires at the max-wait ceiling when edits never stop', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        // One edit every 40s: each would re-arm a 45s debounce forever.
        for (let i = 0; i < 20; i += 1) {
            scheduler.noteLabelChange({ walletId: 'w1' });
            await env.advance(40_000);
            if (requestPublish.mock.calls.length > 0) break;
        }
        expect(requestPublish).toHaveBeenCalledTimes(1);
        expect(requestPublish.mock.calls[0][0].reason).toBe('maxWait');
        expect(requestPublish.mock.calls[0][0].dueAt)
            .toBeLessThanOrEqual(
                requestPublish.mock.calls[0][0].firstChangeAt + LABEL_SYNC_AUTO_MAX_WAIT_MS,
            );
    });

    it('caps at one publish per unlock window even after more edits', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        scheduler.noteLabelChange({ walletId: 'w1' });
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        expect(requestPublish).toHaveBeenCalledTimes(1);

        const r = scheduler.noteLabelChange({ walletId: 'w1' });
        expect(r.scheduled).toBe(false);
        expect(r.reason).toBe('window-consumed');
        await env.advance(LABEL_SYNC_AUTO_MAX_WAIT_MS * 2);
        expect(requestPublish).toHaveBeenCalledTimes(1);
        expect(scheduler.status().attemptedThisWindow).toBe(true);
    });

    it('carries edits made after the window was consumed into the next window', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        scheduler.noteLabelChange({ walletId: 'w1' });
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        scheduler.markPublished();

        scheduler.noteLabelChange({ walletId: 'w2' });
        await env.advance(LABEL_SYNC_AUTO_MAX_WAIT_MS * 2);
        expect(requestPublish).toHaveBeenCalledTimes(1);

        scheduler.endUnlockWindow();
        scheduler.beginUnlockWindow();
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        expect(requestPublish).toHaveBeenCalledTimes(2);
        expect(requestPublish.mock.calls[1][0].walletIds).toEqual(['w2']);
    });

    it('keeps the edits dirty when the prompt is cancelled, and retries next window', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        scheduler.noteLabelChange({ walletId: 'w1' });
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        expect(requestPublish).toHaveBeenCalledTimes(1);
        // User cancelled: no markPublished() call.
        expect(scheduler.status().pending).toBe(true);
        expect(scheduler.status().publishedThisWindow).toBe(false);

        scheduler.endUnlockWindow();
        scheduler.beginUnlockWindow();
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        expect(requestPublish).toHaveBeenCalledTimes(2);
        expect(requestPublish.mock.calls[1][0].changeCount).toBe(1);
    });

    it('markPublished clears the pending batch', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        scheduler.noteLabelChange({ walletId: 'w1' });
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        scheduler.markPublished();
        expect(scheduler.status().pending).toBe(false);
        expect(scheduler.status().changeCount).toBe(0);
        expect(scheduler.status().publishedThisWindow).toBe(true);
        expect(requestPublish).toHaveBeenCalledTimes(1);
    });

    it('a manual publish satisfies the pending auto-sync', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        scheduler.noteLabelChange({ walletId: 'w1' });
        // User hits "Publish now" before the debounce elapses.
        scheduler.markPublished();
        await env.advance(LABEL_SYNC_AUTO_MAX_WAIT_MS * 2);
        expect(requestPublish).not.toHaveBeenCalled();
        expect(scheduler.status().pending).toBe(false);
    });
});

describe('createLabelSyncScheduler lock state', () => {
    it('does not arm while locked, and publishes after the next unlock', async () => {
        const { env, requestPublish, scheduler } = makeScheduler({ startUnlocked: false });
        const r = scheduler.noteLabelChange({ walletId: 'w1' });
        expect(r.scheduled).toBe(false);
        expect(r.reason).toBe('locked');
        await env.advance(LABEL_SYNC_AUTO_MAX_WAIT_MS * 2);
        expect(requestPublish).not.toHaveBeenCalled();

        scheduler.beginUnlockWindow();
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        expect(requestPublish).toHaveBeenCalledTimes(1);
    });

    it('locking mid-debounce cancels the timer without losing the edits', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        scheduler.noteLabelChange({ walletId: 'w1' });
        await env.advance(1_000);
        scheduler.endUnlockWindow();
        expect(env.armedAt()).toBeNull();
        await env.advance(LABEL_SYNC_AUTO_MAX_WAIT_MS * 2);
        expect(requestPublish).not.toHaveBeenCalled();
        expect(scheduler.status().pending).toBe(true);
    });

    it('dispose stops everything', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        scheduler.noteLabelChange({ walletId: 'w1' });
        scheduler.dispose();
        await env.advance(LABEL_SYNC_AUTO_MAX_WAIT_MS * 2);
        expect(requestPublish).not.toHaveBeenCalled();
    });
});

describe('createLabelSyncScheduler opt-in gate', () => {
    it('publishes nothing when label sync is opted out, and drops the batch', async () => {
        const { env, requestPublish, scheduler } = makeScheduler({ isEnabled: () => false });
        scheduler.noteLabelChange({ walletId: 'w1' });
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        expect(requestPublish).not.toHaveBeenCalled();
        expect(scheduler.status().pending).toBe(false);
        // The window is NOT consumed: opting in later must still work.
        expect(scheduler.status().attemptedThisWindow).toBe(false);
    });

    it('defaults to disabled when no gate is supplied', async () => {
        const env = fakeEnv();
        const requestPublish = vi.fn();
        const scheduler = createLabelSyncScheduler({
            requestPublish,
            now: env.now,
            setTimer: env.setTimer,
            clearTimer: env.clearTimer,
        });
        scheduler.noteLabelChange({ walletId: 'w1' });
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        expect(requestPublish).not.toHaveBeenCalled();
    });

    it('an async gate that throws suppresses the publish instead of crashing', async () => {
        const onError = vi.fn();
        const { env, requestPublish, scheduler } = makeScheduler({
            isEnabled: async () => { throw new Error('vault closed'); },
            onError,
        });
        scheduler.noteLabelChange({ walletId: 'w1' });
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        expect(requestPublish).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
        expect(scheduler.status().pending).toBe(true);
    });
});

describe('createLabelSyncScheduler never holds secrets', () => {
    it('refuses a change notification carrying a secret-shaped key', () => {
        const { scheduler } = makeScheduler();
        for (const key of ['password', 'seed', 'mnemonic', 'bip39Passphrase', 'privateKey', 'wif']) {
            expect(() => scheduler.noteLabelChange({ walletId: 'w1', [key]: 'x' }))
                .toThrow(/never holds secrets/);
        }
    });

    it('hands the publish request only non-secret batch metadata', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        scheduler.noteLabelChange({ walletId: 'w1' });
        scheduler.noteLabelChange({});
        await env.advance(LABEL_SYNC_AUTO_DEBOUNCE_MS);
        const batch = requestPublish.mock.calls[0][0];
        expect(Object.keys(batch).sort()).toEqual(
            ['changeCount', 'dueAt', 'firstChangeAt', 'reason', 'walletIds'],
        );
    });

    it('status() exposes no secret material', async () => {
        const { env, scheduler } = makeScheduler();
        scheduler.noteLabelChange({ walletId: 'w1' });
        await env.advance(1_000);
        expect(Object.keys(scheduler.status()).sort()).toEqual([
            'attemptedThisWindow',
            'changeCount',
            'dueAt',
            'firstChangeAt',
            'pending',
            'publishedThisWindow',
            'unlocked',
            'walletIds',
            'windowId',
        ]);
    });
});

describe('createLabelSyncScheduler flush', () => {
    it('flush() publishes immediately and still honours the per-window cap', async () => {
        const { env, requestPublish, scheduler } = makeScheduler();
        scheduler.noteLabelChange({ walletId: 'w1' });
        const batch = await scheduler.flush();
        expect(batch?.reason).toBe('flush');
        expect(requestPublish).toHaveBeenCalledTimes(1);
        expect(await scheduler.flush()).toBeNull();
        await env.advance(LABEL_SYNC_AUTO_MAX_WAIT_MS * 2);
        expect(requestPublish).toHaveBeenCalledTimes(1);
    });

    it('flush() with nothing pending is a no-op', async () => {
        const { requestPublish, scheduler } = makeScheduler();
        expect(await scheduler.flush()).toBeNull();
        expect(requestPublish).not.toHaveBeenCalled();
    });
});
