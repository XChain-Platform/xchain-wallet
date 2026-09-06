// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for Phase 2, Step 18 (piece 5c): core HW factory builders
// (§40.12).
//
// Steps 13–14 introduced `TrezorSigner` / `LedgerSigner` as DI-based
// classes with no HW SDK imports in core. Step 18 pushes that DI
// posture up one level: the *pair sequence* (getFeatures → derive
// identifier → construct signer) now lives in core too, behind
// `makeTrezorFactory` / `makeLedgerFactory`. Each shell (extension /
// web / desktop) owns the shell-specific transport init (lazy-import
// @trezor/connect-web, WebHID `TransportWebHID.create`, etc.) and
// calls the core builder with a `getConnect` / `getTransport` closure.
//
// Coverage:
//
//   1. Core builders exist + core has zero HW SDK imports.
//   2. `makeTrezorFactory` validates deps + runs end-to-end against a
//      mock Connect: success returns `{ signer, pairingInfo }` with
//      the expected shape; cancelled pairing surfaces an error; bad
//      Connect shape throws.
//   3. `makeLedgerFactory` validates deps + runs end-to-end against a
//      mock transport + mock app-class: success returns signer +
//      pairingInfo; missing Bitcoin app surfaces an error; bad Btc
//      class throws.
//   4. Desktop renderer factories exist, import the core builder, and
//      lazy-import the HW SDKs.
//   5. Desktop package.json declares the HW deps at extension-parity
//      versions.
//   6. Desktop renderer App.jsx wires the real factories into
//      PairSignerForm (no more `undefined` placeholders).
//   7. Main-process WebHID permission handlers are in place +
//      vendor-ID allowlist covers Ledger + both Trezor variants.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
}

import {
    signerFactories,
    signers,
} from '../../../packages/core/src/index.js';
import {
    HID_VENDOR_ALLOWLIST,
    attachHidPermissions,
    isAllowedHidVendor,
    isAppHidCheck,
    isAppHidSelect,
    isRemoteHidOrigin,
} from '../../../packages/desktop/main/permissions.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const core = join(wsRoot, 'packages', 'core');
const desktop = join(wsRoot, 'packages', 'desktop');

const { makeTrezorFactory, makeLedgerFactory } = signerFactories;
const { TrezorSigner, LedgerSigner } = signers;

// --- 1. Core builders exist + no HW SDK imports ------------------------

for (const rel of [
    'src/signerFactories/index.js',
    'src/signerFactories/trezor.js',
    'src/signerFactories/ledger.js',
]) {
    assert.ok(existsSync(join(core, rel)), `core has ${rel}`);
}

assert.equal(typeof makeTrezorFactory, 'function', 'core exports makeTrezorFactory');
assert.equal(typeof makeLedgerFactory, 'function', 'core exports makeLedgerFactory');

const coreTrezor = stripComments(
    readFileSync(join(core, 'src', 'signerFactories', 'trezor.js'), 'utf8'),
);
const coreLedger = stripComments(
    readFileSync(join(core, 'src', 'signerFactories', 'ledger.js'), 'utf8'),
);
assert.ok(!/@trezor\//.test(coreTrezor), 'core trezor.js has no @trezor/* imports (real code)');
assert.ok(!/@ledgerhq\//.test(coreLedger), 'core ledger.js has no @ledgerhq/* imports (real code)');

function stripComments(src) {
    // Line comments + /* … */ blocks. Good enough for our own source;
    // no strings containing `//` or `/*` markers.
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
}

// --- 2. makeTrezorFactory ---------------------------------------------

assert.throws(
    () => makeTrezorFactory({}),
    /getConnect must be a function/,
    'makeTrezorFactory rejects missing getConnect',
);

{
    // Mock Connect that matches TrezorSigner's expected shape enough
    // for the pair sequence. Exact features shape mirrors the Step-13
    // trezor-signer smoke.
    function makeMockConnect(overrides = {}) {
        return {
            async getFeatures() {
                return {
                    success: true,
                    payload: {
                        device_id: 'mock-device-id',
                        label: 'My Trezor',
                        internal_model: 'T2T1',
                        major_version: 2,
                        minor_version: 7,
                        patch_version: 2,
                        ...(overrides.featuresPayload ?? {}),
                    },
                };
            },
            ...overrides,
        };
    }

    // Success path.
    const pair = makeTrezorFactory({
        getConnect: async () => makeMockConnect(),
    });
    const result = await pair();
    assert.ok(result.signer instanceof TrezorSigner, 'success returns a TrezorSigner');
    assert.equal(result.pairingInfo.vendor, 'trezor');
    assert.equal(result.pairingInfo.deviceIdentifier, 'mock-device-id');
    assert.equal(result.pairingInfo.firmwareVersion, '2.7.2');
    assert.ok(
        typeof result.pairingInfo.model === 'string' && result.pairingInfo.model.length > 0,
        'pairingInfo.model is a non-empty string derived from device features',
    );

    // User cancellation / device rejection.
    const failPair = makeTrezorFactory({
        getConnect: async () => ({
            async getFeatures() {
                return { success: false, payload: { error: 'User cancelled' } };
            },
        }),
    });
    await assert.rejects(
        failPair(),
        /User cancelled/,
        'cancelled pairing surfaces the device error message',
    );

    // getConnect returns something that isn't a TrezorConnect.
    const badShape = makeTrezorFactory({
        getConnect: async () => ({ notAConnect: true }),
    });
    await assert.rejects(
        badShape(),
        /getConnect did not return a usable TrezorConnect/,
        'non-Connect getConnect resolution rejects clearly',
    );
}

// --- 3. makeLedgerFactory ---------------------------------------------

assert.throws(
    () => makeLedgerFactory({ getAppClass: () => {} }),
    /getTransport must be a function/,
    'makeLedgerFactory rejects missing getTransport',
);
assert.throws(
    () => makeLedgerFactory({ getTransport: () => {} }),
    /getAppClass must be a function/,
    'makeLedgerFactory rejects missing getAppClass',
);

{
    // Mock Ledger Btc app + transport (matches the shape pairing
    // exercises: getWalletPublicKey on the app client, and the app
    // name/version read as BOLOS bytes off the transport, since the real
    // Btc class ships no getAppAndVersion.
    class MockBtcApp {
        constructor({ transport, currency }) {
            this.transport = transport;
            this.currency = currency;
        }
        async getWalletPublicKey(path, _opts) {
            assert.equal(path, "m/44'/0'/0'", 'identity path is m/44\'/0\'/0\'');
            // 33-byte compressed pubkey in hex; deriveLedgerDeviceIdentifier
            // takes the raw hex string and hashes it to produce a
            // deterministic identifier.
            return {
                publicKey: '03'.padEnd(66, 'a'),
            };
        }
    }
    function appInfoTransport({ name = 'Bitcoin', version = '2.2.3', send } = {}) {
        const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
        const bytes = Uint8Array.from([
            1,
            name.length, ...ascii(name),
            version.length, ...ascii(version),
            1, 0,
            0x90, 0x00,
        ]);
        return { deviceModel: { id: 'nanoX' }, send: send ?? (async () => bytes) };
    }
    const transport = appInfoTransport();

    const pair = makeLedgerFactory({
        getTransport: async () => transport,
        getAppClass: async () => MockBtcApp,
    });
    const result = await pair();
    assert.ok(result.signer instanceof LedgerSigner, 'success returns a LedgerSigner');
    assert.equal(result.pairingInfo.vendor, 'ledger');
    assert.equal(result.pairingInfo.model, 'nanoX');
    assert.equal(result.pairingInfo.firmwareVersion, '2.2.3');
    assert.ok(
        typeof result.pairingInfo.deviceIdentifier === 'string'
            && result.pairingInfo.deviceIdentifier.length > 0,
        'deviceIdentifier is a non-empty string derived from the identity xpub',
    );

    // getTransport returns null.
    const noTransport = makeLedgerFactory({
        getTransport: async () => null,
        getAppClass: async () => MockBtcApp,
    });
    await assert.rejects(
        noTransport(),
        /getTransport returned null/,
        'null transport surfaces clear error',
    );

    // getAppClass returns a non-constructor.
    const badApp = makeLedgerFactory({
        getTransport: async () => transport,
        getAppClass: async () => ({ notAClass: true }),
    });
    await assert.rejects(
        badApp(),
        /not return a constructable Btc class/,
        'non-constructor Btc surfaces clear error',
    );

    // Device unreachable → the app-info read on the transport throws.
    const wrongApp = makeLedgerFactory({
        getTransport: async () => appInfoTransport({
            send: async () => { throw new Error('app not open'); },
        }),
        getAppClass: async () => MockBtcApp,
    });
    await assert.rejects(
        wrongApp(),
        /failed to read app info/,
        'Bitcoin app closed surfaces clear error',
    );
}

// --- 4. Desktop renderer factories exist + import core builder --------

const dTrezor = join(desktop, 'renderer', 'signerFactories', 'trezorFactory.js');
const dLedger = join(desktop, 'renderer', 'signerFactories', 'ledgerFactory.js');
assert.ok(existsSync(dTrezor), 'desktop renderer/signerFactories/trezorFactory.js exists');
assert.ok(existsSync(dLedger), 'desktop renderer/signerFactories/ledgerFactory.js exists');

const dTrezorSrc = readFileSync(dTrezor, 'utf8');
assert.ok(
    /makeTrezorFactory/.test(dTrezorSrc),
    'desktop trezorFactory delegates to core makeTrezorFactory',
);
assert.ok(
    /@xchain-wallet\/core\/signerFactories|\.\.\/\.\.\/\.\.\/core\/src\/signerFactories/.test(dTrezorSrc),
    'desktop trezorFactory imports core (workspace package or correct relative path)',
);
// T-RSL: desktop does NOT bundle @trezor/connect-web; it loads Trezor
// Connect at runtime from the hosted global build instead.
assert.ok(
    /connect\.trezor\.io\/9\/trezor-connect\.js/.test(dTrezorSrc),
    'desktop trezorFactory loads Trezor Connect from the hosted global build (connect.trezor.io/9)',
);
assert.ok(
    !/import\(\s*['"]@trezor\/connect-web['"]\s*\)/.test(dTrezorSrc)
        && !/from\s*['"]@trezor\//.test(dTrezorSrc),
    'desktop trezorFactory does NOT import any @trezor/* npm package (T-RSL)',
);
assert.ok(
    /export async function pairTrezorSigner/.test(dTrezorSrc),
    'desktop exports pairTrezorSigner',
);

const dLedgerSrc = readFileSync(dLedger, 'utf8');
assert.ok(
    /makeLedgerFactory/.test(dLedgerSrc),
    'desktop ledgerFactory delegates to core makeLedgerFactory',
);
assert.ok(
    /import\(.@ledgerhq\/hw-transport-webhid.\)/.test(dLedgerSrc),
    'desktop ledgerFactory lazy-imports hw-transport-webhid',
);
assert.ok(
    /import\(.@ledgerhq\/hw-app-btc.\)/.test(dLedgerSrc),
    'desktop ledgerFactory lazy-imports hw-app-btc',
);
assert.ok(
    /export async function pairLedgerSigner/.test(dLedgerSrc),
    'desktop exports pairLedgerSigner',
);

// --- 5. Desktop package.json deps -------------------------------------

const desktopPkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));
const extPkg = JSON.parse(
    readFileSync(join(wsRoot, 'packages', 'extension', 'package.json'), 'utf8'),
);
// T-RSL: no shell declares @trezor/connect-web anymore (web + desktop
// load the hosted script; the extension drops Trezor). Only the Ledger
// deps remain, still version-pinned across shells.
assert.ok(
    !desktopPkg.dependencies['@trezor/connect-web'],
    'desktop package.json does NOT declare @trezor/connect-web (loads the hosted script)',
);
for (const dep of [
    '@ledgerhq/hw-transport-webhid',
    '@ledgerhq/hw-app-btc',
]) {
    assert.ok(
        desktopPkg.dependencies[dep],
        `desktop package.json declares ${dep}`,
    );
    assert.equal(
        desktopPkg.dependencies[dep],
        extPkg.dependencies[dep],
        `desktop pins ${dep} to the same version as extension (drift guard)`,
    );
}

// --- 6. Renderer App.jsx wires real factories -------------------------

const appSrc = readFileSync(join(desktop, 'renderer', 'App.jsx'), 'utf8');
assert.ok(
    /import\s*\{\s*pairTrezorSigner\s*\}\s*from\s*['"]\.\/signerFactories\/trezorFactory\.js['"]/.test(appSrc),
    'App.jsx imports pairTrezorSigner from desktop signerFactories',
);
assert.ok(
    /import\s*\{\s*pairLedgerSigner\s*\}\s*from\s*['"]\.\/signerFactories\/ledgerFactory\.js['"]/.test(appSrc),
    'App.jsx imports pairLedgerSigner from desktop signerFactories',
);
assert.ok(
    /pairTrezor=\{pairTrezorSigner\}/.test(appSrc)
        && /pairLedger=\{pairLedgerSigner\}/.test(appSrc),
    'App.jsx passes both factories into PairSignerForm',
);
assert.ok(
    !/pairTrezor=\{undefined\}/.test(appSrc)
        && !/pairLedger=\{undefined\}/.test(appSrc),
    'App.jsx no longer passes undefined placeholders',
);

// --- 7. Main-process WebHID permission wiring -------------------------

assert.ok(
    HID_VENDOR_ALLOWLIST.LEDGER === 0x2C97,
    'vendor allowlist includes Ledger (0x2C97)',
);
assert.ok(
    HID_VENDOR_ALLOWLIST.TREZOR_T === 0x1209
        && HID_VENDOR_ALLOWLIST.TREZOR_ONE === 0x534C,
    'vendor allowlist includes both Trezor models',
);
assert.equal(isAllowedHidVendor(0x2C97), true, 'Ledger vendor allowed');
assert.equal(isAllowedHidVendor(0x1209), true, 'Trezor T vendor allowed');
assert.equal(isAllowedHidVendor(0x534C), true, 'Trezor One vendor allowed');
assert.equal(isAllowedHidVendor(0x046D), false, 'unrelated vendor (Logitech) rejected');

// attachHidPermissions validates the session object; we exercise the
// handler bodies by feeding a fake session that captures callbacks.
{
    /** @type {any} */
    let permHandler;
    /** @type {any} */
    let deviceHandler;
    /** @type {any} */
    let checkHandler;
    /** @type {any} */
    let selectHandler;
    const fakeSession = {
        setPermissionRequestHandler: (fn) => { permHandler = fn; },
        setDevicePermissionHandler: (fn) => { deviceHandler = fn; },
        setPermissionCheckHandler: (fn) => { checkHandler = fn; },
        on: (event, fn) => { if (event === 'select-hid-device') selectHandler = fn; },
    };
    const appRoot = join(desktop, 'renderer', 'dist');
    attachHidPermissions(fakeSession, { appRoot });
    assert.equal(typeof permHandler, 'function', 'permission handler installed');
    assert.equal(typeof deviceHandler, 'function', 'device handler installed');
    assert.equal(typeof checkHandler, 'function', 'permission CHECK handler installed');
    assert.equal(typeof selectHandler, 'function', 'select-hid-device listener installed');

    // Permission handler grants `hid`, denies everything else.
    let granted;
    permHandler(null, 'hid', (ok) => { granted = ok; });
    assert.equal(granted, true, 'hid permission granted');
    permHandler(null, 'geolocation', (ok) => { granted = ok; });
    assert.equal(granted, false, 'non-hid permission denied');

    // The app's own renderer is granted hid; anything else is denied so it
    // can never reach a paired Ledger/Trezor. "Anything else" now includes
    // an arbitrary local HTML file, which the old scheme-only check let in.
    const appIndex = pathToFileURL(join(appRoot, 'index.html')).href;
    permHandler({ getURL: () => appIndex }, 'hid', (ok) => { granted = ok; });
    assert.equal(granted, true, 'hid granted to the app renderer');
    permHandler({ getURL: () => 'https://evil.example/x' }, 'hid', (ok) => { granted = ok; });
    assert.equal(granted, false, 'hid denied to a remote https frame');
    permHandler({ getURL: () => 'file:///tmp/evil.html' }, 'hid', (ok) => { granted = ok; });
    assert.equal(granted, false, 'hid denied to a local file outside the app');

    // Device handler only allows whitelisted vendors.
    assert.equal(
        deviceHandler({ deviceType: 'hid', device: { vendorId: 0x2C97 } }),
        true,
        'Ledger device allowed',
    );
    assert.equal(
        deviceHandler({ deviceType: 'hid', device: { vendorId: 0x1209 } }),
        true,
        'Trezor T device allowed',
    );
    assert.equal(
        deviceHandler({ deviceType: 'hid', device: { vendorId: 0x046D } }),
        false,
        'Logitech device rejected',
    );
    assert.equal(
        deviceHandler({ deviceType: 'serial', device: { vendorId: 0x2C97 } }),
        false,
        'non-hid deviceType rejected even with Ledger vendor',
    );
    assert.equal(
        deviceHandler({ deviceType: 'hid', device: {} }),
        false,
        'missing vendorId rejected',
    );

    // The requesting FRAME decides, not its embedder. Electron's
    // PermissionRequest carries `requestingUrl`; before it was consulted a
    // connect.trezor.io subframe was judged by the app page hosting it.
    permHandler(
        { getURL: () => appIndex },
        'hid',
        (ok) => { granted = ok; },
        { isMainFrame: false, requestingUrl: 'https://connect.trezor.io/9/popup.html' },
    );
    assert.equal(granted, false, 'hid denied to a remote subframe inside the app window');
    permHandler(
        { getURL: () => appIndex },
        'hid',
        (ok) => { granted = ok; },
        { isMainFrame: true, requestingUrl: appIndex },
    );
    assert.equal(granted, true, 'hid still granted when the requesting frame is the app');

    // Device grants are origin-gated too. Electron can serve a STORED
    // device permission without re-running the request handler, so an
    // allow-listed vendor from a remote origin has to be refused here.
    //
    // The reach of that refusal is a TOP-LEVEL window and no finer. A live
    // Electron 43.3.0 session invokes this handler with `origin: 'file://'`
    // for a getDevices() call made from an http subframe and from a
    // sandboxed opaque-origin subframe alike, identical to the app's own
    // frame, so no return value here can separate them. `select-hid-device`
    // below is where a frame is visible; keeping a hostile frame out of the
    // session is a renderer trust-boundary question.
    assert.equal(
        deviceHandler({
            deviceType: 'hid',
            origin: 'https://connect.trezor.io',
            device: { vendorId: 0x2C97 },
        }),
        false,
        'Ledger device refused to a remote https origin',
    );
    assert.equal(
        deviceHandler({ deviceType: 'hid', origin: 'file://', device: { vendorId: 0x2C97 } }),
        true,
        'Ledger device allowed to the app file origin',
    );
    assert.equal(
        deviceHandler({ deviceType: 'hid', origin: 'null', device: { vendorId: 0x2C97 } }),
        true,
        'Ledger device allowed when Chromium reports an opaque origin',
    );

    // The CHECK handler is the one Electron 43 consults for `hid`: the
    // permission union of setPermissionCheckHandler contains 'hid' and the
    // union of setPermissionRequestHandler does not, so a WebHID call is
    // decided here and the request handler never sees it.
    //
    // LIVE_HID_CHECK is the payload a real Electron 43.3.0 session hands
    // this callback for the app's own top-level frame: no requestingUrl,
    // no embeddingOrigin, and isMainFrame FALSE. Granting it is the whole
    // hardware-pairing path, and a subframe rule built on isMainFrame
    // takes the app's own device picker away.
    const LIVE_HID_CHECK = { isMainFrame: false, securityOrigin: 'file:///' };
    assert.equal(
        checkHandler(null, 'hid', 'file:///', LIVE_HID_CHECK),
        true,
        'hid check granted on the exact payload a live session sends for the app frame',
    );
    assert.equal(
        checkHandler(null, 'hid', 'https://connect.trezor.io', { securityOrigin: 'https://connect.trezor.io' }),
        false,
        'hid check denied to a remote top-level window',
    );
    assert.equal(
        checkHandler(null, 'hid', 'file:///', { embeddingOrigin: 'https://connect.trezor.io' }),
        false,
        'hid check denied when the embedder is a remote origin',
    );
    assert.equal(
        checkHandler(null, 'hid', 'file:///', { requestingUrl: 'file:///tmp/evil.html' }),
        false,
        'hid check denied to a local file outside the app dir when a frame URL is supplied',
    );
    // Non-hid permissions keep the session default. The shipped renderer
    // bundle reads and writes the clipboard, scans QR codes through
    // getUserMedia and asks for notification permission; denying them here
    // takes three working features out of the wallet.
    for (const permission of ['clipboard-read', 'clipboard-sanitized-write', 'media', 'notifications']) {
        assert.equal(
            checkHandler(null, permission, 'file://', { isMainFrame: true, requestingUrl: appIndex }),
            true,
            `${permission} check is left at the session default`,
        );
    }

    // select-hid-device is the only callback that names the REQUESTING
    // frame, so it is the only one that can split these three apart. The
    // URLs are the ones a live session reports for a file:// window
    // hosting an http subframe and a sandboxed srcdoc subframe.
    const refused = [];
    const fire = (frameUrl) => {
        let prevented = false;
        let picked = 'not-called';
        selectHandler(
            { preventDefault: () => { prevented = true; } },
            { deviceList: [{ vendorId: 0x2C97 }], frame: frameUrl === null ? undefined : { url: frameUrl } },
            (id) => { picked = id; },
        );
        if (prevented) refused.push(frameUrl);
        return { prevented, picked };
    };
    assert.deepEqual(
        fire('http://127.0.0.1:53174/frame.html'),
        { prevented: true, picked: null },
        'a remote http subframe is refused the device picker',
    );
    assert.deepEqual(
        fire('about:srcdoc'),
        { prevented: true, picked: null },
        'a sandboxed opaque-origin subframe is refused the device picker',
    );
    assert.deepEqual(
        fire('https://connect.trezor.io/9/popup.html'),
        { prevented: true, picked: null },
        'a connect.trezor.io frame is refused the device picker',
    );
    assert.deepEqual(
        fire(appIndex),
        { prevented: false, picked: 'not-called' },
        'the app frame is left to the session default',
    );
    assert.deepEqual(
        fire(null),
        { prevented: false, picked: 'not-called' },
        'an unreadable frame is not refused, matching the one-sided posture',
    );
    assert.deepEqual(
        refused,
        ['http://127.0.0.1:53174/frame.html', 'about:srcdoc', 'https://connect.trezor.io/9/popup.html'],
        'exactly the three non-app frames are refused',
    );
}

// isAppHidCheck is one-sided the same way the rest of this module is: a
// signal Electron does not supply never denies. isMainFrame is the case
// that matters - a live session reports it FALSE for the app's own
// top-level frame, so reading it at all denies the app's device picker.
{
    const appRoot = join(desktop, 'renderer', 'dist');
    const appIndex = pathToFileURL(join(appRoot, 'index.html')).href;
    assert.equal(
        isAppHidCheck({ isMainFrame: false, securityOrigin: 'file:///' }, 'file:///', appRoot),
        true,
        'isMainFrame false does not deny: that is how the app frame arrives',
    );
    assert.equal(
        isAppHidCheck({}, 'file:///', appRoot),
        true,
        'an absent requestingUrl does not deny the app frame',
    );
    assert.equal(
        isAppHidCheck({ requestingUrl: appIndex }, 'https://evil.example', appRoot),
        false,
        'a remote requestingOrigin denies even when the frame URL reads local',
    );
    assert.equal(
        isAppHidCheck({ securityOrigin: 'https://evil.example' }, 'file:///', appRoot),
        false,
        'a remote securityOrigin denies even when the origin argument reads local',
    );

    // The frame check that the check handler cannot make. These are the
    // frame URLs a live Electron 43.3.0 session reports for the three
    // frames, which the hid CHECK payload renders identical.
    assert.equal(isAppHidSelect({ frame: { url: appIndex } }, appRoot), true, 'the app frame may reach the picker');
    assert.equal(
        isAppHidSelect({ frame: { url: 'http://127.0.0.1:53174/frame.html' } }, appRoot),
        false,
        'a remote http subframe may not reach the picker',
    );
    assert.equal(
        isAppHidSelect({ frame: { url: 'about:srcdoc' } }, appRoot),
        false,
        'a sandboxed opaque-origin subframe may not reach the picker',
    );
    assert.equal(
        isAppHidSelect({ frame: { url: 'file:///tmp/evil.html' } }, appRoot),
        false,
        'a local file outside the app dir may not reach the picker',
    );
    assert.equal(isAppHidSelect({}, appRoot), true, 'an unreadable frame is not refused');
}

// isRemoteHidOrigin is one-sided on purpose: it rejects what is provably
// remote and never guesses about an origin it cannot read. Both `file://`
// and `null` are spellings Chromium uses for the app's own renderer, so
// denying either would deny the app's own device picker.
assert.equal(isRemoteHidOrigin('https://connect.trezor.io'), true, 'https origin is remote');
assert.equal(isRemoteHidOrigin('http://localhost:5173'), true, 'http origin is remote');
assert.equal(isRemoteHidOrigin('chrome-extension://abc'), true, 'extension origin is remote');
assert.equal(isRemoteHidOrigin('file://'), false, 'the file origin is not remote');
assert.equal(isRemoteHidOrigin('null'), false, 'an opaque origin is not treated as remote');
assert.equal(isRemoteHidOrigin(undefined), false, 'an absent origin is not treated as remote');

// attachHidPermissions rejects invalid sessions.
assert.throws(
    () => attachHidPermissions(null),
    /session is required/,
    'attachHidPermissions rejects null session',
);
assert.throws(
    () => attachHidPermissions({}),
    /setPermissionRequestHandler/,
    'attachHidPermissions rejects session missing setPermissionRequestHandler',
);
assert.throws(
    () => attachHidPermissions(
        { setPermissionRequestHandler: () => {}, setDevicePermissionHandler: () => {} },
        {},
    ),
    /appRoot/,
    'attachHidPermissions refuses to wire the HID grant without an app root',
);
assert.throws(
    () => attachHidPermissions(
        { setPermissionRequestHandler: () => {}, setDevicePermissionHandler: () => {} },
        { appRoot: join(desktop, 'renderer', 'dist') },
    ),
    /setPermissionCheckHandler/,
    'attachHidPermissions refuses a session that cannot take the check handler',
);

// Source pin: the check handler is wired, not merely exported.
{
    const permissionsSrc = readFileSync(join(desktop, 'main', 'permissions.js'), 'utf8');
    assert.ok(
        /session\.setPermissionCheckHandler\(/.test(permissionsSrc),
        'permissions.js installs a permission check handler on the session',
    );
}

// Main-process index.js actually attaches the handlers on app ready.
const mainIndex = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
assert.ok(
    /attachHidPermissions\(session\.defaultSession, \{ appRoot: APP_ROOT \}\)/.test(mainIndex),
    'main/index.js calls attachHidPermissions(session.defaultSession, { appRoot: APP_ROOT }) on app.whenReady',
);

console.log(
    'OK: hw-factories smoke (Step 18 §40.12: core makeTrezorFactory + makeLedgerFactory DI builders; success + failure paths exercised against mock Connect/transport/app; desktop renderer factories delegate to core builders with lazy HW-SDK imports; desktop package.json deps at extension-parity versions; App.jsx wires real factories; main-process WebHID permission handlers + vendor-ID allowlist cover Ledger + both Trezor variants)',
);
