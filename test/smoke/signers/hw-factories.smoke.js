// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

// Smoke for Phase 2 — Step 18 (piece 5c) — core HW factory builders
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
import { fileURLToPath } from 'node:url';
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
    // Line comments + /* … */ blocks. Good enough for our own source —
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
    // Mock Ledger Btc app + transport — matches the shape pairing
    // exercises: getAppAndVersion + getWalletPublicKey.
    class MockBtcApp {
        constructor({ transport, currency }) {
            this.transport = transport;
            this.currency = currency;
        }
        async getAppAndVersion() {
            return { name: 'Bitcoin', version: '2.2.3' };
        }
        async getWalletPublicKey(path, _opts) {
            assert.equal(path, "m/44'/0'/0'", 'identity path is m/44\'/0\'/0\'');
            // 33-byte compressed pubkey in hex — deriveLedgerDeviceIdentifier
            // takes the raw hex string and hashes it to produce a
            // deterministic identifier.
            return {
                publicKey: '03'.padEnd(66, 'a'),
            };
        }
    }
    const transport = { deviceModel: { id: 'nanoX' } };

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

    // Bitcoin app not open → getAppAndVersion throws.
    class AppNotOpen extends MockBtcApp {
        async getAppAndVersion() { throw new Error('app not open'); }
    }
    const wrongApp = makeLedgerFactory({
        getTransport: async () => transport,
        getAppClass: async () => AppNotOpen,
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
assert.ok(
    /import\(.@trezor\/connect-web.\)/.test(dTrezorSrc),
    'desktop trezorFactory lazy-imports @trezor/connect-web',
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
for (const dep of [
    '@trezor/connect-web',
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
    const fakeSession = {
        setPermissionRequestHandler: (fn) => { permHandler = fn; },
        setDevicePermissionHandler: (fn) => { deviceHandler = fn; },
    };
    attachHidPermissions(fakeSession);
    assert.equal(typeof permHandler, 'function', 'permission handler installed');
    assert.equal(typeof deviceHandler, 'function', 'device handler installed');

    // Permission handler grants `hid`, denies everything else.
    let granted;
    permHandler(null, 'hid', (ok) => { granted = ok; });
    assert.equal(granted, true, 'hid permission granted');
    permHandler(null, 'geolocation', (ok) => { granted = ok; });
    assert.equal(granted, false, 'non-hid permission denied');

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
}

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

// Main-process index.js actually attaches the handlers on app ready.
const mainIndex = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
assert.ok(
    /attachHidPermissions\(session\.defaultSession\)/.test(mainIndex),
    'main/index.js calls attachHidPermissions(session.defaultSession) on app.whenReady',
);

console.log(
    'OK — hw-factories smoke (Step 18 §40.12: core makeTrezorFactory + makeLedgerFactory DI builders — success + failure paths exercised against mock Connect/transport/app; desktop renderer factories delegate to core builders with lazy HW-SDK imports; desktop package.json deps at extension-parity versions; App.jsx wires real factories; main-process WebHID permission handlers + vendor-ID allowlist cover Ledger + both Trezor variants)',
);
