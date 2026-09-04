// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2, Step 17 (piece 5b): OS keychain integration
// (§40.12).
//
// Coverage:
//
//   1. KeychainSessionBackend round-trip through a mock safeStorage:
//      - save → load returns identical bytes
//      - isAvailable() respects isEncryptionAvailable() + basic_text
//        refusal
//      - load returns null when the file is absent
//      - load returns null (not throw) on decrypt failure
//      - clear removes the file
//
//   2. FileMetaBackend round-trip: save + load preserves object shape,
//      clear removes the file, load on missing file returns null.
//
//   3. End-to-end runtime lifecycle against real crypto + mock
//      safeStorage:
//        a. Fresh runtime (empty userData) → session.status returns
//           `{ hasWallet: false, hasSession: false, state: 'no-wallet' }`.
//        b. wallet.create (onboarding) → onUnlocked fires, host is
//           built, session.bin contains the encrypted master key,
//           post-host messages route (balances.wallet returns an array).
//        c. "Restart": drop the runtime, build a fresh one against the
//           same userData → auto-unlock via the keychain. Renderer sees
//           `state: 'unlocked'` with no password prompt.
//        d. wallet.lock → session cleared, host torn down, subsequent
//           post-host messages return WalletLockedError.
//        e. wallet.unlock with wrong password → InvalidPasswordError,
//           session stays empty; right password → host rebuilt.
//
//   4. Static wiring: index.js + messageHost.js + runtime.js + keychain.js
//      + meta.js are all present, and main/index.js imports each.

import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    registry as registryLib,
    sdk as sdkLib,
} from '../../../packages/core/src/index.js';
import { createDevMockSdk } from '../../../packages/extension/src/background/sdkFactory.js';
import {
    FileMetaBackend,
    metaPathFor,
} from '../../../packages/desktop/main/meta.js';
import {
    KeychainSessionBackend,
    sessionKeyPathFor,
} from '../../../packages/desktop/main/keychain.js';
import {
    FileStorageBackend,
    vaultPathFor,
} from '../../../packages/desktop/main/storage.js';
import {
    createRuntime,
    ensureHost,
    handleIpcMessage,
    tearDownHost,
} from '../../../packages/desktop/main/runtime.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const desktop = join(wsRoot, 'packages', 'desktop');

// --- Mocks ------------------------------------------------------------

/**
 * Mock safeStorage: symmetric scramble over bytes (XOR with a fixed
 * key). Not remotely secure, but round-trips faithfully and exposes the
 * isEncryptionAvailable / getSelectedStorageBackend knobs we care
 * about. Tests use this to pretend the OS keychain is present.
 */
function makeMockSafeStorage(opts = {}) {
    const available = opts.isEncryptionAvailable !== false;
    const backend = opts.getSelectedStorageBackend ?? 'keychain_access';
    const xorKey = 0x5a;
    return {
        isEncryptionAvailable: () => available,
        getSelectedStorageBackend: () => backend,
        encryptString(plain) {
            const bytes = Buffer.from(plain, 'utf8');
            const out = Buffer.alloc(bytes.length);
            for (let i = 0; i < bytes.length; i += 1) out[i] = bytes[i] ^ xorKey;
            return out;
        },
        decryptString(cipher) {
            const buf = Buffer.isBuffer(cipher) ? cipher : Buffer.from(cipher);
            const out = Buffer.alloc(buf.length);
            for (let i = 0; i < buf.length; i += 1) out[i] = buf[i] ^ xorKey;
            return out.toString('utf8');
        },
    };
}

function buildRuntimeFor(userData, safeStorage) {
    const chainRegistry = registryLib.defaultRegistry();
    return createRuntime({
        storageBackend: new FileStorageBackend(vaultPathFor(userData)),
        metaBackend: new FileMetaBackend(metaPathFor(userData)),
        sessionBackend: new KeychainSessionBackend({
            safeStorage,
            filePath: sessionKeyPathFor(userData),
        }),
        chainRegistry,
        sdkRegistry: new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: createDevMockSdk,
        }),
    });
}

// --- 1. KeychainSessionBackend round-trip -----------------------------

{
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-keychain-smoke-'));
    try {
        const safeStorage = makeMockSafeStorage();
        const backend = new KeychainSessionBackend({
            safeStorage,
            filePath: sessionKeyPathFor(tmp),
        });
        assert.equal(backend.isAvailable(), true, 'isAvailable when keychain mock is healthy');
        assert.equal(await backend.load(), null, 'load returns null before any save');

        const key = new Uint8Array(32);
        for (let i = 0; i < 32; i += 1) key[i] = (i * 7 + 3) & 0xff;
        await backend.save(key);

        assert.ok(existsSync(sessionKeyPathFor(tmp)), 'save creates session.bin');

        // The ciphertext must not equal the plaintext. Verify the scramble
        // actually ran. (Not cryptographic, just a sanity check that the
        // wrapper hit safeStorage.encryptString.)
        const rawFile = readFileSync(sessionKeyPathFor(tmp));
        assert.notEqual(
            rawFile.toString('hex'),
            Buffer.from(key).toString('hex'),
            'session.bin is NOT plaintext',
        );

        const loaded = await backend.load();
        assert.ok(loaded instanceof Uint8Array, 'load returns Uint8Array');
        assert.deepEqual(Array.from(loaded), Array.from(key), 'round-trip preserves bytes');

        await backend.clear();
        assert.equal(await backend.load(), null, 'clear removes the file');
        // Clearing an already-absent file is a no-op.
        await backend.clear();
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// isAvailable refuses when encryption unavailable OR backend is basic_text.
{
    const unavailable = new KeychainSessionBackend({
        safeStorage: makeMockSafeStorage({ isEncryptionAvailable: false }),
        filePath: sessionKeyPathFor('/tmp/xchain-never-written'),
    });
    assert.equal(unavailable.isAvailable(), false, 'isAvailable=false when encryption unavailable');

    const basicText = new KeychainSessionBackend({
        safeStorage: makeMockSafeStorage({ getSelectedStorageBackend: 'basic_text' }),
        filePath: sessionKeyPathFor('/tmp/xchain-never-written'),
    });
    assert.equal(
        basicText.isAvailable(),
        false,
        'isAvailable=false when Electron selected basic_text (no real keychain)',
    );

    // save() must be a no-op when unavailable (never creates the file).
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-keychain-unavail-'));
    try {
        const b = new KeychainSessionBackend({
            safeStorage: makeMockSafeStorage({ isEncryptionAvailable: false }),
            filePath: sessionKeyPathFor(tmp),
        });
        const key = new Uint8Array(32);
        await b.save(key);
        assert.equal(
            existsSync(sessionKeyPathFor(tmp)),
            false,
            'save is a no-op when keychain is unavailable',
        );
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// load returns null (not throws) on decrypt failure. Simulates OS
// logout, keychain reset, or ciphertext corruption. Uses two separate
// backend instances (one to plant the file, one to read it) so the
// in-memory cache isn't populated when load runs.
{
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-keychain-corrupt-'));
    try {
        // First instance writes the file with a working mock.
        const working = makeMockSafeStorage();
        const writer = new KeychainSessionBackend({
            safeStorage: working,
            filePath: sessionKeyPathFor(tmp),
        });
        await writer.save(new Uint8Array(32));

        // Second instance (simulating a fresh process after OS logout)
        // reads the file, but decryptString throws.
        const failing = {
            isEncryptionAvailable: () => true,
            getSelectedStorageBackend: () => 'keychain_access',
            encryptString: (s) => Buffer.from(s, 'utf8'),
            decryptString: () => { throw new Error('keychain read failed'); },
        };
        const reader = new KeychainSessionBackend({
            safeStorage: failing,
            filePath: sessionKeyPathFor(tmp),
        });
        const loaded = await reader.load();
        assert.equal(loaded, null, 'load returns null when decryptString throws (fresh process)');
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// --- 2. FileMetaBackend round-trip ------------------------------------

{
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-meta-smoke-'));
    try {
        const meta = new FileMetaBackend(metaPathFor(tmp));
        assert.equal(await meta.load(), null, 'meta load returns null before any save');
        const payload = { kdfParams: { memory: 64, iterations: 3, salt: 'abc123' } };
        await meta.save(payload);
        const loaded = await meta.load();
        assert.deepEqual(loaded, payload, 'meta round-trip preserves object');
        await meta.clear();
        assert.equal(await meta.load(), null, 'meta clear removes the file');
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// --- 3. End-to-end runtime lifecycle ----------------------------------

{
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-runtime-smoke-'));
    const safeStorage = makeMockSafeStorage();
    const password = 'correct horse battery staple';

    try {
        // 3a. Fresh runtime, no wallet yet.
        let runtime = buildRuntimeFor(tmp, safeStorage);
        const status0 = await handleIpcMessage(runtime, { type: 'session.status' });
        assert.deepEqual(
            status0,
            { ok: true, result: { hasWallet: false, hasSession: false, state: 'no-wallet' } },
            'session.status returns no-wallet before onboarding',
        );

        // 3b. wallet.create → onboarding
        const createResp = await handleIpcMessage(runtime, {
            type: 'wallet.create',
            request: { password, name: 'Desktop Test', strengthBits: 128 },
        });
        assert.equal(createResp.ok, true, 'wallet.create succeeds');
        assert.ok(
            typeof createResp.result.mnemonic === 'string'
                && createResp.result.mnemonic.split(/\s+/).length === 12,
            'wallet.create returns a 12-word mnemonic',
        );
        assert.equal(createResp.result.walletName, 'Desktop Test');

        // Host was built as a side-effect of onUnlocked.
        assert.ok(runtime.host, 'onUnlocked built the host');
        assert.ok(runtime.vault, 'vault is open');

        // Session file exists + contains non-plaintext bytes.
        assert.ok(
            existsSync(sessionKeyPathFor(tmp)),
            'session.bin persisted after wallet.create',
        );

        // Post-host message routes through the built host.
        const status1 = await handleIpcMessage(runtime, { type: 'session.status' });
        assert.equal(status1.result.state, 'unlocked', 'state=unlocked after create');
        const listResp = await handleIpcMessage(runtime, { type: 'wallet.list' });
        assert.equal(listResp.ok, true, 'wallet.list routes into the host');
        assert.ok(Array.isArray(listResp.result), 'wallet.list returns an array');
        assert.equal(listResp.result.length, 1, 'created wallet appears in wallet.list');
        assert.equal(listResp.result[0].name, 'Desktop Test');

        // 3c. "Restart": drop runtime, build a fresh one against the
        // same userData. ensureHost should auto-unlock via the keychain
        // with no password prompt.
        tearDownHost(runtime);
        runtime = buildRuntimeFor(tmp, safeStorage);
        await ensureHost(runtime);
        assert.ok(runtime.host, 'auto-unlock rebuilt the host from session.bin');
        const status2 = await handleIpcMessage(runtime, { type: 'session.status' });
        assert.equal(
            status2.result.state,
            'unlocked',
            'fresh runtime sees state=unlocked thanks to the keychain cache',
        );

        // 3d. wallet.lock → host torn down, session cleared
        const lockResp = await handleIpcMessage(runtime, { type: 'wallet.lock' });
        assert.deepEqual(lockResp, { ok: true, result: { locked: true } });
        assert.equal(runtime.host, null, 'lock tore down the host');
        assert.equal(
            existsSync(sessionKeyPathFor(tmp)),
            false,
            'lock cleared session.bin',
        );

        // Post-host messages now return WalletLockedError.
        const blocked = await handleIpcMessage(runtime, { type: 'wallet.list' });
        assert.equal(blocked.ok, false);
        assert.equal(blocked.error.name, 'WalletLockedError');

        // session.status still reports locked (wallet exists, session doesn't).
        const status3 = await handleIpcMessage(runtime, { type: 'session.status' });
        assert.equal(status3.result.state, 'locked');
        assert.equal(status3.result.hasWallet, true);
        assert.equal(status3.result.hasSession, false);

        // 3e. wallet.unlock: wrong password → InvalidPasswordError.
        const bad = await handleIpcMessage(runtime, {
            type: 'wallet.unlock',
            request: { password: 'nope' },
        });
        assert.equal(bad.ok, false);
        assert.equal(bad.error.name, 'InvalidPasswordError');
        assert.equal(runtime.host, null, 'host not built on bad unlock');
        assert.equal(
            existsSync(sessionKeyPathFor(tmp)),
            false,
            'session.bin not written on bad unlock',
        );

        // Right password → unlocks, rebuilds host, session persists.
        const good = await handleIpcMessage(runtime, {
            type: 'wallet.unlock',
            request: { password },
        });
        assert.deepEqual(good, { ok: true, result: { unlocked: true, passphraseCaptureNeeded: [] } });
        assert.ok(runtime.host, 'host rebuilt after unlock');
        assert.ok(
            existsSync(sessionKeyPathFor(tmp)),
            'session.bin rewritten after unlock',
        );
    } finally {
        if (false) { /* placeholder, no-op */ }
        try { tearDownHost(buildRuntimeFor(tmp, safeStorage)); } catch (_e) { /* cleanup */ }
        rmSync(tmp, { recursive: true, force: true });
    }
}

// --- 4. Keychain-unavailable path forces per-launch unlock ------------

{
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-runtime-nokc-'));
    const safeStorage = makeMockSafeStorage({ isEncryptionAvailable: false });
    const password = 'correct horse battery staple';
    try {
        let runtime = buildRuntimeFor(tmp, safeStorage);
        const createResp = await handleIpcMessage(runtime, {
            type: 'wallet.create',
            request: { password, name: 'No-Keychain Test' },
        });
        assert.equal(createResp.ok, true, 'wallet.create succeeds even without a keychain');
        assert.ok(runtime.host, 'host built in-memory');

        // But session.bin is NOT on disk. Keychain was unavailable.
        assert.equal(
            existsSync(sessionKeyPathFor(tmp)),
            false,
            'session.bin NOT written when keychain unavailable (no insecure cache)',
        );

        // "Restart": fresh runtime can't auto-unlock; state stays locked.
        tearDownHost(runtime);
        runtime = buildRuntimeFor(tmp, safeStorage);
        await ensureHost(runtime);
        assert.equal(runtime.host, null, 'no auto-unlock when keychain unavailable');
        const status = await handleIpcMessage(runtime, { type: 'session.status' });
        assert.equal(status.result.state, 'locked', 'state=locked, password prompt required');
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// --- 5. Static wiring -------------------------------------------------

for (const rel of [
    'main/index.js',
    'main/messageHost.js',
    'main/storage.js',
    'main/meta.js',
    'main/keychain.js',
    'main/runtime.js',
]) {
    assert.ok(
        existsSync(join(desktop, rel)),
        `desktop main has ${rel}`,
    );
}

const mainIndex = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
assert.ok(
    /from ['"]\.\/keychain\.js['"]/.test(mainIndex),
    'main/index.js imports keychain.js',
);
assert.ok(
    /from ['"]\.\/meta\.js['"]/.test(mainIndex),
    'main/index.js imports meta.js',
);
assert.ok(
    /from ['"]\.\/runtime\.js['"]/.test(mainIndex),
    'main/index.js imports runtime.js',
);
assert.ok(
    /safeStorage/.test(mainIndex),
    'main/index.js references Electron safeStorage',
);
assert.ok(
    /ensureHost\(runtime\)/.test(mainIndex),
    'main/index.js calls ensureHost on app ready (auto-unlock path)',
);

const runtimeSrc = readFileSync(join(desktop, 'main', 'runtime.js'), 'utf8');
assert.ok(
    /dispatchPreHost/.test(runtimeSrc),
    'runtime.js routes pre-host types via dispatchPreHost',
);
assert.ok(
    /PRE_HOST_MESSAGE_TYPES/.test(runtimeSrc),
    'runtime.js gates on PRE_HOST_MESSAGE_TYPES',
);
assert.ok(
    /WalletLockedError/.test(runtimeSrc),
    'runtime.js returns WalletLockedError when host is null',
);

const keychainSrc = readFileSync(join(desktop, 'main', 'keychain.js'), 'utf8');
assert.ok(
    /isEncryptionAvailable/.test(keychainSrc),
    'keychain.js checks isEncryptionAvailable',
);
assert.ok(
    /basic_text/.test(keychainSrc),
    'keychain.js refuses basic_text backend',
);

console.log(
    'OK: desktop keychain smoke (Step 17 §40.12: KeychainSessionBackend round-trip + isAvailable guards, FileMetaBackend round-trip, end-to-end runtime lifecycle with create/auto-unlock/lock/unlock cycle, keychain-unavailable path forces per-launch unlock, static wiring check)',
);
