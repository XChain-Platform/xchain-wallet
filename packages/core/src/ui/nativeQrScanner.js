// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The slot a shell fills with a native camera scanner.
//
// The iPhone app's WebView has no BarcodeDetector, so QrScanner cannot read a
// QR code there on its own. The iOS shell scans natively instead, and the web
// shell's adapter (packages/web/src/storage/nativeQrScanner.js) registers
// itself here at boot. Core never imports Capacitor: a browser, the desktop
// app and the extension register nothing, and QrScanner keeps its
// BarcodeDetector path or its paste advice.

/**
 * Why a native scan could not start, or why it ended.
 *
 * Start failures: 'denied' (camera permission refused or restricted),
 * 'unavailable' (no camera, or the capture session cannot start), 'busy' (a
 * scan is already open), 'stopped' (a stop arrived before the start settled;
 * a quiet close, not a fault), 'error' (anything else).
 * Close reasons: 'cancelled' (the user tapped Cancel), 'interrupted' (the app
 * went to the background, or a call or multitasking took the camera),
 * 'error' (the capture session failed).
 *
 * @typedef {'denied' | 'unavailable' | 'busy' | 'stopped' | 'cancelled' | 'interrupted' | 'error'} NativeQrReason
 */

/**
 * A shell's scanner. `start` presents the native camera view and resolves a
 * `stop` function once it is on screen; it rejects with an Error whose
 * `reason` is a start-failure NativeQrReason. `onValue` receives every QR
 * string the camera reads, and `onClosed` runs once if the scanner closes by
 * itself (never after `stop`).
 *
 * @typedef {{ start: (onValue: (text: string) => void, onClosed: (reason: NativeQrReason) => void) => Promise<() => void> }} NativeQrScanner
 */

/** @type {NativeQrScanner | null} */
let scanner = null;

/**
 * Register (or with null, remove) the shell's native scanner.
 *
 * @param {NativeQrScanner | null} next
 */
export function setNativeQrScanner(next) {
    if (next !== null && typeof next?.start !== 'function') {
        throw new TypeError('setNativeQrScanner: expected { start } or null');
    }
    scanner = next;
}

/** @returns {NativeQrScanner | null} the registered scanner, if any */
export function getNativeQrScanner() {
    return scanner;
}
