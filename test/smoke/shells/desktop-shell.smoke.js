// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2: Step 16 (piece 5a): Electron main-process
// signing isolation (§9.3.2).
//
// Coverage:
//
//   1. Main-process files exist: index.js, messageHost.js, storage.js.
//   2. Preload lives at `packages/desktop/preload.js` and exposes
//      exactly `window.xchainWalletBridge.sendMessage`: no broader
//      Node/Electron surface leaks into the renderer.
//   3. Main reuses `createBackgroundHost` from extension: the
//      contract mirrors the extension wire format per §9.3.2.
//   4. FileStorageBackend round-trips a blob through the filesystem
//      correctly (load null-on-missing, save+load returns same bytes,
//      clear removes, re-load returns null).
//   5. Renderer messaging exports the popup/web parity surface
//      (unlockWallet, sendToken, issueToken, registerSigner, etc.).
//   6. Renderer App.jsx is `shell="desktop"`, imports every shared
//      route the popup + web shells do, and routes `'pair-signer'`
//      with real pairTrezorSigner + pairLedgerSigner factories (wired Step 18).
//   7. package.json declares `electron` + React deps at v0.54.0+,
//      workspace deps on core + extension.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import { FileStorageBackend, vaultPathFor } from '../../../packages/desktop/main/storage.js';
import { createDesktopMessageHost, IPC_CHANNEL } from '../../../packages/desktop/main/messageHost.js';
import { storage as storageLib, registry as registryLib } from '../../../packages/core/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const desktop = join(wsRoot, 'packages', 'desktop');
const ext = join(wsRoot, 'packages', 'extension');

// --- 1. Main-process files exist --------------------------------------

for (const rel of [
    'main/index.js',
    'main/messageHost.js',
    'main/storage.js',
    'preload.js',
    'renderer/main.jsx',
    'renderer/App.jsx',
    'renderer/index.html',
    'renderer/bridgeMessaging.js',
    'renderer/messaging.js',
]) {
    assert.ok(
        existsSync(join(desktop, rel)),
        `desktop shell has ${rel}`,
    );
}

// Confirm the old stub renderer/index.js (from the pre-Step-16
// scaffold) is gone: leaving it behind confuses the bundler.
assert.ok(
    !existsSync(join(desktop, 'renderer', 'index.js')),
    'old renderer/index.js stub removed (replaced by main.jsx + index.html)',
);

// --- 2. Preload exposes the narrow bridge -----------------------------

const preload = readFileSync(join(desktop, 'preload.js'), 'utf8');
assert.ok(
    /contextBridge\.exposeInMainWorld\('xchainWalletBridge'/.test(preload),
    'preload exposes the xchainWalletBridge namespace',
);
assert.ok(
    /sendMessage\(message\)/.test(preload),
    'preload exposes sendMessage(message)',
);
assert.ok(
    /ipcRenderer\.invoke\(/.test(preload),
    'preload uses ipcRenderer.invoke: not .send (we need a Promise reply)',
);
// Negative: preload must NOT import Node fs / path modules (which
// would smuggle Node capabilities into the contextBridge surface).
// Prose mentions of "process" / "Node" are fine.
assert.ok(
    !/from ['"]node:/.test(preload),
    'preload does NOT import node: modules',
);
assert.ok(
    !/require\s*\(/.test(preload),
    'preload does NOT use require(): contextBridge is the only renderer-facing API',
);

// --- 3. Main reuses createBackgroundHost ------------------------------

const mainIndex = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
const msgHost = readFileSync(join(desktop, 'main', 'messageHost.js'), 'utf8');
assert.ok(
    /createBackgroundHost/.test(msgHost),
    'messageHost.js reuses createBackgroundHost from extension: §9.3.2 "core runs unmodified across shells"',
);
assert.ok(
    /\.\.\/\.\.\/extension\/src\/background\/createBackgroundHost\.js/.test(msgHost),
    'messageHost.js imports from the extension package via cross-package relative path (matches hostBridge.js convention: smoke-resolvable under Node)',
);
assert.ok(
    /ipcMain\.handle\(IPC_CHANNEL/.test(mainIndex),
    'main/index.js registers ipcMain.handle for the bridge channel',
);
assert.ok(
    /contextIsolation:\s*true/.test(mainIndex)
        && /nodeIntegration:\s*false/.test(mainIndex)
        && /sandbox:\s*true/.test(mainIndex),
    'BrowserWindow is hardened: contextIsolation + no nodeIntegration + sandbox',
);

assert.equal(IPC_CHANNEL, 'xchain-wallet:message', 'IPC channel name is namespaced');

// --- 4. FileStorageBackend round-trip ---------------------------------

const tmp = mkdtempSync(join(tmpdir(), 'xchain-desktop-smoke-'));
try {
    const backend = new FileStorageBackend(vaultPathFor(tmp));
    assert.equal(await backend.load(), null, 'load returns null when no file exists');
    const blob = new Uint8Array([1, 2, 3, 4, 5]);
    await backend.save(blob);
    const loaded = await backend.load();
    assert.ok(loaded instanceof Uint8Array, 'load returns Uint8Array');
    assert.deepEqual(Array.from(loaded), [1, 2, 3, 4, 5], 'round-trip preserves bytes');
    await backend.clear();
    assert.equal(await backend.load(), null, 'clear removes the file; load returns null again');
    // Clearing an already-absent file is a no-op (ENOENT swallowed).
    await backend.clear();

    // MessageHost wiring works against the real Vault + file backend.
    const masterKey = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) masterKey[i] = (i + 1) & 0xff;
    const vault = new storageLib.Vault({ backend, masterKey });
    await vault.open();
    const { host, handle } = createDesktopMessageHost({
        vault,
        chainRegistry: registryLib.defaultRegistry(),
        sdkRegistry: { async getSdk() { throw new Error('stub'); }, async has() { return false; }, async listChainIds() { return []; } },
    });
    assert.ok(host, 'createDesktopMessageHost returns a host');
    const res = await handle({ type: 'wallet.list' });
    assert.equal(res.ok, true, 'wallet.list via the IPC-adapter handle succeeds');
    assert.ok(Array.isArray(res.result), 'wallet.list returns an array');

    // Unknown message type surfaces as the standard envelope.
    const bad = await handle({ type: 'nonexistent.type' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error.name, 'UnknownMessageTypeError');
    vault.close();
} finally {
    rmSync(tmp, { recursive: true, force: true });
}

// --- 5. Renderer messaging parity -------------------------------------

const rendererMsg = readFileSync(join(desktop, 'renderer', 'messaging.js'), 'utf8');
for (const fn of [
    'unlockWallet', 'lockWallet', 'listWallets', 'getWalletBalances',
    'getAddressesByChain', 'getNewestAddress', 'generateReceiveAddress',
    'createWallet', 'importMnemonic', 'sendToken', 'issueToken',
    'mintToken', 'destroyToken', 'registerSigner', 'listSigners',
    'unregisterSigner', 'exportPrivateKey', 'getSessionStatus',
]) {
    assert.ok(
        new RegExp(`export function ${fn}\\b`).test(rendererMsg),
        `renderer messaging.js exports ${fn}: popup/web parity`,
    );
}

// Equivalent fn set matches popup messaging: drift check.
const popupMsg = readFileSync(join(ext, 'src', 'popup', 'messaging.js'), 'utf8');
const popupFns = new Set(
    [...popupMsg.matchAll(/^export function (\w+)/gm)].map((m) => m[1]),
);
const desktopFns = new Set(
    [...rendererMsg.matchAll(/^export function (\w+)/gm)].map((m) => m[1]),
);
// Desktop is allowed a subset: but any fn the desktop exports should
// also exist in popup so shared routes never hit an undefined.
for (const fn of desktopFns) {
    assert.ok(
        popupFns.has(fn),
        `desktop messaging exports "${fn}" that popup messaging doesn't: shared routes may break`,
    );
}

// --- 6. Renderer App.jsx ----------------------------------------------

const rendererApp = readFileSync(join(desktop, 'renderer', 'App.jsx'), 'utf8');
assert.ok(
    /shell="desktop"/.test(rendererApp),
    'renderer App wraps in <MessagingProvider shell="desktop">',
);
for (const route of [
    'Loading', 'Onboarding', 'CreateWallet', 'ImportWallet', 'Locked', 'Home',
    'Send', 'Receive', 'TokenWizard', 'ActionsMenu', 'IssueTokenForm',
    'MintForm', 'DestroyForm', 'TokenAdminForm', 'PairSignerForm',
]) {
    assert.ok(
        rendererApp.includes(`@xchain-wallet/core/shared/routes/${route}.jsx`),
        `renderer App imports shared ${route}`,
    );
}
assert.ok(
    /pairTrezor=\{pairTrezorSigner\}/.test(rendererApp)
        && /pairLedger=\{pairLedgerSigner\}/.test(rendererApp),
    'renderer App wires real pairTrezorSigner + pairLedgerSigner factories (Step 18 §40.12)',
);

// --- 7. package.json deps ---------------------------------------------

const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
// Synchronized-versioning rule (feedback_wallet_versioning.md): every
// workspace package ships at the root version. Rather than pin to a
// literal, diff against the root and fail on drift.
const rootPkg = JSON.parse(readFileSync(join(wsRoot, 'package.json'), 'utf8'));
assert.equal(
    pkg.version,
    rootPkg.version,
    `desktop package.json version (${pkg.version}) should match root (${rootPkg.version})`,
);
assert.ok(pkg.dependencies['@xchain-wallet/core'], 'desktop deps on @xchain-wallet/core');
assert.ok(
    pkg.dependencies['@xchain-wallet/extension'],
    'desktop deps on @xchain-wallet/extension: reuses createBackgroundHost',
);
assert.ok(pkg.dependencies.react, 'desktop deps on react');
assert.ok(pkg.devDependencies.electron, 'desktop devDeps on electron');
assert.match(
    pkg.devDependencies.electron,
    /^\^\d/,
    'electron version is a caret range',
);
assert.ok(
    /Phase 2/.test(pkg.description),
    'desktop/package.json description still mentions Phase 2 (phase-scope smoke)',
);

// --- 8. Renderer bridge messaging unwraps envelopes correctly ----------

const bridgeSrc = readFileSync(join(desktop, 'renderer', 'bridgeMessaging.js'), 'utf8');
assert.ok(
    /xchainWalletBridge/.test(bridgeSrc),
    'bridgeMessaging references the contextBridge namespace',
);
assert.ok(
    /response\.ok/.test(bridgeSrc) && /response\.error/.test(bridgeSrc),
    'bridgeMessaging branches on response.ok / response.error to convert to resolve/reject',
);
assert.ok(
    /err\.name = response\.error\?\.name/.test(bridgeSrc),
    'bridgeMessaging preserves the typed error name so callers can branch on InvalidPasswordError etc.',
);

console.log(
    'OK: desktop shell smoke (main-process isolation scaffold §9.3.2: FileStorageBackend file round-trip, MessageHost reuses createBackgroundHost, preload exposes narrow bridge, renderer App.jsx mounts all shared routes under shell="desktop", messaging parity with popup/web, HW factories wired via WebHID + Trezor Connect)',
);
