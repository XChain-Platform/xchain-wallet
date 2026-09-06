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
// The residual this module cannot close: a subframe inside the app window
// calling `getDevices()` inherits the app's own origin at every handler
// Electron offers, so an allow-listed Ledger stays reachable from one. The
// defence for that is to keep such a frame out of the HID-granted session
// (the `connect.trezor.io` `frame-src`/`script-src` allowance, or a
// separate partition for Trezor Connect), which is a renderer-side trust
// boundary rather than a permission callback.
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
 * @param {{ appRoot: string }} opts
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
        if (!isAppHidSelect(details, appRoot)) {
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
 * @param {{ frame?: { url?: string } } | undefined} details
 * @param {string} appRoot   packaged renderer dir
 * @returns {boolean}        true means the frame may reach the picker
 */
export function isAppHidSelect(details, appRoot) {
    return !isRemoteFrameUrl(details?.frame?.url, appRoot);
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
