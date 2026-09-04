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
// Two handlers are needed:
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
// Vendor IDs sourced from the public USB-IF database:
//   - Ledger:    0x2C97
//   - Trezor T:  0x1209 (InterBiometrics, used by Trezor Model T)
//   - Trezor 1:  0x534C (SatoshiLabs legacy, used by Trezor One)
//
// The allowlist is exported so the `desktop-hw.smoke.js` smoke can
// verify coverage without duplicating the constants.

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

    session.setPermissionRequestHandler((webContents, permission, callback) => {
        // `hid` covers navigator.hid.*; grant it only to the app's own
        // renderer directory, and do the fine-grained vendor allowlist in
        // the device permission handler below. A frame identified as
        // remote (any other origin, or a local file outside the app) is
        // denied so it can never reach a paired Ledger/Trezor. Everything
        // else stays default-deny.
        if (permission === 'hid') {
            const url = webContents?.getURL?.();
            callback(!isRemoteFrameUrl(url, appRoot));
            return;
        }
        callback(false);
    });

    session.setDevicePermissionHandler((details) => {
        if (details.deviceType !== 'hid') return false;
        const vendorId = details.device?.vendorId;
        if (typeof vendorId !== 'number') return false;
        return ALLOWED_VENDOR_IDS.has(vendorId);
    });
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
