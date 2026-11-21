// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// wallet.lock must finish what it started.
//
// Three bare awaits let the FIRST rejection abandon the rest: a session-key
// clear that throws skips the cached signing secret and skips the
// host/SignerPool teardown, leaving an open vault and live seed material
// behind a UI that has already rendered "locked". Every case below drives a
// rejecting step and asserts the remaining steps still ran.

import { describe, it, expect, vi } from 'vitest';

import {
    handleWalletLock,
    WalletLockIncompleteError,
    checkAutoLockDeadline,
    createHostBuildFlight,
    gateRestoredSession,
} from '../../../packages/extension/src/background/walletLock.js';
import { shouldAutoLock } from '../../../packages/extension/src/background/autoLockState.js';
import {
    ChromeSessionBackend,
    createSessionSaveFence,
} from '../../../packages/extension/src/storage/ChromeSessionBackend.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** A session backend stub whose clear() either resolves or rejects. */
function backend({ fails = false } = {}) {
    const calls = { clear: 0 };
    return {
        calls,
        clear: vi.fn(async () => {
            calls.clear += 1;
            if (fails) throw new Error('storage unavailable');
        }),
    };
}

describe('handleWalletLock', () => {
    it('returns locked and runs every step on the happy path', async () => {
        const sessionBackend = backend();
        const signingSecretBackend = backend();
        const onLocked = vi.fn();

        const result = await handleWalletLock(null, {
            sessionBackend, signingSecretBackend, onLocked,
        });

        expect(result).toEqual({ locked: true });
        expect(sessionBackend.calls.clear).toBe(1);
        expect(signingSecretBackend.calls.clear).toBe(1);
        expect(onLocked).toHaveBeenCalledTimes(1);
        expect(onLocked.mock.calls[0][0]).toEqual({ secretsCleared: true });
    });

    it('still clears the signing secret and tears down when the session clear fails', async () => {
        const sessionBackend = backend({ fails: true });
        const signingSecretBackend = backend();
        const onLocked = vi.fn();

        await expect(handleWalletLock(null, {
            sessionBackend, signingSecretBackend, onLocked,
        })).rejects.toBeInstanceOf(WalletLockIncompleteError);

        expect(signingSecretBackend.calls.clear).toBe(1);
        expect(onLocked).toHaveBeenCalledTimes(1);
        expect(onLocked.mock.calls[0][0]).toEqual({ secretsCleared: false });
    });

    it('still tears down when the signing-secret clear fails', async () => {
        const sessionBackend = backend();
        const signingSecretBackend = backend({ fails: true });
        const onLocked = vi.fn();

        await expect(handleWalletLock(null, {
            sessionBackend, signingSecretBackend, onLocked,
        })).rejects.toMatchObject({ name: 'WalletLockIncompleteError' });

        expect(sessionBackend.calls.clear).toBe(1);
        expect(onLocked).toHaveBeenCalledTimes(1);
        expect(onLocked.mock.calls[0][0]).toEqual({ secretsCleared: false });
    });

    it('still tears down when BOTH clears fail, and names both steps', async () => {
        const sessionBackend = backend({ fails: true });
        const signingSecretBackend = backend({ fails: true });
        const onLocked = vi.fn();

        const err = await handleWalletLock(null, {
            sessionBackend, signingSecretBackend, onLocked,
        }).catch((e) => e);

        expect(err).toBeInstanceOf(WalletLockIncompleteError);
        expect(err.steps).toEqual(['sessionBackend.clear', 'clearSigningSecret']);
        expect(onLocked).toHaveBeenCalledTimes(1);
    });

    it('reports a teardown failure instead of hiding it', async () => {
        const sessionBackend = backend();
        const signingSecretBackend = backend();
        const onLocked = vi.fn(async () => { throw new Error('teardown blew up'); });

        const err = await handleWalletLock(null, {
            sessionBackend, signingSecretBackend, onLocked,
        }).catch((e) => e);

        expect(err).toBeInstanceOf(WalletLockIncompleteError);
        expect(err.steps).toEqual(['onLocked']);
        // Both secrets were cleared before teardown was even attempted.
        expect(sessionBackend.calls.clear).toBe(1);
        expect(signingSecretBackend.calls.clear).toBe(1);
    });

    it('carries no secret material in the error it raises', async () => {
        const sessionBackend = {
            clear: async () => { throw new Error('hunter2 at key xchain-wallet:session'); },
        };
        const err = await handleWalletLock(null, {
            sessionBackend, signingSecretBackend: backend(), onLocked: () => { },
        }).catch((e) => e);

        expect(err.message).toBe('Wallet lock incomplete: sessionBackend.clear failed.');
        expect(err.message).not.toMatch(/hunter2/);
    });
});

describe('checkAutoLockDeadline', () => {
    const check = (state, now = 5_000) => checkAutoLockDeadline({
        readAutoLockState: async () => state,
        shouldAutoLock,
        now: () => now,
    });

    it('admits missing, disarmed and unexpired records', async () => {
        await expect(check(null)).resolves.toBe('valid');
        await expect(check({ armed: false })).resolves.toBe('valid');
        await expect(check({ armed: true, lastActivity: 4_500, idleMs: 1_000 })).resolves.toBe('valid');
    });

    it('rejects expired records without deferring to an active request', async () => {
        await expect(checkAutoLockDeadline({
            readAutoLockState: async () => ({ armed: true }),
            shouldAutoLock: () => true,
            isRequestActive: () => true,
            now: () => 5_000,
        })).resolves.toBe('expired');
    });

    it('rejects a record that storage cannot read', async () => {
        await expect(checkAutoLockDeadline({
            readAutoLockState: async () => { throw new Error('unreadable'); },
            shouldAutoLock: () => false,
        })).resolves.toBe('unreadable');
    });
});

describe('restored-session deadline gate', () => {
    const deferred = () => {
        let resolve;
        const promise = new Promise((done) => { resolve = done; });
        return { promise, resolve };
    };

    it('locks and zeroes an expired restore that is still current', async () => {
        const masterKey = new Uint8Array([1, 2, 3]);
        const lockWalletNow = vi.fn(async () => {});
        await expect(gateRestoredSession({
            masterKey,
            checkDeadline: async () => 'expired',
            isCurrent: () => true,
            lockWalletNow,
        })).resolves.toBe('expired');
        expect(lockWalletNow).toHaveBeenCalledOnce();
        expect([...masterKey]).toEqual([0, 0, 0]);
    });

    it('does not let an older expired restore lock a fresh unlock', async () => {
        const deadline = deferred();
        const masterKey = new Uint8Array([1, 2, 3]);
        const lockWalletNow = vi.fn(async () => {});
        let epoch = 0;
        const fence = createSessionSaveFence(() => { epoch += 1; });
        const restoreEpoch = epoch;
        const restoring = fence.track(gateRestoredSession({
            masterKey,
            checkDeadline: () => deadline.promise,
            isCurrent: () => restoreEpoch === epoch,
            lockWalletNow,
        }));
        const chromeStorage = {
            get: vi.fn(async () => ({})),
            set: vi.fn(async () => {}),
            remove: vi.fn(async () => {}),
        };
        const freshSession = new ChromeSessionBackend({
            chromeStorage,
            beforeSave: () => fence.beforeSave(),
        });
        const saving = freshSession.save(new Uint8Array([9]));
        expect(chromeStorage.set).not.toHaveBeenCalled();
        deadline.resolve('expired');

        await expect(restoring).resolves.toBe('superseded');
        await saving;
        expect(lockWalletNow).not.toHaveBeenCalled();
        expect(chromeStorage.set).toHaveBeenCalledOnce();
        expect([...masterKey]).toEqual([0, 0, 0]);
    });

    it('waits for an already-started stale lock before saving a fresh key', async () => {
        const lock = deferred();
        const lockStarted = deferred();
        let epoch = 0;
        const fence = createSessionSaveFence(() => { epoch += 1; });
        const restoring = fence.track(gateRestoredSession({
            masterKey: new Uint8Array([1]),
            checkDeadline: async () => 'expired',
            isCurrent: () => true,
            lockWalletNow: async () => {
                lockStarted.resolve();
                await lock.promise;
            },
        }));
        await lockStarted.promise;
        const chromeStorage = {
            get: vi.fn(async () => ({})),
            set: vi.fn(async () => {}),
            remove: vi.fn(async () => {}),
        };
        const session = new ChromeSessionBackend({
            chromeStorage,
            beforeSave: () => fence.beforeSave(),
        });

        const saving = session.save(new Uint8Array([9]));
        await Promise.resolve();
        expect(chromeStorage.set).not.toHaveBeenCalled();
        lock.resolve();
        await restoring;
        await saving;
        expect(chromeStorage.set).toHaveBeenCalledOnce();
        expect(epoch).toBe(1);
    });
});

// Boot, keepalive and unlock overlap in a waking worker; each extra build orphans a Vault.
describe('createHostBuildFlight', () => {
    const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };

    it('runs one build for concurrent callers and a fresh one after it settles', async () => {
        const gate = deferred();
        const build = vi.fn(() => gate.p);
        const ensure = createHostBuildFlight(build);
        const both = Promise.all([ensure(), ensure()]);
        gate.resolve('host');
        expect(await both).toEqual(['host', 'host']);
        expect(build).toHaveBeenCalledTimes(1);
        await ensure();
        expect(build).toHaveBeenCalledTimes(2);
    });

    it('rebuilds for a joiner whose shared build found no session yet', async () => {
        const gate = deferred();
        const build = vi.fn().mockReturnValueOnce(gate.p).mockResolvedValue('host');
        const ensure = createHostBuildFlight(build);
        const [first, joiner] = [ensure(), ensure()];
        gate.resolve(null);
        expect(await first).toBe(null);
        expect(await joiner).toBe('host');
    });

    it('clears a failed build so the next caller can retry', async () => {
        const build = vi.fn().mockRejectedValueOnce(new Error('open failed')).mockResolvedValue('host');
        const ensure = createHostBuildFlight(build);
        await expect(ensure()).rejects.toThrow('open failed');
        expect(await ensure()).toBe('host');
    });

    it('is what the service worker routes every ensureHost call through', () => {
        const bg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../packages/extension/src/background.js'), 'utf8');
        expect(bg).toMatch(/const ensureHost = createHostBuildFlight\(buildHost\);/);
        expect(bg).not.toMatch(/function ensureHost\(/);
    });

    it('validates a restored deadline before constructing or publishing a host', () => {
        const bg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../packages/extension/src/background.js'), 'utf8');
        const deadline = bg.indexOf('await sessionSaveFence.track(gateRestoredSession({');
        const vault = bg.indexOf('buildVault = new storageLib.Vault');
        const publish = bg.indexOf('detachHost = attachChromeRuntime');
        expect(deadline).toBeGreaterThan(-1);
        expect(deadline).toBeLessThan(vault);
        expect(vault).toBeLessThan(publish);
    });
});
