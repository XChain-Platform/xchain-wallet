// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for the Trezor Connect bridge window, the one desktop window that
// hosts third-party script (§40.12).
//
// That window is safe only while five things hold together: index.js denies
// every window.open (a window.open child keeps its opener's session, so the
// bridge cannot be one), main builds the bridge itself with the isolated
// session, sandbox, context isolation and only the bridge preload, it loads
// a packaged file rather than a data: URL, the session is the dedicated
// in-memory partition, and that partition is wired to `attachHidDenial`.
// The options builder and the denial are driven as real functions; index.js
// imports Electron, so its wiring is pinned by scoped source slices with
// mutation probes that prove each slice check can fail.

import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachHidDenial } from '../../../packages/desktop/main/permissions.js';
import * as security from '../../../packages/desktop/main/security.js';
import { bridgeWindowOptions } from '../../../packages/desktop/main/trezorBridgeWindow.js';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..', '..', '..', 'packages', 'desktop');

const mainIndex = readFileSync(join(desktop, 'main', 'index.js'), 'utf8');
const bridgeModule = readFileSync(join(desktop, 'main', 'trezorBridgeWindow.js'), 'utf8');
const trezorFactory = readFileSync(join(desktop, 'renderer', 'signerFactories', 'trezorFactory.js'), 'utf8');

// --- 1. No window.open reaches a window, the bridge included ----------
{
    // Check the window.open exception is gone from the trust predicates.
    assert.equal(Object.hasOwn(security, 'isTrezorConnectBridgeWindowOpen'), false, 'security.js exports no window.open exception');
    assert.equal(Object.hasOwn(security, 'TREZOR_CONNECT_BRIDGE_WINDOW_NAME'), false, 'security.js exports no bridge window name');
    // Check the renderer opens no window and builds no data: document.
    assert.ok(!/window\.open\(/.test(trezorFactory), 'the renderer factory calls no window.open');
    assert.ok(!/data:text\/html/.test(trezorFactory), 'the renderer factory builds no data: document');
    assert.ok(!/postMessage\(/.test(trezorFactory), 'the renderer factory posts no cross-window message');
}

/** Slice the window-open handler, from its registration to the next listener; null when an anchor moved. */
function openHandlerSlice(src) {
    const start = src.indexOf('contents.setWindowOpenHandler(');
    const end = start === -1 ? -1 : src.indexOf("contents.on('will-navigate'", start);
    return end === -1 ? null : src.slice(start, end);
}

/** List window-open failures in src; fails closed on a missing anchor. */
function openHandlerFailures(src) {
    const slice = openHandlerSlice(src);
    if (slice === null) return ['window-open handler anchors not found'];
    const failures = [];
    if (/action:\s*'allow'/.test(slice)) failures.push('the window-open handler allows a window');
    if (/overrideBrowserWindowOptions/.test(slice)) failures.push('the window-open handler overrides window options');
    if (!/return \{ action: 'deny' \};/.test(slice)) failures.push('the window-open handler does not deny');
    return failures;
}

{
    assert.deepEqual(openHandlerFailures(mainIndex), [], 'index.js denies every window.open');
    const slice = openHandlerSlice(mainIndex);
    const reopened = mainIndex.replace(slice, slice.replace(
        '        return { action: \'deny\' };',
        "        if (frameName === 'bridge') return { action: 'allow', overrideBrowserWindowOptions: {} };\n        return { action: 'deny' };",
    ));
    assert.notEqual(reopened, mainIndex, 'the window-open probe changed the source');
    assert.ok(openHandlerFailures(reopened).length > 0, 'the window-open check catches a re-added allow branch');
    assert.deepEqual(
        openHandlerFailures(mainIndex.replace('contents.setWindowOpenHandler(', 'contents.setOpenHandler(')),
        ['window-open handler anchors not found'],
        'the window-open check fails closed when its anchor moves',
    );
}

// --- 2. Main builds the bridge on the isolated session, from a file ----
{
    const session = { partition: 'trezor-connect-isolated' };
    const options = bridgeWindowOptions({ session, preloadPath: '/bridge/preload.cjs' });
    assert.equal(options.webPreferences.session, session, 'the bridge window takes the session main hands it');
    assert.equal(options.webPreferences.sandbox, true, 'the bridge window is sandboxed');
    assert.equal(options.webPreferences.contextIsolation, true, 'the bridge window isolates its preload world');
    assert.equal(options.webPreferences.nodeIntegration, false, 'the bridge window has no Node');
    assert.equal(options.webPreferences.webSecurity, true, 'the bridge window keeps web security');
    assert.equal(options.webPreferences.devTools, false, 'the bridge window has no developer tools by default');
    assert.equal(options.webPreferences.preload, '/bridge/preload.cjs', 'the bridge window carries the bridge preload');
    assert.equal(options.show, false, 'the bridge window opens hidden and is shown through the focus policy');

    // Check the module loads a file and never a URL.
    assert.ok(/win\.loadFile\(documentPath\)/.test(bridgeModule), 'the bridge window loads its document with loadFile');
    assert.ok(!/loadURL\(/.test(bridgeModule), 'the bridge window loads no URL');
    assert.ok(/win\.webContents\.ipc\.on\(TREZOR_BRIDGE_REPLY_CHANNEL/.test(bridgeModule),
        'the bridge reply listener is scoped to the bridge window\'s own IPC');
    assert.ok(!/ipcMain/.test(bridgeModule), 'the bridge module registers nothing on the app-wide IPC');

    // Check the packaged document and its preload exist where index.js points.
    for (const rel of ['connect.html', 'responder.js', 'preload.cjs']) {
        assert.ok(existsSync(join(desktop, 'main', 'trezorBridge', rel)), `main/trezorBridge/${rel} exists`);
    }
}

const WIRING_REQUIRED = [
    /BrowserWindow,/,
    /getSession:\s*getTrezorConnectSession,/,
    /preloadPath:\s*join\(here,\s*'trezorBridge',\s*'preload\.cjs'\),/,
    /documentPath:\s*join\(here,\s*'trezorBridge',\s*'connect\.html'\),/,
];
const WIRING_FORBIDDEN = [/session\.defaultSession/, /'\.\.',\s*'preload\.cjs'/, /data:/];

/** Slice the createTrezorBridge call in index.js; null when an anchor moved. */
function wiringSlice(src) {
    const start = src.indexOf('const trezorBridge = createTrezorBridge({');
    const end = start === -1 ? -1 : src.indexOf('});', start);
    return end === -1 ? null : src.slice(start, end);
}

/** Slice the bridge session factory body; null when an anchor moved. */
function factorySlice(src) {
    const start = src.indexOf('function getTrezorConnectSession(');
    const end = start === -1 ? -1 : src.indexOf('const trezorBridge = createTrezorBridge(', start);
    return end === -1 ? null : src.slice(start, end);
}

// --- 3. index.js wires the bridge to the isolated no-HID session ------

/** List every bridge wiring failure in src; fails closed on a missing anchor. */
function bridgeFailures(src) {
    const wiring = wiringSlice(src);
    const factory = factorySlice(src);
    if (wiring === null) return ['createTrezorBridge wiring anchors not found'];
    if (factory === null) return ['getTrezorConnectSession anchors not found'];
    const failures = [
        ...WIRING_REQUIRED.filter((re) => !re.test(wiring)).map((re) => `bridge wiring missing ${re.source}`),
        ...WIRING_FORBIDDEN.filter((re) => re.test(wiring)).map((re) => `bridge wiring contradicted by ${re.source}`),
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
    assert.deepEqual(bridgeFailures(mainIndex), [], 'the bridge wiring and session factory hold every guard');
    // Check each probe changes the source and is caught, so the slice checks cannot pass vacuously.
    for (const [sliceOf, from, to, why] of [
        [wiringSlice, 'getSession: getTrezorConnectSession,', 'getSession: () => session.defaultSession,', 'the default HID-granted session swapped in'],
        [wiringSlice, "preloadPath: join(here, 'trezorBridge', 'preload.cjs'),", "preloadPath: join(here, '..', 'preload.cjs'),", 'the app preload handed to the bridge'],
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
        bridgeFailures(mainIndex.replace('const trezorBridge = createTrezorBridge({', 'const trezorBridge = makeBridge({')),
        ['createTrezorBridge wiring anchors not found'],
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
