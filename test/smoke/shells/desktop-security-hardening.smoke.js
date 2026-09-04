// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the desktop stress-sweep hardening pass (§9.3.2 trust
// boundary + §26 unlock throttle + at-rest hygiene). Covers:
//
//   1. security.js navigation/sender predicates (pure).
//   2. FileUnlockThrottleStore round-trip + .tmp hygiene, and that a
//      pre-locked store makes runtime wallet.unlock fail BEFORE the KDF.
//   3. keychain/storage/meta clear() removes a half-written .tmp sibling.
//   4. signerBridgeListener: signerId ownership guard (a second sender
//      cannot re-point another sender's id), per-message cap, and the
//      injected sender-trust predicate.
//   5. index.js wires the navigation lockdown + sender checks (source scan;
//      index.js imports electron so it is scanned, not imported).

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    isLocalFileUrl,
    isAppUrl,
    isHttpUrl,
    shouldBlockNavigation,
    isRemoteFrameUrl,
    senderFrameUrl,
    isTrustedSenderEvent,
} from '../../../packages/desktop/main/security.js';
import {
    FileUnlockThrottleStore,
    unlockThrottlePathFor,
} from '../../../packages/desktop/main/unlockThrottle.js';
import { FileStorageBackend, vaultPathFor } from '../../../packages/desktop/main/storage.js';
import { FileMetaBackend, metaPathFor } from '../../../packages/desktop/main/meta.js';
import { KeychainSessionBackend, sessionKeyPathFor } from '../../../packages/desktop/main/keychain.js';
import { createRuntime, handleIpcMessage } from '../../../packages/desktop/main/runtime.js';
import {
    attachSignerBridgeListener,
    MAX_SIGNER_IDS_PER_MESSAGE,
} from '../../../packages/desktop/main/signerBridgeListener.js';
// Imported by the SAME specifier `signerBridgeListener.js` uses, never by a
// relative path to the same file. The registry is a process-wide
// singleton, so the ownership assertions in section 4 are only about the
// bridge while both sides resolve to one module instance; a relative import
// here splits into two copies wherever node_modules belongs to another
// checkout, and section 4 goes red as if the guard were broken. Full account
// in the header of desktop-signer-bridge.smoke.js.
import * as bgSignerBridge from '@xchain-wallet/extension/src/background/signerBridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');

// --- 1. security.js predicates ----------------------------------------

assert.equal(isLocalFileUrl('file:///a/b/index.html'), true);
assert.equal(isLocalFileUrl('https://x.example'), false);
assert.equal(isLocalFileUrl(undefined), false);

assert.equal(isHttpUrl('https://x.example'), true);
assert.equal(isHttpUrl('http://x.example'), true);
assert.equal(isHttpUrl('file:///a'), false);

// Trust is the packaged renderer DIRECTORY, never the file:// scheme:
// a downloaded HTML file must not read as the app and keep the preload.
const APP_ROOT = join(desktop, 'renderer', 'dist');
const appIndexUrl = pathToFileURL(join(APP_ROOT, 'index.html')).href;
const appIndexWithRoute = `${appIndexUrl}?xc-init-route=eyJ2IjoxfQ%3D%3D`;
const siblingDirUrl = pathToFileURL(join(`${APP_ROOT}-evil`, 'index.html')).href;
const traversalUrl = `${pathToFileURL(join(APP_ROOT, 'x')).href}/../../../evil.html`;

assert.equal(isAppUrl(appIndexUrl, APP_ROOT), true);
assert.equal(isAppUrl(appIndexWithRoute, APP_ROOT), true, 'our own ?xc-init-route load stays trusted');
assert.equal(isAppUrl(`${appIndexUrl}#/send`, APP_ROOT), true, 'hash routing stays trusted');
assert.equal(isAppUrl(siblingDirUrl, APP_ROOT), false, 'a sibling dist-evil/ dir is not the app');
assert.equal(isAppUrl(traversalUrl, APP_ROOT), false, 'dot-dot traversal out of the root is not the app');
assert.equal(isAppUrl('file:///tmp/evil.html', APP_ROOT), false, 'a downloaded local file is not the app');
assert.equal(isAppUrl('file://evil.example/share/index.html', APP_ROOT), false, 'a UNC/remote share is not the app');
assert.equal(isAppUrl('https://evil.example', APP_ROOT), false);
assert.equal(isAppUrl(appIndexUrl, undefined), false, 'no app root means nothing is the app');
assert.equal(isAppUrl('not a url', APP_ROOT), false);

// Navigation guard: block anything that is not this app's own renderer.
assert.equal(shouldBlockNavigation('https://evil.example', APP_ROOT), true);
assert.equal(shouldBlockNavigation('ftp://x', APP_ROOT), true);
assert.equal(shouldBlockNavigation('file:///tmp/evil.html', APP_ROOT), true);
assert.equal(shouldBlockNavigation(siblingDirUrl, APP_ROOT), true);
assert.equal(shouldBlockNavigation(appIndexUrl, APP_ROOT), false);
assert.equal(shouldBlockNavigation(appIndexWithRoute, APP_ROOT), false);
assert.equal(shouldBlockNavigation(appIndexUrl, undefined), true, 'a missing app root blocks, never allows');

// Remote-frame detection: anything not the app's own renderer is remote.
assert.equal(isRemoteFrameUrl('https://evil.example', APP_ROOT), true);
assert.equal(isRemoteFrameUrl('data:text/html,x', APP_ROOT), true);
assert.equal(isRemoteFrameUrl('blob:https://x/y', APP_ROOT), true);
assert.equal(isRemoteFrameUrl('file:///tmp/evil.html', APP_ROOT), true, 'a local file outside the app is remote');
assert.equal(isRemoteFrameUrl(siblingDirUrl, APP_ROOT), true);
assert.equal(isRemoteFrameUrl(appIndexUrl, APP_ROOT), false);
assert.equal(isRemoteFrameUrl('', APP_ROOT), false);            // unknown -> not treated remote
assert.equal(isRemoteFrameUrl(undefined, APP_ROOT), false);
assert.throws(
    () => isRemoteFrameUrl(appIndexUrl),
    /appRoot/,
    'a call site that forgot the app root throws instead of falling back to the scheme',
);

assert.equal(senderFrameUrl({ senderFrame: { url: 'file:///a' } }), 'file:///a');
assert.equal(senderFrameUrl({ sender: { getURL: () => 'https://x' } }), 'https://x');
assert.equal(senderFrameUrl({}), '');

assert.equal(isTrustedSenderEvent({ senderFrame: { url: appIndexUrl } }, APP_ROOT), true);
assert.equal(isTrustedSenderEvent({ senderFrame: { url: 'https://evil.example' } }, APP_ROOT), false);
assert.equal(isTrustedSenderEvent({ sender: { getURL: () => 'https://evil.example' } }, APP_ROOT), false);
assert.equal(
    isTrustedSenderEvent({ senderFrame: { url: 'file:///tmp/evil.html' } }, APP_ROOT),
    false,
    'a preload-bearing frame moved to an arbitrary local file loses IPC trust',
);
assert.equal(isTrustedSenderEvent({}, APP_ROOT), true, 'unknown sender is not positively remote');

// --- 2. FileUnlockThrottleStore + runtime pre-KDF gate ----------------

{
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-throttle-'));
    try {
        const store = new FileUnlockThrottleStore(unlockThrottlePathFor(tmp));
        assert.equal(await store.load(), null, 'missing store loads null');
        await store.save({ failCount: 3, lockedUntil: 123 });
        assert.deepEqual(await store.load(), { failCount: 3, lockedUntil: 123 }, 'round-trips state');
        // clear removes the live file AND any stray .tmp.
        writeFileSync(`${store.filePath}.tmp`, 'partial');
        await store.clear();
        assert.equal(existsSync(store.filePath), false, 'clear removes live file');
        assert.equal(existsSync(`${store.filePath}.tmp`), false, 'clear removes .tmp sibling');
        assert.equal(await store.load(), null, 'load null after clear');

        // Pre-lock the store, then drive wallet.unlock through the runtime:
        // the gate must reject BEFORE the KDF (no vault access needed).
        await store.save({ failCount: 99, lockedUntil: Date.now() + 60_000 });
        const runtime = createRuntime({
            storageBackend: { async load() { return null; }, async save() {}, async clear() {} },
            sessionBackend: { async load() { return null; }, async save() {}, async clear() {} },
            metaBackend: { async load() { return { kdfParams: { salt: 'aa', memory: 8, iterations: 1, parallelism: 1 } }; }, async save() {}, async clear() {} },
            unlockThrottleStore: store,
            chainRegistry: {},
            sdkRegistry: {},
        });
        assert.equal(runtime.unlockThrottleStore, store, 'runtime keeps the throttle store');
        const res = await handleIpcMessage(runtime, { type: 'wallet.unlock', request: { password: 'guess' } });
        assert.equal(res.ok, false, 'locked-out unlock is rejected');
        assert.equal(res.error.name, 'UnlockThrottledError', 'rejected via the pre-KDF throttle gate');
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// --- 3. clear() removes a half-written .tmp for every file backend ----

{
    const tmp = mkdtempSync(join(tmpdir(), 'xchain-tmphygiene-'));
    try {
        const storage = new FileStorageBackend(vaultPathFor(tmp));
        const meta = new FileMetaBackend(metaPathFor(tmp));
        const keychain = new KeychainSessionBackend({
            safeStorage: { isEncryptionAvailable: () => false },
            filePath: sessionKeyPathFor(tmp),
        });
        for (const backend of [storage, meta, keychain]) {
            const tmpSibling = `${backend.filePath}.tmp`;
            writeFileSync(backend.filePath, 'live');
            writeFileSync(tmpSibling, 'half-written-secret');
            await backend.clear();
            assert.equal(existsSync(backend.filePath), false, `${backend.filePath} live file removed`);
            assert.equal(existsSync(tmpSibling), false, `${tmpSibling} half-written sibling removed`);
        }
    } finally {
        rmSync(tmp, { recursive: true, force: true });
    }
}

// --- 4. signerBridgeListener ownership + cap + sender trust ------------

function fakeIpcMain() {
    const channels = new Map();
    return {
        on(ch, fn) { (channels.get(ch) || channels.set(ch, new Set()).get(ch)).add(fn); },
        off(ch, fn) { channels.get(ch)?.delete(fn); },
        _emit(ch, ev, msg) { for (const fn of channels.get(ch) || []) fn(ev, msg); },
    };
}
function fakeWc(id) {
    const sent = [];
    return {
        id,
        isDestroyed() { return false; },
        send(channel, msg) { sent.push({ channel, msg }); },
        once() {},
        _sent: sent,
    };
}
const CH = 'xchain-wallet:signer-bridge';

// 4a. Ownership: sender B cannot re-point sender A's signerId.
bgSignerBridge.clearAll();
{
    const ipc = fakeIpcMain();
    const detach = attachSignerBridgeListener({ ipcMain: ipc });
    const wcA = fakeWc(1);
    const wcB = fakeWc(2);
    ipc._emit(CH, { sender: wcA }, { kind: 'register', signerIds: ['sig-shared'] });
    ipc._emit(CH, { sender: wcB }, { kind: 'register', signerIds: ['sig-shared'] });
    const transport = bgSignerBridge.getTransport('sig-shared');
    assert.equal(typeof transport, 'function', 'sig-shared registered');
    // Fire a request over the transport: it must reach A (the owner), not B.
    // The promise stays pending (no renderer reply in this fake) and rejects
    // on detach(); swallow it so the process doesn't see an unhandled reject.
    transport({ op: 'status', payload: { signerId: 'sig-shared' } }).catch(() => {});
    assert.ok(wcA._sent.at(-1), 'owner A receives the request');
    assert.equal(wcA._sent.at(-1).msg.op, 'status');
    assert.equal(wcB._sent.length, 0, 'hijacker B never receives requests for a sig it does not own');
    // B may still register a DIFFERENT id of its own.
    ipc._emit(CH, { sender: wcB }, { kind: 'register', signerIds: ['sig-b'] });
    assert.equal(typeof bgSignerBridge.getTransport('sig-b'), 'function', 'B registers its own id');
    detach();
}

// 4b. Per-message cap: an over-cap register is dropped whole.
bgSignerBridge.clearAll();
{
    const ipc = fakeIpcMain();
    const detach = attachSignerBridgeListener({ ipcMain: ipc });
    const wc = fakeWc(3);
    const tooMany = Array.from({ length: MAX_SIGNER_IDS_PER_MESSAGE + 1 }, (_, i) => `flood-${i}`);
    ipc._emit(CH, { sender: wc }, { kind: 'register', signerIds: tooMany });
    assert.equal(bgSignerBridge.getTransport('flood-0'), null, 'over-cap register registers nothing');
    // A within-cap register still works.
    ipc._emit(CH, { sender: wc }, { kind: 'register', signerIds: ['ok-1'] });
    assert.equal(typeof bgSignerBridge.getTransport('ok-1'), 'function', 'within-cap register works');
    detach();
}

// 4c. Injected sender-trust predicate drops untrusted senders.
bgSignerBridge.clearAll();
{
    const ipc = fakeIpcMain();
    const detach = attachSignerBridgeListener({
        ipcMain: ipc,
        isTrustedSender: (event) => event?.sender?.id !== 999,
    });
    ipc._emit(CH, { sender: fakeWc(999) }, { kind: 'register', signerIds: ['from-untrusted'] });
    assert.equal(bgSignerBridge.getTransport('from-untrusted'), null, 'untrusted sender is dropped');
    ipc._emit(CH, { sender: fakeWc(7) }, { kind: 'register', signerIds: ['from-trusted'] });
    assert.equal(typeof bgSignerBridge.getTransport('from-trusted'), 'function', 'trusted sender registers');
    detach();
}
bgSignerBridge.clearAll();

// --- 5. index.js wires the lockdown (source scan) ---------------------

const mainIndex = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
for (const [needle, why] of [
    ["app.on('web-contents-created'", 'registers a global web-contents-created hook'],
    ['setWindowOpenHandler', 'denies window.open (routes external links to the OS browser)'],
    ["on('will-navigate'", 'blocks navigation away from the local app'],
    ["on('will-attach-webview'", 'refuses <webview> embedding'],
    ['shell.openExternal', 'external links go to the system browser'],
    ['isTrustedSender(event)', 'privileged IPC handlers check the sender frame'],
    ['FileUnlockThrottleStore', 'wires the file-backed unlock throttle'],
    ['attachSignerBridgeListener({ ipcMain, isTrustedSender })', 'signer bridge gets the sender-trust predicate'],
    ["const APP_ROOT = join(here, '..', 'renderer', 'dist')", 'defines the packaged renderer dir'],
    ['win.loadFile(join(APP_ROOT,', 'loads the renderer from that same dir, so the two cannot drift'],
    ['attachHidPermissions(session.defaultSession, { appRoot: APP_ROOT })', 'the HID grant is pinned to the app dir'],
]) {
    assert.ok(mainIndex.includes(needle), `index.js ${why}`);
}
assert.ok(
    /import \{[^}]*\bshell\b[^}]*\} from 'electron'/.test(mainIndex),
    'index.js imports shell from electron',
);

// Census: every call to a path-pinned predicate threads an app root. A
// one-argument call is the exact shape of the scheme-only regression, and
// the module now throws on it at runtime; catch it here instead. The
// negative control for this loop is the pre-fix tree, where all eight
// index.js call sites and the permissions.js one were single-argument.
{
    const pinned = ['isAppUrl', 'shouldBlockNavigation', 'isRemoteFrameUrl', 'isTrustedSenderEvent'];
    const sources = [
        ['main/index.js', mainIndex],
        ['main/permissions.js', readFileSync(join(desktop, 'main', 'permissions.js'), 'utf8')],
    ];
    let checked = 0;
    for (const [label, src] of sources) {
        for (const name of pinned) {
            const call = new RegExp(`\\b${name}\\(([^()]*)\\)`, 'g');
            for (const m of src.matchAll(call)) {
                checked += 1;
                assert.ok(
                    m[1].includes(','),
                    `${label}: ${m[0]} must pass an app root, not pin trust to the file:// scheme`,
                );
            }
        }
    }
    assert.ok(checked > 0, 'the call-site census found no calls at all, so it proved nothing');
}

console.log(
    'OK: desktop security-hardening smoke (security.js nav/sender predicates; FileUnlockThrottleStore round-trip + .tmp hygiene + runtime pre-KDF lockout; keychain/storage/meta clear() purges half-written .tmp; signerBridge ownership guard + per-message cap + injected sender-trust; index.js wires web-contents-created lockdown + IPC sender checks)',
);
