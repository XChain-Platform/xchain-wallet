// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke: desktop wallet wipe.
//
// The shared `wipeWalletStorage` helper clears localStorage and
// IndexedDB, and the desktop shell uses neither: its vault blob,
// kdfParams meta, cached session key and unlock throttle are files
// under `app.getPath('userData')`. So before this landed, both wipe
// paths (demo exit, Locked "forgot password") were silent no-ops on
// desktop and the reload handed the user an unlock screen for the vault
// they had just destroyed.
//
// Coverage:
//
//   1. wipeRuntimeStores unlinks all four stores, including the .tmp
//      siblings a crash mid-save may have left behind.
//   2. It tears the in-memory host down first, so nothing can write a
//      store back after the unlink.
//   3. A store that refuses to clear is reported, not swallowed, and
//      does not stop the other three from being cleared.
//   4. A runtime with no throttle store (older wiring) still wipes.
//   5. The preload publishes `xchainWalletBridge.wipeStorage` and
//      main/index.js registers the matching channel behind the same
//      trusted-sender gate as every other channel.
//   6. The shared renderer helper feature-detects that hook rather than
//      importing anything shell-specific (core imports no shell).

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import { createRuntime, wipeRuntimeStores } from '../../../packages/desktop/main/runtime.js';
import { FileStorageBackend, vaultPathFor } from '../../../packages/desktop/main/storage.js';
import { FileMetaBackend, metaPathFor } from '../../../packages/desktop/main/meta.js';
import { FileUnlockThrottleStore, unlockThrottlePathFor } from '../../../packages/desktop/main/unlockThrottle.js';
import { sessionKeyPathFor } from '../../../packages/desktop/main/keychain.js';
import { registry as registryLib } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const desktop = join(wsRoot, 'packages', 'desktop');

/**
 * A stand-in for KeychainSessionBackend: the real one needs Electron's
 * safeStorage, and the wipe only cares about the {clear} contract.
 */
function fakeSessionBackend(filePath) {
    return {
        cleared: 0,
        filePath,
        async load() { return null; },
        async save() {},
        async clear() {
            this.cleared += 1;
            for (const p of [filePath, `${filePath}.tmp`]) {
                if (existsSync(p)) rmSync(p);
            }
        },
    };
}

function makeUserData() {
    const dir = mkdtempSync(join(tmpdir(), 'xchain-wipe-'));
    mkdirSync(dir, { recursive: true });
    return dir;
}

function seedAllStores(userData) {
    const paths = {
        vault: vaultPathFor(userData),
        meta: metaPathFor(userData),
        session: sessionKeyPathFor(userData),
        throttle: unlockThrottlePathFor(userData),
    };
    for (const p of Object.values(paths)) {
        writeFileSync(p, 'seed', { mode: 0o600 });
        // The half-written sibling an atomic save leaves after a crash.
        writeFileSync(`${p}.tmp`, 'seed', { mode: 0o600 });
    }
    return paths;
}

function buildRuntime(userData, { sessionBackend } = {}) {
    return createRuntime({
        storageBackend: new FileStorageBackend(vaultPathFor(userData)),
        metaBackend: new FileMetaBackend(metaPathFor(userData)),
        sessionBackend: sessionBackend || fakeSessionBackend(sessionKeyPathFor(userData)),
        unlockThrottleStore: new FileUnlockThrottleStore(unlockThrottlePathFor(userData)),
        chainRegistry: registryLib.defaultRegistry(),
        // createRuntime only checks the registry is present; the wipe
        // path never touches the SDK.
        sdkRegistry: {},
    });
}

// --- 1 + 2. Every store goes, and the host is torn down first ---------

{
    const userData = makeUserData();
    try {
        const paths = seedAllStores(userData);
        const runtime = buildRuntime(userData);

        let vaultClosed = false;
        runtime.vault = { close() { vaultClosed = true; } };
        runtime.host = { handle: async () => ({ ok: true }) };

        const result = await wipeRuntimeStores(runtime);

        assert.equal(result.ok, true, 'wipe reports ok when every store cleared');
        assert.deepEqual(
            result.cleared.sort(),
            ['meta', 'session', 'storage', 'unlockThrottle'],
            'wipe clears all four desktop stores',
        );
        assert.deepEqual(result.errors, [], 'no per-store errors');

        for (const [name, p] of Object.entries(paths)) {
            assert.ok(!existsSync(p), `${name} store file is gone after the wipe`);
            assert.ok(!existsSync(`${p}.tmp`), `${name} .tmp sibling is gone after the wipe`);
        }
        // meta.json is THE bit that decides unlock-screen vs onboarding.
        assert.ok(!existsSync(metaPathFor(userData)), 'meta.json is gone: next boot lands on onboarding');

        assert.ok(vaultClosed, 'the in-memory vault is closed before the files go');
        assert.equal(runtime.host, null, 'the message host is dropped, so nothing can rewrite a store');
        assert.equal(runtime.vault, null, 'the vault reference is dropped');
    } finally {
        rmSync(userData, { recursive: true, force: true });
    }
}

// --- 3. A failing store is reported, the rest still clear -------------

{
    const userData = makeUserData();
    try {
        seedAllStores(userData);
        const runtime = buildRuntime(userData);
        runtime.metaBackend = {
            async clear() { throw new Error('EPERM: read-only volume'); },
        };

        const result = await wipeRuntimeStores(runtime);

        assert.equal(result.ok, false, 'a store that could not be cleared makes the wipe not-ok');
        assert.deepEqual(
            result.errors,
            [{ store: 'meta', message: 'EPERM: read-only volume' }],
            'the failing store is named so the renderer can say what survived',
        );
        assert.deepEqual(
            result.cleared.sort(),
            ['session', 'storage', 'unlockThrottle'],
            'one unwritable file does not strand the other three',
        );
        assert.ok(!existsSync(vaultPathFor(userData)), 'vault still cleared despite the meta failure');
    } finally {
        rmSync(userData, { recursive: true, force: true });
    }
}

// --- 4. Missing throttle store (older wiring) is not fatal ------------

{
    const userData = makeUserData();
    try {
        seedAllStores(userData);
        const runtime = buildRuntime(userData);
        runtime.unlockThrottleStore = null;

        const result = await wipeRuntimeStores(runtime);

        assert.equal(result.ok, true, 'absent optional store is skipped, not an error');
        assert.deepEqual(
            result.cleared.sort(),
            ['meta', 'session', 'storage'],
            'only the stores that exist are reported cleared',
        );
    } finally {
        rmSync(userData, { recursive: true, force: true });
    }
}

// Wiping an already-clean install must be a no-op, not a throw: the
// forgot-password path is reachable from a half-onboarded state.
{
    const userData = makeUserData();
    try {
        const runtime = buildRuntime(userData);
        const result = await wipeRuntimeStores(runtime);
        assert.equal(result.ok, true, 'wiping an empty userData dir succeeds');
    } finally {
        rmSync(userData, { recursive: true, force: true });
    }
}

await assert.rejects(
    () => wipeRuntimeStores(null),
    /runtime is required/,
    'wipeRuntimeStores refuses a missing runtime rather than reporting a phantom success',
);

// --- 5. Preload + main channel wiring ---------------------------------

const preload = readFileSync(join(desktop, 'preload.cjs'), 'utf8');
assert.ok(
    /wipeStorage\(\)\s*\{/.test(preload),
    'preload exposes wipeStorage() on the bridge',
);
assert.ok(
    /const WIPE_STORAGE_CHANNEL = 'xchain:wipe-storage'/.test(preload),
    'preload invokes the xchain:wipe-storage channel',
);
assert.ok(
    /wipeStorage\(\)\s*\{\s*return ipcRenderer\.invoke\(WIPE_STORAGE_CHANNEL\);/.test(preload),
    'wipeStorage takes no arguments: main decides what "wipe" means, not the renderer',
);

const mainIndex = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
const wipeHandler = mainIndex.slice(mainIndex.indexOf("ipcMain.handle('xchain:wipe-storage'"));
assert.ok(
    wipeHandler.startsWith("ipcMain.handle('xchain:wipe-storage'"),
    'main/index.js registers the xchain:wipe-storage channel',
);
assert.ok(
    /isTrustedSenderEvent\(event\)/.test(wipeHandler.slice(0, 400)),
    'the wipe channel is gated on a trusted sender: a remote frame cannot nuke a wallet',
);
assert.ok(
    /wipeRuntimeStores\(runtime\)/.test(wipeHandler.slice(0, 900)),
    'the wipe channel delegates to wipeRuntimeStores',
);

// --- 6. The renderer helper feature-detects the shell hook ------------

const wipeHelper = readFileSync(
    join(wsRoot, 'packages', 'core', 'src', 'shared', 'utils', 'wipeWalletStorage.js'),
    'utf8',
);
assert.ok(
    /xchainWalletBridge/.test(wipeHelper) && /wipeStorage/.test(wipeHelper),
    'the shared wipe helper routes through the bridge hook when a shell publishes one',
);
assert.ok(
    !/from ['"](\.\.\/)+.*(desktop|extension|web)\//.test(wipeHelper),
    'core imports nothing from a shell package: the hook is feature-detected',
);

console.log('OK desktop-wallet-wipe.smoke.js');
