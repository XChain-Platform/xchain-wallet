// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Native QR scanning for the iOS shell, whose WebView has no BarcodeDetector.
//
// XChainVault.qrScanStart presents a full-screen camera view that reads QR
// codes with the system's own detector; each newly read code arrives as a
// `qrFrame` event, and the view closing by itself (Cancel, the app going to
// the background or losing the camera to a call, a session error) arrives as
// `qrScanClosed`. qrScanStop sends no qrScanClosed: JS asked for that close. This adapter
// turns that into core's NativeQrScanner shape (core/src/ui/nativeQrScanner.js)
// so core's QrScanner never touches Capacitor.
//
// The plugin is called directly rather than through callNativeVault: that
// helper rewrites every rejection into a VaultUnavailableError, and the
// rejection message here ('denied', 'unavailable', 'busy') is exactly what the
// screen needs to tell the user what to do.
//
// Registered only when the plugin implements qrScanStart. Android's plugin
// does not, and its WebView has BarcodeDetector, so it keeps the web path.

import { setNativeQrScanner } from '@xchain-wallet/core/ui/nativeQrScanner.js';
import { getNativeVault } from './nativeVault.js';

// 'stopped': qrScanStop arrived before the start settled (the screen went
// away while the permission prompt was up). It is a quiet close, not a fault.
const START_FAILURES = new Set(['denied', 'unavailable', 'busy', 'stopped']);
const CLOSE_REASONS = new Set(['cancelled', 'interrupted', 'error']);

/**
 * The start-failure reason a plugin rejection carries, or 'error'.
 *
 * @param {any} err
 * @returns {'denied' | 'unavailable' | 'busy' | 'stopped' | 'error'}
 */
export function startFailureReason(err) {
    for (const candidate of [err?.message, err?.code]) {
        if (typeof candidate === 'string' && START_FAILURES.has(candidate)) {
            return /** @type {'denied' | 'unavailable' | 'busy' | 'stopped'} */ (candidate);
        }
    }
    return 'error';
}

/** @param {string} reason */
function startError(reason) {
    const err = new Error(`native QR scan could not start: ${reason}`);
    /** @type {any} */ (err).reason = reason;
    return err;
}

/**
 * Remove a listener whether addListener handed back the handle itself or a
 * promise of it (Capacitor has done both across versions).
 *
 * @param {any} handle
 */
function removeListener(handle) {
    Promise.resolve(handle)
        .then((h) => h?.remove?.())
        .catch(() => { /* already gone */ });
}

/**
 * Open the native scanner.
 *
 * Both listeners go on BEFORE qrScanStart, because the plugin may send a frame
 * the instant the camera view is up and an event with no listener is dropped.
 *
 * @param {(text: string) => void} onValue
 * @param {(reason: string) => void} onClosed
 * @returns {Promise<() => void>} stop, which dismisses the view
 */
export async function startNativeQrScan(onValue, onClosed) {
    const plugin = getNativeVault();
    if (!plugin || typeof plugin.qrScanStart !== 'function' || typeof plugin.addListener !== 'function') {
        throw startError('unavailable');
    }

    // 'open' until stop() runs or the view closes itself; nothing is
    // delivered after that.
    let open = true;
    /** @type {any[]} */
    let handles = [];
    const detach = () => {
        handles.forEach(removeListener);
        handles = [];
    };

    try {
        handles.push(plugin.addListener('qrFrame', (event) => {
            const value = event?.value;
            if (open && typeof value === 'string' && value.length > 0) onValue(value);
        }));
        handles.push(plugin.addListener('qrScanClosed', (event) => {
            if (!open) return;
            open = false;
            detach();
            const reason = CLOSE_REASONS.has(event?.reason) ? event.reason : 'error';
            onClosed(reason);
        }));
    } catch (_err) {
        detach();
        throw startError('unavailable');
    }

    try {
        await plugin.qrScanStart({});
    } catch (err) {
        open = false;
        detach();
        throw startError(startFailureReason(err));
    }

    return function stop() {
        if (!open) return;
        open = false;
        detach();
        Promise.resolve()
            .then(() => plugin.qrScanStop?.({}))
            .catch(() => { /* nothing open, or the bridge is gone */ });
    };
}

/** The NativeQrScanner core's QrScanner calls. */
export const nativeQrScanner = Object.freeze({ start: startNativeQrScan });

/**
 * Register the native scanner with core when the shell's plugin can scan.
 * Safe to call on every boot.
 *
 * @returns {boolean} true when the scanner was registered
 */
export function installNativeQrScanner() {
    const plugin = getNativeVault();
    if (!plugin || typeof plugin.qrScanStart !== 'function') return false;
    setNativeQrScanner(nativeQrScanner);
    return true;
}
