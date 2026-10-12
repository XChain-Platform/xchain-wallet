// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the one window.open the desktop shell allows: the isolated
// Trezor Connect bridge window, which hosts third-party script.
//
// That allow path is safe only while four things hold together: the opener
// predicate admits the app's own renderer and nothing else, the override
// carries no preload, the window lives on the dedicated in-memory session,
// and that session is wired to `attachHidDenial`. The predicate and the
// denial are driven as real functions; index.js imports Electron, so its
// allow branch and session factory are pinned by scoped source slices with
// mutation probes that prove each slice check can fail.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { attachHidDenial } from '../../../packages/desktop/main/permissions.js';
import {
    TREZOR_CONNECT_BRIDGE_WINDOW_NAME,
    isTrezorConnectBridgeWindowOpen,
} from '../../../packages/desktop/main/security.js';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');
const APP_ROOT = join(desktop, 'renderer', 'dist');
const appIndexUrl = pathToFileURL(join(APP_ROOT, 'index.html')).href;
const siblingDirUrl = pathToFileURL(join(`${APP_ROOT}-evil`, 'index.html')).href;
const NAME = TREZOR_CONNECT_BRIDGE_WINDOW_NAME;

const mainIndex = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
const trezorFactory = readFileSync(join(desktop, 'renderer', 'signerFactories', 'trezorFactory.js'), 'utf8');

// --- 1. The opener predicate admits only the app's own renderer --------
{
    // Check the app's own window may open the bridge, with or without a route.
    for (const opener of [appIndexUrl, `${appIndexUrl}?xc-init-route=eyJ2IjoxfQ%3D%3D`, `${appIndexUrl}#/send`]) {
        assert.equal(isTrezorConnectBridgeWindowOpen(NAME, opener, APP_ROOT), true, `the app opener ${opener} opens the bridge`);
    }
    // Check the bridge itself (a data: URL) and every non-app opener are refused.
    for (const opener of [
        'data:text/html;base64,PGh0bWw+',
        'https://connect.trezor.io/9/iframe.html',
        'file:///tmp/evil.html',
        siblingDirUrl,
        '',
        undefined,
    ]) {
        assert.equal(isTrezorConnectBridgeWindowOpen(NAME, opener, APP_ROOT), false, `opener ${String(opener)} cannot open the bridge`);
    }
    // Check a missing app root trusts nothing.
    assert.equal(isTrezorConnectBridgeWindowOpen(NAME, appIndexUrl, undefined), false, 'no app root means no bridge');
    // Check any other window name stays on the deny path, even from the app.
    for (const name of ['', 'other', undefined, NAME.toUpperCase(), `${NAME} `]) {
        assert.equal(isTrezorConnectBridgeWindowOpen(name, appIndexUrl, APP_ROOT), false, `window name ${JSON.stringify(name)} is not the bridge`);
    }
}

// --- 2. The renderer's copy of the window name matches main's ----------
{
    // Read the renderer literal, which is kept by hand because the bundle cannot import security.js.
    const m = /const TREZOR_CONNECT_BRIDGE_WINDOW_NAME = '([^']+)';/.exec(trezorFactory);
    assert.ok(m, 'trezorFactory.js still declares its bridge window name literal');
    assert.equal(m[1], NAME, 'the renderer opens the bridge under the exact name main allows');
}

// --- 3. The allow branch and its session factory, pinned by slice ------

const ALLOW_REQUIRED = [
    /action:\s*'allow'/, /session:\s*getTrezorConnectSession\(\)/,
    /contextIsolation:\s*true/, /nodeIntegration:\s*false/, /sandbox:\s*true/,
];
// Match the key with its colon: the branch's own comment says the bare word.
const ALLOW_FORBIDDEN = [/\bpreload\s*:/, /session\.defaultSession/, /contextIsolation:\s*false/, /nodeIntegration:\s*true/, /sandbox:\s*false/];

/** Slice the bridge allow branch, from its predicate call to the deny that follows; null when an anchor moved. */
function allowSlice(src) {
    const start = src.indexOf('isTrezorConnectBridgeWindowOpen(frameName');
    const end = start === -1 ? -1 : src.indexOf("action: 'deny'", start);
    return end === -1 ? null : src.slice(start, end);
}

/** Slice the bridge session factory body; null when an anchor moved. */
function factorySlice(src) {
    const start = src.indexOf('function getTrezorConnectSession(');
    const end = start === -1 ? -1 : src.indexOf('function hardenWebContents(', start);
    return end === -1 ? null : src.slice(start, end);
}

/** List every bridge hardening failure in src; fails closed on a missing anchor. */
function bridgeFailures(src) {
    const allow = allowSlice(src);
    const factory = factorySlice(src);
    if (allow === null) return ['bridge allow branch anchors not found'];
    if (factory === null) return ['getTrezorConnectSession anchors not found'];
    const failures = [
        ...ALLOW_REQUIRED.filter((re) => !re.test(allow)).map((re) => `allow branch missing ${re.source}`),
        ...ALLOW_FORBIDDEN.filter((re) => re.test(allow)).map((re) => `allow branch contradicted by ${re.source}`),
    ];
    // Require the in-memory partition: a persist: name would keep remote state across launches.
    if (!/fromPartition\('trezor-connect-isolated'\)/.test(factory)) failures.push('factory partition is not trezor-connect-isolated');
    if (!/attachHidDenial\(trezorConnectSession\)/.test(factory)) failures.push('factory does not wire attachHidDenial');
    if (/attachHidPermissions/.test(factory)) failures.push('factory wires attachHidPermissions');
    // Require the bridge session to skip the frame guard so its own iframe cannot latch off Ledger HID.
    if (!/if \(contents\.session !== trezorConnectSession\) \{\s*observeHidFrames\(contents\);/.test(src)) {
        failures.push('hardenWebContents no longer skips observeHidFrames for the bridge session');
    }
    return failures;
}

/** Rewrite only one slice of src. */
function mutate(src, sliceOf, from, to) {
    const slice = sliceOf(src);
    return src.replace(slice, slice.replace(from, to));
}

{
    assert.deepEqual(bridgeFailures(mainIndex), [], 'the bridge allow branch and session factory hold every guard');
    // Check each probe changes the source and is caught, so the slice checks cannot pass vacuously.
    for (const [sliceOf, from, to, why] of [
        [allowSlice, 'sandbox: true,', "sandbox: true,\n                        preload: join(here, '..', 'preload.cjs'),", 'a preload added to the bridge'],
        [allowSlice, 'session: getTrezorConnectSession(),', 'session: session.defaultSession,', 'the default HID-granted session swapped in'],
        [allowSlice, /\n\s*sandbox:\s*true,/, '', 'a dropped sandbox flag'],
        [allowSlice, 'nodeIntegration: false', 'nodeIntegration: true', 'nodeIntegration turned on'],
        [factorySlice, /\n\s*attachHidDenial\(trezorConnectSession\);/, '', 'the HID denial unwired'],
        [factorySlice, 'attachHidDenial(trezorConnectSession)', 'attachHidPermissions(trezorConnectSession)', 'the HID grant wired instead'],
        [factorySlice, "fromPartition('trezor-connect-isolated')", "fromPartition('persist:trezor-connect-isolated')", 'a persistent partition'],
    ]) {
        const mutated = mutate(mainIndex, sliceOf, from, to);
        assert.notEqual(mutated, mainIndex, `the probe for ${why} changed the source`);
        assert.ok(bridgeFailures(mutated).length > 0, `the bridge check catches ${why}`);
    }
    const unskipped = mainIndex.replace('if (contents.session !== trezorConnectSession) {', 'if (true) {');
    assert.notEqual(unskipped, mainIndex, 'the frame-guard skip probe changed the source');
    assert.ok(bridgeFailures(unskipped).length > 0, 'the bridge check catches a dropped frame-guard skip');
    assert.deepEqual(
        bridgeFailures(mainIndex.replace('isTrezorConnectBridgeWindowOpen(frameName', 'isBridgeOpen(frameName')),
        ['bridge allow branch anchors not found'],
        'the bridge check fails closed when its anchor moves',
    );
}

// --- 4. attachHidDenial refuses every device path on the bridge session --

const LEDGER = { vendorId: 0x2C97, productId: 0x0001 };
const TREZOR = { vendorId: 0x1209, productId: 0x53C1 };

/** Wire attachHidDenial onto a fake session that records every handler and every event name. */
function denialRig() {
    const handlers = {};
    const listeners = new Map();
    attachHidDenial({
        setPermissionRequestHandler: (fn) => { handlers.request = fn; },
        setDevicePermissionHandler: (fn) => { handlers.device = fn; },
        setPermissionCheckHandler: (fn) => { handlers.check = fn; },
        on: (event, fn) => { listeners.set(event, fn); },
    });
    return { handlers, listeners };
}

{
    const { handlers, listeners } = denialRig();
    assert.equal(typeof handlers.request, 'function', 'the request handler is installed');
    assert.equal(typeof handlers.check, 'function', 'the check handler is installed');
    assert.equal(typeof handlers.device, 'function', 'the device handler is installed');

    // Check every permission that must prompt is refused.
    for (const permission of ['hid', 'usb', 'serial', 'media', 'notifications', 'clipboard-read']) {
        let granted = 'not-called';
        handlers.request(null, permission, (ok) => { granted = ok; }, {});
        assert.equal(granted, false, `the bridge request handler refuses ${permission}`);
    }

    // Check the device classes are refused on the check path, for any origin.
    for (const permission of ['hid', 'usb', 'serial']) {
        for (const origin of ['file://', 'https://connect.trezor.io', 'null']) {
            assert.equal(handlers.check(null, permission, origin, {}), false, `the bridge check handler refuses ${permission} for ${origin}`);
        }
    }

    // Check no paired device of any class or vendor is handed back.
    for (const deviceType of ['hid', 'usb', 'serial']) {
        for (const device of [LEDGER, TREZOR]) {
            for (const origin of ['file://', 'https://connect.trezor.io']) {
                assert.equal(handlers.device({ deviceType, origin, device }), false, `the bridge device handler refuses a ${deviceType} device at ${origin}`);
            }
        }
    }

    // Check every device chooser is registered, prevented, and cancelled with no device.
    const choosers = [
        ['select-hid-device', (fn, ev, cb) => fn(ev, { deviceList: [{ deviceId: 'hid-1', ...LEDGER }] }, cb), [undefined, null]],
        ['select-usb-device', (fn, ev, cb) => fn(ev, { deviceList: [{ deviceId: 'usb-1', ...TREZOR }] }, cb), [undefined]],
        ['select-serial-port', (fn, ev, cb) => fn(ev, [{ portId: 'serial-1' }], {}, cb), ['']],
    ];
    for (const [event, fire, cancelValues] of choosers) {
        const fn = listeners.get(event);
        assert.equal(typeof fn, 'function', `the bridge session registers ${event}`);
        let prevented = false;
        let calls = 0;
        let picked = 'not-called';
        fire(fn, { preventDefault: () => { prevented = true; } }, (...args) => { calls += 1; picked = args[0]; });
        assert.equal(prevented, true, `${event} prevents the default chooser`);
        assert.equal(calls, 1, `${event} answers its callback exactly once`);
        assert.ok(cancelValues.includes(picked), `${event} cancels with no device, got ${JSON.stringify(picked)}`);
    }

    // Check a session missing any handler hook is refused at wiring time.
    assert.throws(() => attachHidDenial(null), /session is required/);
    assert.throws(() => attachHidDenial(undefined), /session is required/);
    const full = {
        setPermissionRequestHandler() {}, setDevicePermissionHandler() {}, setPermissionCheckHandler() {}, on() {},
    };
    for (const missing of Object.keys(full)) {
        const partial = { ...full };
        delete partial[missing];
        assert.throws(() => attachHidDenial(partial), new RegExp(`attachHidDenial: session\\.${missing}`), `a session without ${missing} is refused`);
    }
}

console.log('trezor-bridge-window.smoke.js: OK');
