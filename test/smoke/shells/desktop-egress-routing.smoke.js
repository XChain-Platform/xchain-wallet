// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Egress policy is applied before a desktop session can make a request.
//
// A Tor toggle applied at exactly one point, app boot, from a
// vault that was already open. Three things followed from that, and this
// smoke pins all three shut:
//
//   1. A session unlocked by PASSWORD never routed. `onUnlocked` called
//      `ensureHost` and nothing else, and `ensureHost` starts the price
//      oracle, the notification service and four address-polling watchers.
//      On a box with no OS keychain that is every launch.
//   2. The toggle itself did nothing until relaunch: `createRuntime`
//      dropped `onPrivacySettingsChanged` out of its returned object, so
//      the shared host's `settings.update` branch never had a callback to
//      call.
//   3. The boot chain-registry sync was kicked ahead of the routing apply,
//      so one request per launch left on the direct dispatcher.
//
// The assertions that matter are ORDER assertions: not "the callback
// exists" but "it had run before the host was built and before any watcher
// could start", because a callback that runs after the first request is
// the same lie with a later timestamp.

import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
const desktopMain = join(wsRoot, 'packages', 'desktop', 'main');

const password = 'correct horse battery staple';

/** Keychain that refuses to persist, i.e. the password-unlock-every-launch box. */
const noKeychain = {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => Buffer.from(b).toString('utf8'),
};

/**
 * Build a runtime whose egress hook records WHEN it ran, not just that it
 * did. `hostAtCall` is the ordering assertion: null means the hook ran
 * before `createDesktopMessageHost`, and therefore before every watcher.
 */
function buildRuntimeFor(userData, calls) {
    const chainRegistry = registryLib.defaultRegistry();
    const runtime = createRuntime({
        storageBackend: new FileStorageBackend(vaultPathFor(userData)),
        metaBackend: new FileMetaBackend(metaPathFor(userData)),
        sessionBackend: new KeychainSessionBackend({
            safeStorage: noKeychain,
            filePath: sessionKeyPathFor(userData),
        }),
        chainRegistry,
        sdkRegistry: new sdkLib.SDKRegistry({
            chainRegistry,
            sdkFactory: createDevMockSdk,
        }),
        onPrivacySettingsChanged: async (settings, ctx) => {
            calls.push({
                settings,
                sdkRegistry: ctx?.sdkRegistry ?? null,
                hostAtCall: runtime.host,
                notificationServiceAtCall: runtime.notificationService,
            });
        },
    });
    return runtime;
}

// --- 1. A password unlock routes, and routes BEFORE the host is built ---

{
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-egress-smoke-'));
    try {
        const calls = [];
        let runtime = buildRuntimeFor(tmp, calls);

        // Onboarding is itself an unlock: it fires onUnlocked -> ensureHost.
        const created = await handleIpcMessage(runtime, {
            type: 'wallet.create',
            request: { password, name: 'Egress Test', strengthBits: 128 },
        });
        assert.equal(created.ok, true, 'wallet.create succeeds');
        assert.ok(runtime.host, 'onUnlocked built the host');
        assert.equal(calls.length, 1, 'egress policy applied once on the create unlock');
        assert.equal(calls[0].hostAtCall, null,
            'egress policy applied BEFORE the message host was built');
        assert.equal(calls[0].notificationServiceAtCall, null,
            'egress policy applied BEFORE any watcher could start');
        assert.ok(calls[0].sdkRegistry,
            'egress hook receives the sdkRegistry it must re-pool');
        assert.equal(typeof calls[0].settings, 'object',
            'egress hook receives the vault settings it routes from');

        // No keychain, so nothing is cached: this is the every-launch state.
        tearDownHost(runtime);
        calls.length = 0;
        runtime = buildRuntimeFor(tmp, calls);
        assert.equal(await ensureHost(runtime), null,
            'no cached session key, so boot cannot open the vault');
        assert.equal(calls.length, 0,
            'a locked wallet applies nothing: settings are unreadable and no request is made');

        // THE REGRESSION: unlock by password routing nothing.
        const unlocked = await handleIpcMessage(runtime, {
            type: 'wallet.unlock',
            request: { password },
        });
        assert.equal(unlocked.ok, true, 'wallet.unlock succeeds');
        assert.ok(runtime.host, 'host rebuilt after the password unlock');
        assert.equal(calls.length, 1, 'the password unlock applied the egress policy');
        assert.equal(calls[0].hostAtCall, null,
            'password-unlock apply also precedes the host and its watchers');

        // --- 2. The toggle takes effect on the next request -------------

        const before = calls.length;
        const toggled = await handleIpcMessage(runtime, {
            type: 'settings.update',
            request: { patch: { privacy: { torRouting: true } } },
        });
        assert.equal(toggled.ok, true, 'settings.update with a privacy patch succeeds');
        assert.equal(calls.length, before + 1,
            'a privacy patch re-applies routing through the shared host');
        assert.equal(calls[calls.length - 1].settings?.privacy?.torRouting, true,
            're-apply is handed the MERGED settings, so it routes to the new value');

        const afterPrivacy = calls.length;
        const unrelated = await handleIpcMessage(runtime, {
            type: 'settings.update',
            request: { patch: { fiatCurrency: 'EUR' } },
        });
        assert.equal(unrelated.ok, true, 'settings.update with a non-privacy patch succeeds');
        assert.equal(calls.length, afterPrivacy,
            'a patch that does not touch privacy does not re-apply routing');
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// --- 3. The hook stays optional -----------------------------------------

// Unit tests and headless callers build runtimes without it, and they must
// still get a host rather than a crash on an unlocked vault.
{
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-egress-nohook-'));
    try {
        const chainRegistry = registryLib.defaultRegistry();
        const runtime = createRuntime({
            storageBackend: new FileStorageBackend(vaultPathFor(tmp)),
            metaBackend: new FileMetaBackend(metaPathFor(tmp)),
            sessionBackend: new KeychainSessionBackend({
                safeStorage: noKeychain,
                filePath: sessionKeyPathFor(tmp),
            }),
            chainRegistry,
            sdkRegistry: new sdkLib.SDKRegistry({ chainRegistry, sdkFactory: createDevMockSdk }),
        });
        assert.equal(runtime.onPrivacySettingsChanged, null,
            'an un-supplied egress hook is null, not undefined-by-omission');
        const created = await handleIpcMessage(runtime, {
            type: 'wallet.create',
            request: { password, name: 'No Hook', strengthBits: 128 },
        });
        assert.equal(created.ok, true, 'wallet.create succeeds with no egress hook');
        assert.ok(runtime.host, 'host still built with no egress hook');
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// --- 4. Nothing outruns the dispatcher swap at boot ---------------------

// index.js imports `electron`, so its ordering is pinned by source shape
// rather than executed here. Same fallback the diagnostic-dump smoke uses.
{
    const mainIndex = readFileSync(join(desktopMain, 'index.js'), 'utf8');

    const syncCalls = (mainIndex.match(/syncChainRegistryFromHub/g) || []).length;
    assert.equal(syncCalls, 1,
        'the hub registry sync is kicked from exactly one place');
    assert.ok(
        /function kickChainRegistrySync\(\)[\s\S]{0,600}?syncChainRegistryFromHub/.test(mainIndex),
        'that one place is kickChainRegistrySync()',
    );
    assert.ok(
        /await applyTorRouting\(\{[\s\S]{0,400}?\}\);\s*(?:\/\/[^\n]*\n\s*)*kickChainRegistrySync\(\);/
            .test(mainIndex),
        'the sync is kicked after applyTorRouting has resolved',
    );
    // Pin the ONLY half: a kick added ahead of the await reintroduces the
    // defect while the positive arm above still matches (it finds the
    // surviving post-await call), and the occurrence count above cannot see
    // it either, since kickChainRegistrySync() does not spell the sync name.
    const hookStart = mainIndex.indexOf('onPrivacySettingsChanged: async (');
    assert.ok(hookStart > -1, 'found the onPrivacySettingsChanged hook');
    const hookPrefix = mainIndex.slice(
        hookStart,
        mainIndex.indexOf('await applyTorRouting({', hookStart),
    );
    assert.ok(hookPrefix.length > 0, 'found the hook body ahead of applyTorRouting');
    assert.ok(
        !/kickChainRegistrySync\(|syncChainRegistryFromHub/.test(hookPrefix),
        'nothing kicks the hub sync before applyTorRouting is awaited',
    );
    const bootPrefix = mainIndex.slice(
        mainIndex.indexOf('app.whenReady().then('),
        mainIndex.indexOf('await ensureHost(runtime);'),
    );
    assert.ok(bootPrefix.length > 0, 'found the whenReady body ahead of the boot ensureHost');
    assert.ok(
        !/kickChainRegistrySync\(|syncChainRegistryFromHub/.test(bootPrefix),
        'nothing kicks the hub sync between whenReady and the boot ensureHost',
    );

    const runtimeSrc = readFileSync(join(desktopMain, 'runtime.js'), 'utf8');
    assert.ok(
        /onPrivacySettingsChanged:\s*deps\.onPrivacySettingsChanged/.test(runtimeSrc),
        'createRuntime persists the egress hook off deps',
    );
    assert.ok(
        /onPrivacySettingsChanged:\s*runtime\.onPrivacySettingsChanged/.test(runtimeSrc),
        'ensureHost forwards the egress hook into the host deps',
    );
}

console.log(
    'OK: desktop-egress-routing smoke (routing applies on every unlock, before host + watchers; a privacy patch re-applies it; the hub registry sync waits for the dispatcher swap)',
);
