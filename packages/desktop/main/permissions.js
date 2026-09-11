// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// WebHID permission wiring for the Electron desktop shell (§40.12,
// Phase 2 Step 18).
//
// Under `contextIsolation: true` + `sandbox: true` (our §9.3.2
// posture), the renderer can call `navigator.hid.requestDevice()` but
// Electron gates every permission prompt + device enumeration through
// main-process session handlers. Without these handlers, WebHID
// silently returns an empty device list; the renderer's call to
// `TransportWebHID.create()` would spin indefinitely waiting for a
// device the OS sees but Electron refuses to surface.
//
// Three handlers are needed:
//
//   1. `setPermissionRequestHandler`: when the renderer calls a
//      permission-gated API (like requestDevice), Electron asks us
//      whether to allow it. We allow `hid` globally; finer-grained
//      filtering happens in handler 2.
//
//   2. `setDevicePermissionHandler`: Electron's device-picker invokes
//      this with each candidate HID device so we can decide whether
//      the user is allowed to select it. We allowlist Ledger + Trezor
//      vendor IDs so unrelated HID peripherals (keyboards, mice,
//      gamepads) don't clutter the picker.
//
//   3. `setPermissionCheckHandler`: Chromium asks whether a frame ALREADY
//      holds a permission before it asks to be granted one, and in
//      Electron 43 `hid` is check-only: it is a member of the check
//      handler's permission union and is ABSENT from the request
//      handler's (electron.d.ts, `setPermissionCheckHandler` vs
//      `setPermissionRequestHandler`). The check handler is therefore the
//      one the shipped product consults for WebHID, and handler 1 is the
//      belt to its braces rather than the reverse.
//
// Vendor IDs sourced from the public USB-IF database:
//   - Ledger:    0x2C97
//   - Trezor T:  0x1209 (InterBiometrics, used by Trezor Model T)
//   - Trezor 1:  0x534C (SatoshiLabs legacy, used by Trezor One)
//
// The allowlist is exported so the `desktop-hw.smoke.js` smoke can
// verify coverage without duplicating the constants.
//
// The handlers are origin-gated, not only vendor-gated. The renderer CSP
// allow-lists `https://connect.trezor.io` in `script-src` AND `frame-src`,
// so remote third-party content really does run inside the HID-granted
// session; a vendor-only device handler would hand that frame a paired
// Ledger. Electron also grants device access from a STORED device
// permission without re-running the request handler, so the request path
// cannot cover the device path.
//
// WHAT EACH HANDLER CAN ACTUALLY SEE. Measured against Electron 43.3.0,
// driving a real session: a `file://` window hosting (i) an
// `http://127.0.0.1` subframe and (ii) a `sandbox="allow-scripts"`
// srcdoc subframe, each carrying `allow="hid"`, with all three frames
// calling `navigator.hid`. The four callbacks are NOT interchangeable and
// only one of them names the requesting frame:
//
//   - `setPermissionRequestHandler` never fires for `hid` at all. `hid` is
//     a member of the CHECK handler's permission union and is absent from
//     the request handler's (electron.d.ts, v43), and the live run
//     confirms the type: a WebHID call reaches the check handler and the
//     request handler stays silent. The `hid` arm below is inert in the
//     shipped product and is kept as a belt for other Electron builds.
//   - `setPermissionCheckHandler` reports the EMBEDDER, not the caller.
//     All three frames produce the byte-identical payload
//     `requestingOrigin: 'file:///'`, `details: { isMainFrame: false,
//     securityOrigin: 'file:///' }` - no `requestingUrl`, no
//     `embeddingOrigin`, and `isMainFrame: false` even for the window's
//     own top-level frame. So this handler can judge the WINDOW's origin
//     and nothing finer, and reading `isMainFrame` as a subframe signal
//     denies the app its own device picker. See `isAppHidCheck`.
//   - `setDevicePermissionHandler` reports the embedder too:
//     `getDevices()` called from either hostile subframe invokes it with
//     `origin: 'file://'`, the same value the app's own frame produces.
//     `isRemoteHidOrigin` therefore stops a remote TOP-LEVEL window and
//     structurally cannot see a subframe.
//   - `select-hid-device` is the only callback that names the caller:
//     `details.frame.url` reads `http://127.0.0.1:<port>/frame.html` and
//     `about:srcdoc` for the two hostile frames against the packaged
//     renderer path for the app's own, and `details.frame.origin` splits
//     them as `http://127.0.0.1:<port>` / `null` / `file://`. The frame
//     check lives there because that is where the evidence is.
//
// CLOSING THE SUBFRAME RESIDUAL. A subframe inside the app
// window calling `getDevices()` inherits the app's own origin at every
// handler Electron offers, so no return value computed from
// `details.origin` can separate it from the app's own frame, and
// `DevicePermissionHandlerHandlerDetails` (electron.d.ts, v43) carries
// `deviceType`, `origin` and `device` and nothing else. The answer is
// therefore not a finer origin check but a different input: whether the
// HID-granted session contains a subframe AT ALL.
//
// It legitimately never does. The packaged renderer embeds no `<iframe>`
// anywhere (the one iframe string in the tree is inside a token-metadata
// fixture that `tokenInfo.js` strips), so a child frame appearing in a
// preload-bearing window is an anomaly, not a feature. `hidFrameGuard`
// latches on the first one Electron reports through `frame-created` /
// `will-frame-navigate` and the device handler then refuses every device,
// paired or not, for as long as that webContents lives. A hostile frame
// can no longer be handed a stored Ledger by sharing the app's origin,
// because after it exists nobody gets one.
//
// The latch is session-wide, not per window: a device grant is scoped to
// the session, so a subframe in ANY window can read a device paired in
// another and one poisoned window has to close the grant everywhere.
//
// The second leg is `select-hid-device`. Its frame check was URL-only, so
// a subframe pointed at the app's own `index.html` read as the app and
// could reach the picker; `isAppHidSelect` now also requires a TOP-LEVEL
// frame, which `details.frame.parent` states directly.
//
// Renderer-side hardening (dropping the `connect.trezor.io`
// `frame-src`/`script-src` allowance, or moving Trezor Connect to its own
// partition) is still worth doing and is tracked separately; it is no
// longer what holds this path shut.
//
// The check handler narrows `hid` alone and leaves every other permission
// at the session default. The shared UI it hosts reads and writes the
// clipboard, offers a camera QR scanner and asks for notification
// permission, so a blanket default-deny across the check handler takes
// working features out of the shipped wallet. A wider permission posture
// is its own change with its own coverage, not a side effect of the
// WebHID gate.

import { isRemoteFrameUrl } from './security.js';

export const HID_VENDOR_ALLOWLIST = Object.freeze({
    LEDGER: 0x2C97,
    TREZOR_T: 0x1209,
    TREZOR_ONE: 0x534C,
});

const ALLOWED_VENDOR_IDS = new Set(Object.values(HID_VENDOR_ALLOWLIST));

/**
 * Session-wide record of which webContents have been seen hosting a
 * subframe. Consulted by the device-permission handler, which is handed an
 * origin and no frame and so cannot ask the question any other way.
 *
 * Latching, not counting: Electron reports frame CREATION and offers no
 * matching destruction event, and a frame that has already existed may
 * already hold a device handle, so the flag clears only when the whole
 * webContents goes away. Nothing legitimate in the packaged renderer
 * creates a subframe, so no working feature depends on it staying clear.
 *
 * @returns {{ noteSubframe: (key: unknown) => void, forget: (key: unknown) => void, hasSubframe: () => boolean, reset: () => void }}
 */
export function createHidFrameGuard() {
    const poisoned = new Set();
    return {
        noteSubframe(key) { poisoned.add(key); },
        forget(key) { poisoned.delete(key); },
        hasSubframe() { return poisoned.size > 0; },
        reset() { poisoned.clear(); },
    };
}

/**
 * The guard the shipped handlers read. A module singleton because the HID
 * grant it defends is a property of the session, which is a singleton too:
 * `observeHidFrames` (called per webContents from index.js) and
 * `attachHidPermissions` (called once for the default session) have to be
 * looking at the same set.
 */
export const hidFrameGuard = createHidFrameGuard();

/**
 * True when `frame` is a WebFrameMain that has a parent, i.e. an embedded
 * frame rather than a window's own top-level one.
 *
 * A destroyed frame throws on property access and reads as "not a
 * subframe" here; that case is covered by the `isMainFrame` flag on
 * `will-frame-navigate`, which is a plain boolean and cannot throw.
 *
 * @param {{ parent?: unknown } | null | undefined} frame
 * @returns {boolean}
 */
function isSubframe(frame) {
    if (!frame) return false;
    try {
        return frame.parent !== null && frame.parent !== undefined;
    } catch {
        return false;
    }
}

/**
 * Watch one webContents for subframes and latch the HID guard when one
 * appears. Called from `hardenWebContents` in index.js so every
 * preload-bearing webContents the app creates is covered, including
 * windows opened after the session handlers were wired.
 *
 * @param {{ id?: number, on?: (event: string, listener: Function) => unknown }} contents
 * @param {{ guard?: ReturnType<typeof createHidFrameGuard> }} [opts]
 */
export function observeHidFrames(contents, opts = {}) {
    if (!contents || typeof contents.on !== 'function') return;
    const guard = opts.guard ?? hidFrameGuard;
    const key = typeof contents.id === 'number' ? contents.id : contents;
    contents.on('frame-created', (_event, details) => {
        if (isSubframe(details?.frame)) guard.noteSubframe(key);
    });
    contents.on('will-frame-navigate', (details) => {
        // `frame-created` fires for a frame Electron can still resolve;
        // this arm catches the rest, and `isMainFrame` is a plain boolean
        // that survives a frame already torn down.
        if (details?.isMainFrame === false || isSubframe(details?.frame)) guard.noteSubframe(key);
    });
    contents.on('destroyed', () => { guard.forget(key); });
}

/**
 * Wire WebHID permission handlers onto an Electron session. Typical
 * caller is `packages/desktop/main/index.js`:
 *
 *     attachHidPermissions(session.defaultSession, { appRoot: APP_ROOT });
 *
 * `appRoot` is the packaged renderer directory and is validated here, at
 * wiring time, so a caller that forgot it fails at boot rather than
 * silently widening the HID grant to every local file.
 *
 * @param {import('electron').Session} session
 * @param {{ appRoot: string, guard?: ReturnType<typeof createHidFrameGuard> }} opts
 */
export function attachHidPermissions(session, opts) {
    if (!session) throw new Error('attachHidPermissions: session is required');
    if (typeof session.setPermissionRequestHandler !== 'function') {
        throw new Error('attachHidPermissions: session.setPermissionRequestHandler is missing');
    }
    if (typeof session.setDevicePermissionHandler !== 'function') {
        throw new Error('attachHidPermissions: session.setDevicePermissionHandler is missing');
    }
    const appRoot = opts?.appRoot;
    if (typeof appRoot !== 'string' || appRoot.length === 0) {
        throw new Error('attachHidPermissions: opts.appRoot (packaged renderer dir) is required');
    }
    if (typeof session.setPermissionCheckHandler !== 'function') {
        throw new Error('attachHidPermissions: session.setPermissionCheckHandler is missing');
    }
    if (typeof session.on !== 'function') {
        throw new Error('attachHidPermissions: session.on (select-hid-device) is missing');
    }
    // Injectable so a smoke can drive one guard's whole lifecycle without
    // leaking state into the next case; the shipped call takes the module
    // singleton that `observeHidFrames` latches.
    const guard = opts?.guard ?? hidFrameGuard;

    session.setPermissionRequestHandler((webContents, permission, callback, details) => {
        // Electron 43 never routes `hid` here (see the handler census in
        // the header), so this arm decides nothing in the shipped app and
        // is kept for builds whose request handler does carry `hid`. The
        // live gates are the check handler and `select-hid-device` below.
        //
        // Judge the REQUESTING FRAME, not its embedder: `getURL()` reports the
        // top-level window, which would let a connect.trezor.io subframe
        // asking for `hid` inherit the verdict of the app page hosting it.
        // Every other permission stays default-deny.
        if (permission === 'hid') {
            const url = requestingFrameUrl(webContents, details);
            callback(!isRemoteFrameUrl(url, appRoot));
            return;
        }
        callback(false);
    });

    session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        // `hid` is the one permission this module owns. Everything else
        // keeps the session default so the clipboard, the QR scanner and
        // the notification prompt keep working.
        if (permission !== 'hid') return true;
        return isAppHidCheck(details, requestingOrigin, appRoot);
    });

    session.setDevicePermissionHandler((details) => {
        if (details.deviceType !== 'hid') return false;
        if (isRemoteHidOrigin(details.origin)) return false;
        // The subframe residual. This callback is handed an origin and no
        // frame, and every frame in the app window spells that origin
        // `file://`, so the only question that separates a paired-device
        // read by the app from one by a frame it embeds is whether the
        // session hosts an embedded frame at all. It never should.
        if (guard.hasSubframe()) return false;
        const vendorId = details.device?.vendorId;
        if (typeof vendorId !== 'number') return false;
        return ALLOWED_VENDOR_IDS.has(vendorId);
    });

    session.on('select-hid-device', (event, details, callback) => {
        // Refuse a frame that is not the app's, explicitly. The app's own
        // frame is left to the session default, which grants no device
        // until a picker exists to choose one; a device picker built on
        // this event therefore inherits the frame check rather than having
        // to remember it.
        if (guard.hasSubframe() || !isAppHidSelect(details, appRoot)) {
            event.preventDefault();
            callback(null);
        }
    });
}

/**
 * Resolve the URL of the frame a permission request came from. Prefers
 * `PermissionRequest.requestingUrl` (the requesting frame's own last URL)
 * and falls back to the top-level webContents URL when Electron supplies
 * no details, which is also the shape the pure smoke harness feeds in.
 *
 * @param {{ getURL?: () => string } | null | undefined} webContents
 * @param {{ requestingUrl?: string } | undefined} details
 * @returns {string | undefined}
 */
function requestingFrameUrl(webContents, details) {
    const frameUrl = details?.requestingUrl;
    if (typeof frameUrl === 'string' && frameUrl.length > 0) return frameUrl;
    return webContents?.getURL?.();
}

/**
 * Decide a `hid` permission CHECK, the callback Electron 43 actually
 * consults for WebHID. Rejects a window whose origin is POSITIVELY
 * something other than this app, in the same one-sided posture as
 * `isRemoteFrameUrl`.
 *
 * The scope is a WINDOW, not a frame, and that is a measured limit rather
 * than a choice: a live Electron 43.3.0 session hands this callback the
 * embedder's origin for every frame in the window, so an `http://` or
 * opaque subframe arrives spelled exactly like the app's own top-level
 * frame. Nothing here can tell them apart. `select-hid-device` is where
 * the frame is named, and where the frame check therefore lives.
 *
 * `isMainFrame` is deliberately not read. Electron reports it as `false`
 * for the app's own top-level frame on the `hid` check, so a subframe
 * rule built on it denies the app its own device picker.
 *
 * `requestingUrl` is absent on the `hid` check and is honoured when
 * present, since other permissions and other Electron builds do supply it.
 * An absent signal never denies.
 *
 * @param {{ requestingUrl?: string, embeddingOrigin?: string, securityOrigin?: string } | undefined} details
 * @param {unknown} requestingOrigin   the origin argument Electron passes in
 * @param {string} appRoot             packaged renderer dir
 * @returns {boolean}                  true means allow the check
 */
export function isAppHidCheck(details, requestingOrigin, appRoot) {
    if (isRemoteHidOrigin(requestingOrigin)) return false;
    if (isRemoteHidOrigin(details?.securityOrigin)) return false;
    if (isRemoteHidOrigin(details?.embeddingOrigin)) return false;
    const url = details?.requestingUrl;
    if (typeof url === 'string' && url.length > 0) return !isRemoteFrameUrl(url, appRoot);
    return true;
}

/**
 * Decide a `select-hid-device` request: the ONE callback that names the
 * requesting frame. `details.frame` is a WebFrameMain carrying that
 * frame's own url and origin, where the permission check and the device
 * grant both report the embedder's, so a subframe is visible here and
 * nowhere else.
 *
 * Two things have to hold and the URL answers only one of them. A frame
 * whose url sits inside `appRoot` is running the app's own code, but a
 * frame the app EMBEDS pointed at the app's own `index.html` reads exactly
 * the same way, and the picker belongs to the window's top-level frame
 * alone. The parent link states which one this is, and unlike the origin
 * it is not collapsed by Chromium's `file://` serialization.
 *
 * @param {{ frame?: { url?: string, parent?: unknown } } | undefined} details
 * @param {string} appRoot   packaged renderer dir
 * @returns {boolean}        true means the frame may reach the picker
 */
export function isAppHidSelect(details, appRoot) {
    const frame = details?.frame;
    if (isSubframe(frame)) return false;
    let url;
    try {
        url = frame?.url;
    } catch {
        // A WebFrameMain throws on property access once it is detached.
        // Deny: a frame that no longer exists has no picker to open, and a
        // throw escaping here would leave `select-hid-device` neither
        // prevented nor answered, hanging the request.
        return false;
    }
    return !isRemoteFrameUrl(url, appRoot);
}

/**
 * True when a device-permission origin is POSITIVELY identified as
 * something other than this app's own renderer.
 *
 * Why an origin and not a path: `setDevicePermissionHandler` receives an
 * ORIGIN, and every `file://` page collapses to one origin (Chromium
 * serializes it as `file://`, or as `null` when the frame's origin is
 * opaque). No path survives that, so `isAppUrl` cannot be used here and a
 * positive allowlist would deny the app's own picker on whichever of the
 * two spellings Chromium happens to emit. The check is therefore
 * deliberately one-sided, in the same posture as `isRemoteFrameUrl`:
 * reject what is provably remote, never guess about what is unknown.
 *
 * That is enough for the path this exists to close. The remote content
 * the CSP admits is `https://connect.trezor.io`, an http(s) tuple origin,
 * and any such origin is rejected here.
 *
 * @param {unknown} origin   the `details.origin` Electron passes in
 * @returns {boolean}        true means refuse the device grant
 */
export function isRemoteHidOrigin(origin) {
    if (typeof origin !== 'string' || origin.length === 0) return false;
    if (origin === 'null') return false;
    return !/^file:\/\//i.test(origin);
}

/**
 * Pure test helper. Returns true for Ledger / Trezor vendor IDs,
 * false otherwise. Lets the smoke exercise the vendor allowlist
 * without mounting a real Electron session.
 *
 * @param {number} vendorId
 */
export function isAllowedHidVendor(vendorId) {
    return ALLOWED_VENDOR_IDS.has(vendorId);
}
