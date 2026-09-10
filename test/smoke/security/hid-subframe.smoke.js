// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Smoke for a subframe inside the app window cannot obtain a
// paired HID device.
//
// The path this closes. `setDevicePermissionHandler` is what Electron
// consults when a page reads an ALREADY-PAIRED device back through
// `navigator.hid.getDevices()`, and the details it receives are exactly
// `{ deviceType, origin, device }` (DevicePermissionHandlerHandlerDetails,
// electron.d.ts v43) - no frame, no url. Measured against a live Electron
// 43.3.0 session, an `http://127.0.0.1` subframe, a sandboxed `srcdoc`
// subframe and the app's own top-level frame all produce the byte-identical
// `origin: 'file://'`, so no return value computed from that origin can
// separate them. A vendor-and-origin handler therefore hands a frame the
// app embeds the same paired Ledger it hands the app.
//
// The input that DOES separate them is whether the HID-granted session
// contains a subframe at all. The packaged renderer embeds none, so one
// appearing is an anomaly; `observeHidFrames` latches on it and the device
// handler then refuses every device.
//
// The assertions below are behavioural: they drive the real handler
// callbacks that `attachHidPermissions` installs, through the same
// `frame-created` / `will-frame-navigate` / `destroyed` events Electron
// emits, and check which devices come back. Nothing here reads source
// text or a label.

import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    attachHidPermissions,
    createHidFrameGuard,
    isAppHidSelect,
    observeHidFrames,
} from '../../../packages/desktop/main/permissions.js';

const here = dirname(fileURLToPath(import.meta.url));
const wsRoot = join(here, '..', '..', '..');
const appRoot = join(wsRoot, 'packages', 'desktop', 'renderer', 'dist');
const appIndex = pathToFileURL(join(appRoot, 'index.html')).href;

const LEDGER = { vendorId: 0x2C97, productId: 0x0001 };

/**
 * Stand up one isolated HID wiring: a fake session capturing the handlers
 * `attachHidPermissions` installs, a fake webContents wired through
 * `observeHidFrames`, and a private guard so cases cannot leak into each
 * other. The shapes match the Electron callbacks byte for byte.
 */
function rig() {
    const handlers = {};
    const listeners = new Map();
    const guard = createHidFrameGuard();
    const session = {
        setPermissionRequestHandler: (fn) => { handlers.request = fn; },
        setDevicePermissionHandler: (fn) => { handlers.device = fn; },
        setPermissionCheckHandler: (fn) => { handlers.check = fn; },
        on: (event, fn) => { if (event === 'select-hid-device') handlers.select = fn; },
    };
    attachHidPermissions(session, { appRoot, guard });

    const contents = {
        id: 7,
        on: (event, fn) => { listeners.set(event, fn); },
    };
    observeHidFrames(contents, { guard });

    const mainFrame = { url: appIndex, parent: null };

    return {
        guard,
        /** Read a paired device back the way `navigator.hid.getDevices()` does. */
        getDevices: (origin = 'file://') => handlers.device({
            deviceType: 'hid',
            origin,
            device: LEDGER,
        }),
        /** Ask for the picker from `frame`, returning what the caller sees. */
        requestDevice: (frame) => {
            let prevented = false;
            let picked = 'not-called';
            handlers.select(
                { preventDefault: () => { prevented = true; } },
                { deviceList: [LEDGER], frame },
                (id) => { picked = id; },
            );
            return { prevented, picked };
        },
        mainFrame,
        /** Electron's `frame-created`, for an <iframe> the page just added. */
        emitFrameCreated: (frame) => listeners.get('frame-created')(null, { frame }),
        emitFrameNavigate: (params) => listeners.get('will-frame-navigate')(params),
        emitDestroyed: () => listeners.get('destroyed')(),
    };
}

// --- 1. The app's own window, with no subframes, still pairs -----------
//
// The guard has to be silent on the shipped path or it takes hardware
// support out of the wallet. Assert this first: every denial below is only
// meaningful against a rig that grants.
{
    const r = rig();
    assert.equal(r.getDevices(), true, 'the app reads back its paired Ledger');
    assert.deepEqual(
        r.requestDevice(r.mainFrame),
        { prevented: false, picked: 'not-called' },
        "the app's own top-level frame reaches the device picker",
    );
    // Electron reports the main frame through `frame-created` too, and it
    // carries `parent: null`. Mistaking that for an embedded frame would
    // switch HID off at boot.
    r.emitFrameCreated(r.mainFrame);
    assert.equal(r.getDevices(), true, "the window's own main frame is not a subframe");
    r.emitFrameNavigate({ url: appIndex, isMainFrame: true, frame: r.mainFrame });
    assert.equal(r.getDevices(), true, 'a top-level navigation does not latch the guard');
}

// --- 2. A SAME-ORIGIN subframe cannot reach a paired device -----------
//
// This is The subframe is spelled the way the residual actually
// arrives: same `file://` origin, same app URL, indistinguishable from the
// app at the device handler. Only the parent link separates it, and only
// `frame-created` carries that.
{
    const r = rig();
    assert.equal(r.getDevices(), true, 'device reachable before the subframe exists');

    const subframe = { url: appIndex, parent: r.mainFrame };
    r.emitFrameCreated(subframe);

    assert.equal(
        r.getDevices(),
        false,
        'a same-origin subframe in the app window cannot obtain the paired Ledger',
    );
    // The origin argument is not what decided it: the app's own frame
    // sends the same string and is refused now too, because the handler
    // cannot tell the two apart and so must refuse both.
    assert.equal(r.getDevices('null'), false, 'the opaque-origin spelling is refused as well');
    assert.deepEqual(
        r.requestDevice(r.mainFrame),
        { prevented: true, picked: null },
        'no new pairing while the window hosts an embedded frame',
    );
}

// --- 3. Every subframe spelling latches, not just the same-origin one --
{
    for (const [label, frame] of [
        ['a remote http subframe', { url: 'http://127.0.0.1:53174/frame.html' }],
        ['a sandboxed srcdoc subframe', { url: 'about:srcdoc' }],
        ['a connect.trezor.io subframe', { url: 'https://connect.trezor.io/9/popup.html' }],
        ['a local file outside the app dir', { url: 'file:///tmp/evil.html' }],
    ]) {
        const r = rig();
        r.emitFrameCreated({ ...frame, parent: r.mainFrame });
        assert.equal(r.getDevices(), false, `${label} switches the HID grant off`);
    }

    // A frame Electron can no longer resolve (`frame: null`, the documented
    // shape once it has navigated or been destroyed) still latches, because
    // `isMainFrame` is a plain boolean that survives the teardown.
    const r = rig();
    r.emitFrameNavigate({ url: 'about:blank', isMainFrame: false, frame: null });
    assert.equal(r.getDevices(), false, 'an unresolvable subframe navigation still latches');
}

// --- 4. The latch is per webContents and clears with it ---------------
//
// It does NOT clear when the frame goes away: Electron emits frame
// creation and no matching destruction, and a frame that existed may
// already hold an open device handle. It clears when the whole window
// does, so closing a poisoned window restores hardware support without a
// restart.
{
    const r = rig();
    r.emitFrameCreated({ url: 'about:srcdoc', parent: r.mainFrame });
    assert.equal(r.getDevices(), false, 'poisoned while the window lives');
    r.emitDestroyed();
    assert.equal(r.getDevices(), true, 'the grant returns once that webContents is gone');
}

// --- 5. The picker's frame check is top-level, not merely app-URL -----
//
// `select-hid-device` is the one callback that names the requesting frame,
// and its URL check alone reads a subframe pointed at the app's own
// index.html as the app itself.
{
    assert.equal(
        isAppHidSelect({ frame: { url: appIndex, parent: null } }, appRoot),
        true,
        "the window's own top-level frame may reach the picker",
    );
    assert.equal(
        isAppHidSelect({ frame: { url: appIndex, parent: { url: appIndex } } }, appRoot),
        false,
        'a subframe running the app\'s own index.html may not reach the picker',
    );
    // A WebFrameMain accessed after teardown throws on property access. A
    // throw escaping the callback would leave the request neither
    // prevented nor answered, so it fails closed instead.
    const dead = {
        get url() { throw new Error('frame destroyed'); },
        get parent() { throw new Error('frame destroyed'); },
    };
    assert.equal(
        isAppHidSelect({ frame: dead }, appRoot),
        false,
        'a torn-down frame is denied rather than throwing out of the callback',
    );
}

// --- 6. observeHidFrames is defensive about what it is handed ---------
{
    const guard = createHidFrameGuard();
    observeHidFrames(null, { guard });
    observeHidFrames({}, { guard });
    assert.equal(guard.hasSubframe(), false, 'a non-webContents wires nothing and latches nothing');
}

console.log('hid-subframe.smoke.js: OK');
