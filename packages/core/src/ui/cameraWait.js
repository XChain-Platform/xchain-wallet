// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { cameraRequests } from './cameraRequest.js';

/** How long a camera start may take while the app is in front. */
export const CAMERA_START_TIMEOUT_MS = 10000;

/**
 * Count one camera request as in flight, so the native lifecycle hook reads
 * the pause it causes as the permission dialog.
 *
 * @returns {() => void} ends the request; safe to call more than once
 */
export function beginCameraRequest() {
    let open = true;
    cameraRequests.pending += 1;
    return () => {
        if (open) cameraRequests.pending -= 1;
        open = false;
    };
}

/**
 * Wait for a getUserMedia promise, failing with an AbortError after
 * `timeoutMs` of foreground time. The clock stops while the app is paused
 * (the permission dialog is up) or hidden, so a user reading the dialog is
 * never timed out. A stream that arrives after the timeout is stopped.
 *
 * @param {Promise<MediaStream>} request
 * @param {number} timeoutMs
 * @returns {Promise<MediaStream>}
 */
export function waitForCamera(request, timeoutMs) {
    return new Promise((resolve, reject) => {
        let remaining = timeoutMs;
        let startedAt = 0;
        /** @type {ReturnType<typeof setTimeout> | null} */
        let timer = null;
        let paused = false;
        let done = false;

        const hold = () => {
            if (timer === null) return;
            clearTimeout(timer);
            timer = null;
            remaining = Math.max(0, remaining - (Date.now() - startedAt));
        };
        const run = () => {
            if (done || timer !== null || paused) return;
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
            startedAt = Date.now();
            timer = setTimeout(() => {
                finish();
                const error = new Error('The camera did not start in time.');
                error.name = 'AbortError';
                reject(error);
            }, remaining);
        };
        const onPause = () => { paused = true; hold(); };
        const onResume = () => { paused = false; run(); };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') hold();
            else run();
        };
        const finish = () => {
            done = true;
            hold();
            if (typeof document === 'undefined') return;
            document.removeEventListener('pause', onPause);
            document.removeEventListener('resume', onResume);
            document.removeEventListener('visibilitychange', onVisibility);
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('pause', onPause);
            document.addEventListener('resume', onResume);
            document.addEventListener('visibilitychange', onVisibility);
        }
        request.then(
            (stream) => {
                if (done) {
                    stream?.getTracks?.().forEach((track) => track.stop());
                    return;
                }
                finish();
                resolve(stream);
            },
            (error) => {
                if (done) return;
                finish();
                reject(error);
            },
        );
        run();
    });
}
